// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openLocalDb, closeLocalDb, rawClient, type LocalDb } from "@/db/local";
import { LocalStore, type LocalContext } from "@/lib/storage/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource } from "@/lib/services/sources";
import { enqueueProcessingJob, claimProcessingJob } from "@/lib/services/processing-jobs";
import { setJobIntent } from "@/lib/services/job-control";
import { runProcessingJob } from "@/engine/processing";

let dir: string;
let db: LocalDb;
let ctx: LocalContext;
let notebookId: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-engine-pool-"));
  db = openLocalDb(dir);
  ctx = { db, store: new LocalStore(db, dir), dataDir: dir };
  notebookId = await createNotebook(db, { ownerId: "local", title: "Uploads" });
});

afterEach(() => {
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A text upload is the cheapest path: no storage read, no ffmpeg, no model. */
async function createTextJob(): Promise<{ jobId: string; sourceId: string }> {
  const sourceId = await createSource(db, {
    ownerId: "local",
    notebookId,
    fileName: "notizen.txt",
    fileType: "text/plain",
    fileSize: 11,
  });
  const jobId = enqueueProcessingJob(db, { ownerId: "local", sourceId, notebookId });
  return { jobId, sourceId };
}

describe("engine job pool (desktop-workers-plan slice 3a)", () => {
  it("a paused/cancelled intent during upload processing releases the lease at the next stage boundary", async () => {
    const { jobId } = await createTextJob();
    const job = claimProcessingJob(db);
    expect(job?.id).toBe(jobId);

    const outcome = await runProcessingJob(ctx, jobId, job!.leaseToken!, job!.sourceId, {
      beforeStage: async () => {
        setJobIntent(db, "processing", jobId, "pause");
      },
    });

    expect(outcome).toBe("paused");
    const row = rawClient(db)
      .prepare(
        `SELECT status, lease_token AS token, attempts FROM processing_jobs WHERE id = ?`
      )
      .get(jobId) as { status: string; token: null; attempts: number };
    expect(row.status).toBe("pending"); // paused uploads stay pending, lease released
    expect(row.token).toBeNull();
    expect(row.attempts).toBe(0); // pausing costs no attempt (mirrors releaseImportJob)
    // nothing was committed
    expect(
      rawClient(db).prepare(`SELECT COUNT(*) AS n FROM chunks`).get() as { n: number }
    ).toEqual({ n: 0 });
  });

  it("a cancel intent at a stage boundary fails the job and marks the source errored", async () => {
    const { jobId, sourceId } = await createTextJob();
    const job = claimProcessingJob(db);

    const outcome = await runProcessingJob(ctx, jobId, job!.leaseToken!, sourceId, {
      beforeStage: async () => {
        setJobIntent(db, "processing", jobId, "cancel");
      },
    });

    expect(outcome).toBe("cancelled");
    const row = rawClient(db)
      .prepare(`SELECT status, lease_token AS token FROM processing_jobs WHERE id = ?`)
      .get(jobId) as { status: string; token: null };
    expect(row.status).toBe("failed");
    expect(row.token).toBeNull();
    const source = rawClient(db)
      .prepare(`SELECT status FROM sources WHERE id = ?`)
      .get(sourceId) as { status: string };
    expect(source.status).toBe("error");
  });
});
