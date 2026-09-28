// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

// local http test server → allow the loopback fetch through the SSRF policy
process.env.INGEST_ALLOW_PRIVATE = "1";

import { openLocalDb, closeLocalDb, rawClient, type LocalDb } from "@/db/local";
import { LocalStore, type LocalContext } from "@/lib/storage/local";
import { createNotebook } from "@/lib/services/notebooks";
import {
  cancelImportJob,
  claimImportJob,
  createImportJob,
  listImportJobsByNotebook,
  retryImportJob,
} from "@/lib/services/import-jobs";
import { setJobIntent } from "@/lib/services/job-control";
import { runImportJob } from "@/engine/imports";
import { startProcessingLoop } from "@/engine/jobs";

const PAGE_HTML = `<html><head><title>Testseite</title></head><body>
<h1>Kapitel eins</h1><p>${"Lorem ipsum dolor sit amet, consetetur sadipscing elitr. ".repeat(40)}</p>
</body></html>`;

let dir: string;
let db: LocalDb;
let ctx: LocalContext;
let notebookId: string;
let server: http.Server;
let baseUrl = "";

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-engine-imports-"));
  db = openLocalDb(dir);
  ctx = { db, store: new LocalStore(db, dir), dataDir: dir };
  notebookId = await createNotebook(db, { ownerId: "local", title: "Imports" });

  server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/artikel`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

function createWebJob(url: string): string {
  return createImportJob(db, {
    ownerId: "local",
    notebookId,
    url,
    provider: "web",
    kind: "page",
    resourceKey: `web:${url}`,
  }).jobId;
}

function jobStatus(jobId: string): string | undefined {
  return listImportJobsByNotebook(db, notebookId).find((j) => j._id === jobId)?.status;
}

describe("URL imports run inside the engine (desktop-workers-plan slice 2)", () => {
  it("the engine loop completes a web import end to end — no standalone worker", async () => {
    const jobId = createWebJob(baseUrl);
    const stop = startProcessingLoop(ctx, 100);

    let status = jobStatus(jobId);
    for (let i = 0; i < 100 && status !== "completed"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      status = jobStatus(jobId);
    }
    stop();

    expect(status).toBe("completed");
    const source = rawClient(db)
      .prepare(`SELECT id, file_name AS fileName FROM sources WHERE notebook_id = ?`)
      .get(notebookId) as { id: string; fileName: string } | undefined;
    expect(source?.fileName).toBe("Testseite");
    const chunkCount = rawClient(db)
      .prepare(`SELECT COUNT(*) AS n FROM chunks WHERE source_id = ?`)
      .get(source!.id) as { n: number };
    expect(chunkCount.n).toBeGreaterThan(0);
  });

  it("a pause intent at a phase boundary releases the lease back to queued", async () => {
    const jobId = createWebJob(baseUrl);
    const job = claimImportJob(db);
    expect(job?._id).toBe(jobId);

    const outcome = await runImportJob(ctx, job!, {
      beforePhase: async () => {
        setJobIntent(db, "import", jobId, "pause");
      },
    });

    expect(outcome).toBe("paused");
    const row = rawClient(db)
      .prepare(
        `SELECT status, lease_token AS token, attempts, next_attempt_at AS nextAt FROM import_jobs WHERE id = ?`
      )
      .get(jobId) as { status: string; token: null; attempts: number; nextAt: number };
    expect(row.status).toBe("queued"); // paused imports stay queued, lease released
    expect(row.token).toBeNull();
    expect(row.attempts).toBe(0); // pausing costs no attempt
    expect(row.nextAt).toBeLessThanOrEqual(Date.now()); // resumable immediately
  });

  it("a cancel intent at a phase boundary marks the job cancelled", async () => {
    const jobId = createWebJob(baseUrl);
    const job = claimImportJob(db);

    const outcome = await runImportJob(ctx, job!, {
      beforePhase: async () => {
        setJobIntent(db, "import", jobId, "cancel");
      },
    });

    expect(outcome).toBe("cancelled");
    const row = rawClient(db)
      .prepare(`SELECT status, lease_token AS token FROM import_jobs WHERE id = ?`)
      .get(jobId) as { status: string; token: null };
    expect(row.status).toBe("cancelled");
    expect(row.token).toBeNull();
    // no source was created for a cancelled import
    expect(rawClient(db).prepare(`SELECT COUNT(*) AS n FROM sources`).get() as { n: number }).toEqual({ n: 0 });
  });

  it("a paused/cancelled intent keeps a queued job out of the claim until resumed", async () => {
    const jobId = createWebJob(baseUrl);
    setJobIntent(db, "import", jobId, "pause");
    // no claim, no lease churn: the intent is filtered inside the claim SQL
    expect(claimImportJob(db)).toBeNull();
    setJobIntent(db, "import", jobId, "run");
    expect(claimImportJob(db)?._id).toBe(jobId);
  });

  it("retry clears a stale cancel intent so a retried job is claimable again", async () => {
    const jobId = createWebJob(baseUrl);
    setJobIntent(db, "import", jobId, "cancel"); // user clicks cancel
    cancelImportJob(db, jobId); // engine confirms: cancelled
    retryImportJob(db, jobId); // user retries
    // the stale 'cancel' intent must not block the retried job forever
    expect(claimImportJob(db)?._id).toBe(jobId);
  });

  it("a cancel clicked during processContent aborts before the source commits", async () => {
    const jobId = createWebJob(baseUrl);
    const job = claimImportJob(db);

    let processingGates = 0;
    const outcome = await runImportJob(ctx, job!, {
      beforePhase: async (phase) => {
        // the runner crosses the processing gate twice: before and after
        // text extraction — cancel only lands on the second crossing
        if (phase === "processing") {
          processingGates++;
          if (processingGates === 2) setJobIntent(db, "import", jobId, "cancel");
        }
      },
    });

    expect(outcome).toBe("cancelled");
    // the download finished but nothing was committed
    expect(rawClient(db).prepare(`SELECT COUNT(*) AS n FROM sources`).get() as { n: number }).toEqual({ n: 0 });
    expect(jobStatus(jobId)).toBe("cancelled");
  });
});
