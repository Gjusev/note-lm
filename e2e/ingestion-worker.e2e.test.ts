/**
 * E2E for the local ingestion worker: the REAL worker process (tsx
 * workers/ingestion.ts) runs against a local resource HTTP server and the
 * real SQLite database in a temp data dir (leases, fencing, retries,
 * idempotent completion — pinned by the import-jobs service). No
 * OpenAI/ffmpeg/Azure needed — text and HTML paths only.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import http from "http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "child_process";
import { classifyUrl } from "@/lib/ingestion/identify";
import {
  openLocalDb,
  closeLocalDb,
  fastForwardForTests,
  type LocalDb,
} from "@/db/local";
import { LocalStore } from "@/lib/storage/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource, getChunksBySource, listSourcesByNotebook } from "@/lib/services/sources";
import {
  createImportJob,
  getImportJob,
  type ImportJobDoc,
} from "@/lib/services/import-jobs";
import {
  enqueueProcessingJob,
} from "@/lib/services/processing-jobs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MAX_ATTEMPTS = 3;

// ── Local state (mirrors what the API layer writes) ──

let dir: string;
let db: LocalDb;
let store: LocalStore;
let notebookId: string;
const OWNER = "local-e2e";

// ── Resource server ──

const PAGE_HTML = `<html><head><title>E2E Testseite</title></head><body><article>
${"Dies ist der Artikelinhalt der E2E-Testseite. ".repeat(8)}</article></body></html>`;
const DOC_TEXT = `E2E Dokument\n\n${"Zeile mit Inhalt für den Chunking-Test. ".repeat(20)}`;

let rateLimitHits = 0;
let resourceServer: http.Server;
let resourceBase = "";

function startServers() {
  return new Promise<void>((resolve) => {
    resourceServer = http.createServer((req, res) => {
      const pathname = new URL(req.url!, `http://x`).pathname;
      switch (pathname) {
        case "/page.html":
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(PAGE_HTML);
          break;
        case "/document.txt":
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
          res.end(DOC_TEXT);
          break;
        case "/redirect-page":
          res.writeHead(302, { location: "/page.html" });
          res.end();
          break;
        case "/redirect-to-file":
          res.writeHead(302, { location: "/document.txt" });
          res.end();
          break;
        case "/redirect-loop-a":
          res.writeHead(302, { location: "/redirect-loop-b" });
          res.end();
          break;
        case "/redirect-loop-b":
          res.writeHead(302, { location: "/redirect-loop-a" });
          res.end();
          break;
        case "/fake.mp3":
          res.writeHead(200, { "content-type": "audio/mpeg" });
          res.end("<!DOCTYPE html><html><body>kein Audio, sondern HTML</body></html>");
          break;
        case "/huge.mp3": {
          const total = 2 * 1024 * 1024; // INGEST_MAX_AUDIO_MB=1 in the worker env
          res.writeHead(200, { "content-type": "audio/mpeg", "content-length": String(total) });
          const zeros = Buffer.alloc(64 * 1024);
          let sent = 0;
          const push = () => {
            while (sent < total) {
              const n = Math.min(zeros.length, total - sent);
              sent += n;
              if (!res.write(zeros.subarray(0, n))) {
                res.once("drain", push);
                return;
              }
            }
            res.end();
          };
          push();
          break;
        }
        case "/slow.html": {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          let i = 0;
          const drip = () => {
            if (i++ < 30) {
              res.write(`<p>Chunk ${i} ${"Inhalt ".repeat(20)}</p>`);
              setTimeout(drip, 150);
            } else {
              res.end();
            }
          };
          drip();
          break;
        }
        case "/truncated.txt": {
          res.writeHead(200, { "content-type": "text/plain", "content-length": "10000" });
          res.write(DOC_TEXT.slice(0, 100));
          setTimeout(() => res.destroy(), 50);
          break;
        }
        case "/rate-limited.txt":
          if (rateLimitHits++ === 0) {
            res.writeHead(429, { "retry-after": "1" });
            res.end("later");
          } else {
            res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
            res.end(DOC_TEXT);
          }
          break;
        case "/notfound":
          res.writeHead(404);
          res.end("gone");
          break;
        default:
          res.writeHead(404);
          res.end("no route");
      }
    });

    resourceServer.listen(0, "127.0.0.1", () => {
      resourceBase = `http://127.0.0.1:${(resourceServer.address() as { port: number }).port}`;
      resolve();
    });
  });
}

// ── Worker process control ──

interface WorkerHandle {
  proc: ChildProcess;
  logs: string[];
  waitEnd(): Promise<void>;
}

function startWorker(envOverrides: Record<string, string> = {}): WorkerHandle {
  const proc = spawn(
    process.execPath,
    ["--import", "tsx", path.resolve(REPO_ROOT, "workers", "ingestion.ts")],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NOTELM_DATA_DIR: dir,
        INGEST_ALLOW_PRIVATE: "1",
        INGEST_POLL_MS: "500",
        INGEST_MAX_AUDIO_MB: "1",
        ...envOverrides,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const logs: string[] = [];
  proc.stdout!.on("data", (d) => logs.push(d.toString()));
  proc.stderr!.on("data", (d) => logs.push(d.toString()));
  return {
    proc,
    logs,
    waitEnd: () =>
      new Promise((resolve) => {
        if (proc.exitCode !== null) return resolve();
        proc.once("exit", () => resolve());
      }),
  };
}

async function stopWorker(w: WorkerHandle) {
  if (w.proc.exitCode !== null) return;
  w.proc.kill("SIGKILL");
  await w.waitEnd();
}

// ── Test helpers ──

async function createJob(url: string): Promise<{ jobId: string; deduped: boolean }> {
  // Mirrors what POST /api/imports does: classify locally, then enqueue
  const classified = classifyUrl(url);
  return createImportJob(db, {
    ownerId: OWNER,
    notebookId,
    url,
    provider: classified.provider,
    kind: classified.kind,
    resourceKey: classified.resourceKey,
    ...(classified.externalId ? { externalId: classified.externalId } : {}),
    ...(classified.canonicalUrl ? { canonicalUrl: classified.canonicalUrl } : {}),
  });
}

function getJob(id: string): ImportJobDoc {
  return getImportJob(db, id)!;
}

async function waitFor(desc: string, predicate: () => boolean | Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      const logTail = worker ? worker.logs.join("").split("\n").slice(-6).join("\n") : "no worker";
      throw new Error(`timeout waiting for: ${desc}\nworker tail:\n${logTail}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

const jobStatus = (id: string) => getImportJob(db, id)?.status;
const jobCompleted = (id: string) => jobStatus(id) === "completed";
const jobFailed = (id: string) => jobStatus(id) === "failed";
const sourcesForNotebook = () => listSourcesByNotebook(db, notebookId);

// ── Suite ──

let worker: WorkerHandle | null = null;

beforeAll(async () => {
  await startServers();
});

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-e2e-"));
  db = openLocalDb(dir);
  store = new LocalStore(db, dir);
  notebookId = await createNotebook(db, { ownerId: OWNER, title: "E2E" });
  rateLimitHits = 0;
});

afterEach(async () => {
  if (worker) {
    await stopWorker(worker);
    worker = null;
  }
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await new Promise<void>((r) => resourceServer.close(() => r()));
});

describe("ingestion worker e2e (SQLite)", () => {
  it("imports an HTML page into chunks with title, provenance and stored original", async () => {
    const { jobId } = await createJob(`${resourceBase}/page.html?utm=tracker`);
    worker = startWorker();
    await waitFor("job completed", () => jobCompleted(jobId));

    const job = getJob(jobId);
    const sources = sourcesForNotebook();
    expect(sources).toHaveLength(1);
    const source = sources[0];
    expect(source.fileType).toBe("text/html");
    expect(source.url).toBe(`${resourceBase}/page.html?utm=tracker`); // original URL kept
    expect((source as { importedAt?: number }).importedAt).toBeGreaterThan(0);

    const storedSource = listSourcesByNotebook(db, notebookId)[0];
    expect(storedSource.fileName).toBe("E2E Testseite");
    expect(storedSource.storageId).toBeTruthy(); // original persisted to disk
    const file = await store.get(storedSource.storageId!);
    expect(file).toBeTruthy();
    expect(fs.existsSync(path.join(dir, file!.path))).toBe(true);

    const chunks = getChunksBySource(db, job.sourceId!);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain("Artikelinhalt");
    expect(job.attempts).toBe(1);
  });

  it("imports a direct text file with unknown size", async () => {
    const { jobId } = await createJob(`${resourceBase}/document.txt`);
    worker = startWorker();
    await waitFor("job completed", () => jobCompleted(jobId));

    const job = getJob(jobId);
    const sources = sourcesForNotebook();
    expect(sources[0].fileType).toBe("text/plain");
    expect(getChunksBySource(db, job.sourceId!).length).toBeGreaterThan(0);
  });

  it("follows redirects within the same provider", async () => {
    const { jobId } = await createJob(`${resourceBase}/redirect-page`);
    worker = startWorker();
    await waitFor("job completed", () => jobCompleted(jobId));
    expect(sourcesForNotebook()[0].fileType).toBe("text/html");
  });

  it("re-dispatches when a short link lands on a direct file", async () => {
    const { jobId } = await createJob(`${resourceBase}/redirect-to-file`);
    worker = startWorker();
    await waitFor("job completed", () => jobCompleted(jobId));

    expect(worker.logs.join("")).toContain("REDISPATCH");
    expect(sourcesForNotebook()[0].fileType).toBe("text/plain");
  });

  it("fails cleanly on redirect loops", async () => {
    const { jobId } = await createJob(`${resourceBase}/redirect-loop-a`);
    worker = startWorker();
    await waitFor("job failed", () => jobFailed(jobId), 30_000);
    expect(getJob(jobId).errorCode).toBe("bad_content");
    expect(sourcesForNotebook().length).toBe(0);
  });

  it("rejects HTML masquerading as audio and stores nothing", async () => {
    const { jobId } = await createJob(`${resourceBase}/fake.mp3`);
    worker = startWorker();
    await waitFor("job failed", () => jobFailed(jobId));
    const job = getJob(jobId);
    expect(job.errorCode).toBe("bad_content");
    expect(job.errorMessage).toContain("HTML");
    expect(sourcesForNotebook().length).toBe(0);
  });

  it("enforces the size limit while streaming", async () => {
    const { jobId } = await createJob(`${resourceBase}/huge.mp3`);
    worker = startWorker();
    await waitFor("job failed", () => jobFailed(jobId), 30_000);
    expect(getJob(jobId).errorCode).toBe("too_large");
    expect(sourcesForNotebook().length).toBe(0);
  });

  it("marks 404 resources as permanently unavailable", async () => {
    const { jobId } = await createJob(`${resourceBase}/notfound`);
    worker = startWorker();
    await waitFor("job failed", () => jobFailed(jobId));
    expect(getJob(jobId).errorCode).toBe("unavailable");
  });

  it("retries a truncated download, then fails after max attempts without a source", async () => {
    const { jobId } = await createJob(`${resourceBase}/truncated.txt`);
    worker = startWorker();
    // Each failed attempt is requeued with a real backoff — fast-forward it
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      tickJobs();
      await waitFor(
        `attempt ${i + 1} runs`,
        () => ["inspecting", "downloading", "processing", "failed"].includes(getImportJob(db, jobId)?.status ?? ""),
        30_000
      );
      await waitFor(
        `attempt ${i + 1} ends`,
        () => ["queued", "failed"].includes(getImportJob(db, jobId)?.status ?? ""),
        30_000
      );
      if (jobFailed(jobId)) break;
    }
    await waitFor("job failed", () => jobFailed(jobId), 30_000);

    const job = getJob(jobId);
    expect(job.attempts).toBe(MAX_ATTEMPTS);
    expect(sourcesForNotebook().length).toBe(0);
  });

  it("honours Retry-After on 429 and completes on the second attempt", async () => {
    const { jobId } = await createJob(`${resourceBase}/rate-limited.txt`);
    worker = startWorker();
    // first attempt → 429 → queued with nextAttemptAt ≈ now+1000ms
    await waitFor("first attempt failed and requeued", () => { const j = getImportJob(db, jobId); return j?.status === "queued" && j.attempts === 1; }, 30_000);
    expect(getJob(jobId).errorCode).toBe("rate_limited");
    tickJobs(); // skip the 1s wait
    await waitFor("job completed", () => jobCompleted(jobId), 30_000);
    expect(getJob(jobId).attempts).toBe(2);
    expect(sourcesForNotebook()[0].fileType).toBe("text/plain");
  });

  it("deduplicates concurrent jobs for the same resource", async () => {
    const first = await createJob(`${resourceBase}/page.html`);
    const second = await createJob(`${resourceBase}/page.html`);
    expect(second.deduped).toBe(true);
    expect(second.jobId).toBe(first.jobId);
  });

  it("re-importing the same resource reuses the source and replaces chunks", async () => {
    const first = await createJob(`${resourceBase}/page.html`);
    worker = startWorker();
    await waitFor("first completed", () => jobCompleted(first.jobId));
    await stopWorker(worker!);

    const second = await createJob(`${resourceBase}/page.html`);
    expect(second.deduped).toBe(false);
    worker = startWorker();
    await waitFor("second completed", () => jobCompleted(second.jobId));

    const sources = sourcesForNotebook();
    expect(sources.length).toBe(1); // reused, not duplicated
    const job = getJob(second.jobId);
    expect(job.sourceId).toBe(getJob(first.jobId).sourceId);
    expect(getChunksBySource(db, job.sourceId!).length).toBeGreaterThan(0);
  });

  it("cancelling mid-download fences the stale worker write", async () => {
    const { jobId } = await createJob(`${resourceBase}/slow.html`);
    worker = startWorker();
    await waitFor("download started", () => jobStatus(jobId) === "downloading");
    const { cancelImportJob } = await import("@/lib/services/import-jobs");
    cancelImportJob(db, jobId);

    // worker finishes its download, then its next phase write is rejected
    await waitFor("worker aborted", () => worker!.logs.join("").includes("ABORTED"), 30_000);
    await waitFor("cancel visible", () => jobStatus(jobId) === "cancelled");
    expect(sourcesForNotebook().length).toBe(0);
  });

  it("a worker killed mid-download is recovered after lease expiry without duplicates", async () => {
    const { jobId } = await createJob(`${resourceBase}/slow.html`);
    worker = startWorker();
    await waitFor("download started", () => jobStatus(jobId) === "downloading");

    // SIGKILL: no finally-cleanup, no fail() write — simulates a crash
    worker.proc.kill("SIGKILL");
    await worker.waitEnd();
    worker = null;

    expect(getImportJob(db, jobId)?.status).toBe("downloading"); // stuck, owned by dead worker

    fastForwardForTests(db); // simulate lease timeout
    worker = startWorker();
    await waitFor("job completed after recovery", () => jobCompleted(jobId), 30_000);

    const job = getJob(jobId);
    expect(job.attempts).toBe(2);
    const sources = sourcesForNotebook();
    expect(sources.length).toBe(1);
    expect(getChunksBySource(db, job.sourceId!).length).toBeGreaterThan(0);
  });

  it("blocks cloud metadata addresses when the private-range policy is active", async () => {
    const { jobId } = await createJob("http://169.254.169.254/latest/meta-data/");
    worker = startWorker({ INGEST_ALLOW_PRIVATE: "0" });
    await waitFor("job failed", () => jobFailed(jobId));
    expect(getJob(jobId).errorCode).toBe("blocked");
    expect(sourcesForNotebook().length).toBe(0);
  });

  it("processes a queued manual upload end-to-end (extract + chunk)", async () => {
    const file = await store.save(Buffer.from(DOC_TEXT, "utf-8"), {
      fileName: "upload.txt",
      contentType: "text/plain",
    });
    const sourceId = await createSource(db, {
      ownerId: OWNER,
      notebookId,
      fileName: "upload.txt",
      fileType: "text/plain",
      fileSize: Buffer.byteLength(DOC_TEXT),
      storageId: file.id,
    });
    enqueueProcessingJob(db, { ownerId: OWNER, sourceId, notebookId });

    worker = startWorker();
    await waitFor(
      "source completed",
      () => (sourcesForNotebook()[0] as { status?: string })?.status === "completed",
      30_000
    );
    const chunks = await getChunksBySource(db, sourceId);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain("Chunking-Test");
  });

  it("fails a queued upload whose original file is missing", async () => {
    const sourceId = await createSource(db, {
      ownerId: OWNER,
      notebookId,
      fileName: "ghost.txt",
      fileType: "text/plain",
      fileSize: 10,
      // no storageId — nothing on disk
    });
    enqueueProcessingJob(db, { ownerId: OWNER, sourceId, notebookId });

    worker = startWorker();
    await waitFor(
      "source errored",
      () => (sourcesForNotebook()[0] as { status?: string })?.status === "error",
      30_000
    );
    expect((listSourcesByNotebook(db, notebookId)[0] as { errorMessage?: string }).errorMessage).toContain("Originaldatei");
  });
});

/** Test hook: pretend backoff elapsed (queued jobs due immediately). */
function tickJobs() {
  fastForwardForTests(db);
}
