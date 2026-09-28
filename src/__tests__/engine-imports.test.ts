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
import {
  getJobCheckpoints,
  reconcileStartupArtifacts,
  setJobCheckpoint,
  setJobIntent,
} from "@/lib/services/job-control";
import { downloadPlan } from "@/lib/ingestion/download";
import { runImportJob } from "@/engine/imports";
import { startProcessingLoop } from "@/engine/jobs";

const PAGE_HTML = `<html><head><title>Testseite</title></head><body>
<h1>Kapitel eins</h1><p>${"Lorem ipsum dolor sit amet, consetetur sadipscing elitr. ".repeat(40)}</p>
</body></html>`;

// large-ish body (~190 KB) for the Range-resume tests
const RESUME_BODY = `<html><head><title>Testseite</title></head><body><p>${"Lorem ipsum dolor sit amet, consetetur sadipscing elitr. ".repeat(3000)}</p></body></html>`;

let dir: string;
let db: LocalDb;
let ctx: LocalContext;
let notebookId: string;
let server: http.Server;
let baseUrl = "";
let serverMode: "simple" | "range" | "plain" = "simple";
let seenRanges: string[] = [];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-engine-imports-"));
  db = openLocalDb(dir);
  ctx = { db, store: new LocalStore(db, dir), dataDir: dir };
  notebookId = await createNotebook(db, { ownerId: "local", title: "Imports" });
  serverMode = "simple";
  seenRanges = [];

  server = http.createServer((req, res) => {
    const range = req.headers.range;
    if (typeof range === "string") seenRanges.push(range);
    if (serverMode === "simple") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE_HTML);
      return;
    }
    if (serverMode === "range" && typeof range === "string") {
      const start = Number(/^bytes=(\d+)-$/.exec(range)?.[1]);
      if (Number.isInteger(start) && start > 0 && start < RESUME_BODY.length) {
        res.writeHead(206, {
          "content-type": "text/html; charset=utf-8",
          etag: '"resume-v1"',
          "content-range": `bytes ${start}-${RESUME_BODY.length - 1}/${RESUME_BODY.length}`,
          "content-length": String(RESUME_BODY.length - start),
        });
        res.end(RESUME_BODY.slice(start));
        return;
      }
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      etag: '"resume-v1"',
      "content-length": String(RESUME_BODY.length),
    });
    res.end(RESUME_BODY);
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

/** Simulates what a paused/crashed download leaves behind: a partial file plus its token-fenced checkpoint. */
function seedPartial(
  jobId: string,
  token: string,
  opts: { bytes: number; etag?: string | null; done?: boolean }
): string {
  const partPath = path.join(dir, "tmp", "jobs", jobId, "artikel.part");
  fs.mkdirSync(path.dirname(partPath), { recursive: true });
  fs.writeFileSync(partPath, RESUME_BODY.slice(0, opts.bytes));
  setJobCheckpoint(db, "import", jobId, token, "downloading", JSON.stringify({
    partPath,
    bytes: opts.bytes,
    etag: opts.etag ?? '"resume-v1"',
    lastModified: null,
    ...(opts.done && { done: true, contentType: "text/html" }),
  }));
  return partPath;
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

describe("HTTP-Range-resumable downloads (desktop-workers-plan slice 3b)", () => {
  it("downloadPlan resumes via Range and appends the 206 remainder to the part file", async () => {
    serverMode = "range";
    const partDir = fs.mkdtempSync(path.join(os.tmpdir(), "nolm-resume-"));
    const partPath = path.join(partDir, "resume.part");
    fs.writeFileSync(partPath, RESUME_BODY.slice(0, 1024));

    const result = await downloadPlan({ url: baseUrl, expect: "html" }, {
      resume: { partPath, bytesDone: 1024, etag: '"resume-v1"', lastModified: null },
    });

    expect(seenRanges).toContain("bytes=1024-"); // the server received the Range request
    expect(result.restarted).toBe(false);
    expect(result.bytes).toBe(RESUME_BODY.length);
    expect(result.buffer.equals(Buffer.from(RESUME_BODY, "utf8"))).toBe(true);
    // the 206 remainder was appended into the file we handed over
    expect(fs.readFileSync(partPath).equals(Buffer.from(RESUME_BODY, "utf8"))).toBe(true);
    await fs.promises.rm(partDir, { recursive: true, force: true });
  });

  it("a paused download leaves partial + checkpoint and the next run resumes with a Range request", async () => {
    serverMode = "range";
    const jobId = createWebJob(baseUrl);
    const job = claimImportJob(db);

    const partPath = seedPartial(jobId, job!.leaseToken!, { bytes: 1024 });
    const outcome = await runImportJob(ctx, job!);

    expect(outcome).toBe("completed");
    expect(seenRanges).toContain("bytes=1024-"); // resumed, not restarted
    // terminal state cleans partial + checkpoint
    expect(fs.existsSync(partPath)).toBe(false);
    expect(getJobCheckpoints(db, "import", jobId)).toHaveLength(0);
    const source = rawClient(db)
      .prepare(`SELECT file_name AS fileName FROM sources WHERE notebook_id = ?`)
      .get(notebookId) as { fileName: string };
    expect(source.fileName).toBe("Testseite");
  });

  it("a download whose validator changed restarts the file and emits download_restarted", async () => {
    serverMode = "plain"; // server answers 200 only now (no Range support / changed content)
    const jobId = createWebJob(baseUrl);
    const job = claimImportJob(db);

    const partPath = seedPartial(jobId, job!.leaseToken!, { bytes: 1024, etag: '"stale-etag"' });
    const outcome = await runImportJob(ctx, job!);

    expect(outcome).toBe("completed");
    expect(seenRanges).toContain("bytes=1024-"); // resume was attempted against the 200-only server
    const events = rawClient(db)
      .prepare(`SELECT type FROM job_events WHERE job_kind = 'import' AND job_id = ?`)
      .all(jobId) as Array<{ type: string }>;
    expect(events.map((e) => e.type)).toContain("download_restarted");
    expect(fs.existsSync(partPath)).toBe(false); // restarted download cleaned up at completion
  });

  it("startup reconcile deletes terminal/orphan artifacts and keeps live jobs' partials", () => {
    const terminalId = createWebJob(baseUrl);
    rawClient(db).prepare(`UPDATE import_jobs SET status = 'completed' WHERE id = ?`).run(terminalId);
    const liveId = createWebJob(baseUrl); // stays queued (paused) — its partial must survive
    const jobsRoot = path.join(dir, "tmp", "jobs");
    fs.mkdirSync(path.join(jobsRoot, terminalId), { recursive: true });
    fs.writeFileSync(path.join(jobsRoot, terminalId, "artikel.part"), "x");
    fs.mkdirSync(path.join(jobsRoot, liveId), { recursive: true });
    fs.writeFileSync(path.join(jobsRoot, liveId, "artikel.part"), "x");
    fs.mkdirSync(path.join(jobsRoot, "no-such-job"), { recursive: true });
    rawClient(db)
      .prepare(
        `INSERT INTO job_checkpoints (job_kind, job_id, stage, v, cursor, updated_at)
         VALUES ('import', ?, 'downloading', 1, '{}', ?)`
      )
      .run(terminalId, Date.now());

    const { removedDirs } = reconcileStartupArtifacts(db, dir);

    expect(removedDirs).toBe(2);
    expect(fs.existsSync(path.join(jobsRoot, terminalId))).toBe(false);
    expect(fs.existsSync(path.join(jobsRoot, "no-such-job"))).toBe(false);
    expect(fs.existsSync(path.join(jobsRoot, liveId))).toBe(true);
    expect(getJobCheckpoints(db, "import", terminalId)).toHaveLength(0);
  });
});
