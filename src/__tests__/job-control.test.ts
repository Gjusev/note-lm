// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLocalDb, closeLocalDb, type LocalDb } from "@/db/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource, replaceChunks } from "@/lib/services/sources";
import { enqueueProcessingJob } from "@/lib/services/processing-jobs";
import { createImportJob } from "@/lib/services/import-jobs";
import {
  setJobIntent,
  getJobIntent,
  listJobs,
  emitJobEvent,
  eventsSince,
} from "@/lib/services/job-control";

let dir: string;
let db: LocalDb;
let notebookId: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-jobs-"));
  db = openLocalDb(dir);
  notebookId = await createNotebook(db, { ownerId: "local", title: "J" });
});

afterEach(() => {
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("unified job control (desktop-workers-plan)", () => {
  it("lists jobs from every queue with intents joined in", async () => {
    const sourceId = await createSource(db, {
      ownerId: "local", notebookId, fileName: "a.pdf", fileType: "application/pdf", fileSize: 1,
    });
    replaceChunks(db, { ownerId: "local", sourceId, notebookId }, ["x"]);
    const procId = enqueueProcessingJob(db, { ownerId: "local", sourceId, notebookId });
    const { jobId: importId } = createImportJob(db, {
      ownerId: "local", notebookId, url: "https://x.test/a", provider: "web", kind: "page", resourceKey: "web:https://x.test/a",
    });

    const jobs = listJobs(db);
    expect(jobs.map((j) => j.kind).sort()).toEqual(["import", "processing"]);
    expect(jobs.every((j) => j.intent === "run")).toBe(true); // default

    // pause one, cancel another — intents persist apart from status
    setJobIntent(db, "processing", procId, "pause");
    setJobIntent(db, "import", importId, "cancel");
    expect(getJobIntent(db, "processing", procId)).toBe("pause");
    expect(getJobIntent(db, "import", importId)).toBe("cancel");

    const after = listJobs(db).filter((j) => j.id === procId || j.id === importId);
    expect(after.find((j) => j.id === procId)?.intent).toBe("pause");
    expect(after.find((j) => j.id === importId)?.intent).toBe("cancel");
    // observed statuses unchanged by the intent write
    expect(after.find((j) => j.id === procId)?.status).toBe("pending");
    expect(after.find((j) => j.id === importId)?.status).toBe("queued");

    // notebook filter scopes the view
    expect(listJobs(db, notebookId)).toHaveLength(2);
    const other = await createNotebook(db, { ownerId: "local", title: "O" });
    expect(listJobs(db, other)).toHaveLength(0);
  });

  it("events carry a monotonic cursor the UI resumes from", () => {
    emitJobEvent(db, "processing", "p1", "claimed");
    emitJobEvent(db, "processing", "p1", "progress", { done: 1, total: 4 });
    emitJobEvent(db, "material", "m1", "generating");

    const all = eventsSince(db, 0);
    expect(all).toHaveLength(3);
    expect(all[0].seq).toBeLessThan(all[1].seq);
    expect(all[1].payload).toBe(JSON.stringify({ done: 1, total: 4 }));

    // resume from the middle: only newer events, no repeats
    const resumed = eventsSince(db, all[0].seq);
    expect(resumed.map((e) => e.type)).toEqual(["progress", "generating"]);
  });
});
