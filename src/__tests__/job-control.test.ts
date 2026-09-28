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
  setProgressClock,
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

describe("job event stream (event-stream slice)", () => {
  afterEach(() => {
    setProgressClock(null); // restore the real writer clock and throttle state
  });

  it("progress events coalesce within the window but terminal events never do", () => {
    let now = 1_000;
    setProgressClock(() => now);

    emitJobEvent(db, "processing", "p1", "running"); // phase event: written, never throttled
    emitJobEvent(db, "processing", "p1", "progress", { stage: "transcribing", done: 1, total: 4 }); // first in window: written
    now = 1_200;
    emitJobEvent(db, "processing", "p1", "progress", { stage: "transcribing", done: 2, intermediate: true, total: 4 }); // inside window: dropped
    now = 1_400;
    emitJobEvent(db, "processing", "p1", "progress", { stage: "transcribing", done: 3, total: 4 }); // dropped
    now = 2_100; // 1100ms after the window's write: writable again
    emitJobEvent(db, "processing", "p1", "progress", { stage: "transcribing", done: 4, total: 4 }); // new window: written
    emitJobEvent(db, "processing", "p1", "finished"); // terminal: written immediately, same instant

    const rows = eventsSince(db, 0).filter((e) => e.jobId === "p1");
    expect(rows.map((e) => e.type)).toEqual(["running", "progress", "progress", "finished"]);
    expect(rows.at(-2)!.payload).toBe(JSON.stringify({ stage: "transcribing", done: 4, total: 4 }));
  });

  it("eventsSince respects the limit and the caller pages to the end", () => {
    for (let i = 0; i < 4; i++) emitJobEvent(db, "processing", `page-${i}`, "running");

    const page1 = eventsSince(db, 0, 2);
    const page2 = eventsSince(db, page1.at(-1)!.seq, 2);
    expect([page1.length, page2.length]).toEqual([2, 2]); // the limit caps each read
    const jobIds = [...page1, ...page2].map((e) => e.jobId);
    expect(jobIds).toEqual(["page-0", "page-1", "page-2", "page-3"]); // no dupes, no loss, in order
  });
});
