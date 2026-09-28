/**
 * E2E for the ingestion worker: the REAL worker process (tsx workers/ingestion.ts)
 * runs against a local resource HTTP server and an in-memory fake of the Convex
 * HTTP mutation API (mirroring convex/importJobs.ts: leases, fencing, retries,
 * idempotent completion). No OpenAI/ffmpeg/Azure needed — text and HTML paths only.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import http from "http";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { classifyUrl } from "@/lib/ingestion/identify";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const WORKER_KEY = "e2e-worker-key";
const LEASE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;

// ── Fake Convex state (mirrors convex/importJobs.ts) ──

interface Job {
  _id: string;
  ownerId: string;
  notebookId: string;
  url: string;
  provider: string;
  kind: string;
  resourceKey: string;
  externalId?: string;
  canonicalUrl?: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  leaseToken?: string;
  leaseExpiresAt?: number;
  errorCode?: string;
  errorMessage?: string;
  sourceId?: string;
  title?: string;
  createdAt: number;
}

interface SourceDoc {
  _id: string;
  ownerId: string;
  notebookId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  url: string;
  provider: string;
  externalId?: string;
  importedAt?: number;
}

interface ChunkDoc {
  sourceId: string;
  content: string;
  chunkIndex: number;
}

const jobs = new Map<string, Job>();
const sources = new Map<string, SourceDoc>();
const chunks = new Map<string, ChunkDoc[]>(); // by sourceId
let jobSeq = 0;
let sourceSeq = 0;

const RUNNING = ["inspecting", "awaiting_selection", "downloading", "processing"];
const owns = (j: Job, token: string) => j.leaseToken === token && RUNNING.includes(j.status);

function fakeCreate(args: Record<string, string>) {
  const active = [...jobs.values()].find(
    (j) => j.notebookId === args.notebookId && j.resourceKey === args.resourceKey && !["completed", "failed", "cancelled"].includes(j.status)
  );
  if (active) return { jobId: active._id, deduped: true };
  const id = `j${++jobSeq}`;
  const now = Date.now();
  jobs.set(id, {
    _id: id,
    ownerId: args.ownerId,
    notebookId: args.notebookId,
    url: args.url,
    provider: args.provider,
    kind: args.kind,
    resourceKey: args.resourceKey,
    externalId: args.externalId,
    canonicalUrl: args.canonicalUrl,
    status: "queued",
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    nextAttemptAt: now,
    createdAt: now,
  });
  return { jobId: id, deduped: false };
}

function fakeClaim(workerKey: string) {
  if (workerKey !== WORKER_KEY) throw new Error("Worker-Schlüssel ungültig");
  const now = Date.now();
  let job: Job | undefined = [...jobs.values()]
    .filter((j) => j.status === "queued" && j.nextAttemptAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!job) {
    job = [...jobs.values()].find(
      (j) => RUNNING.includes(j.status) && (j.leaseExpiresAt ?? 0) < now
    );
  }
  if (!job) return null;
  job.status = "inspecting";
  job.attempts += 1;
  job.leaseToken = `t${job._id}-${job.attempts}-${Math.random().toString(36).slice(2, 8)}`;
  job.leaseExpiresAt = now + LEASE_MS;
  return job;
}

function fakeHeartbeat(args: { jobId: string; leaseToken: string }) {
  const j = jobs.get(args.jobId);
  if (!j || !owns(j, args.leaseToken)) return false;
  j.leaseExpiresAt = Date.now() + LEASE_MS;
  return true;
}

function fakeUpdatePhase(args: { jobId: string; leaseToken: string; phase: string; title?: string }) {
  const j = jobs.get(args.jobId);
  if (!j || !owns(j, args.leaseToken)) return false;
  j.status = args.phase;
  if (args.title !== undefined) j.title = args.title;
  return true;
}

function fakeFail(args: { jobId: string; leaseToken: string; errorCode: string; errorMessage: string; transient: boolean; retryAfterMs?: number }) {
  const j = jobs.get(args.jobId);
  if (!j || j.leaseToken !== args.leaseToken) return false;
  const now = Date.now();
  if (args.transient && j.attempts < j.maxAttempts) {
    const backoff = args.retryAfterMs ?? Math.min(15_000 * 2 ** (j.attempts - 1), 10 * 60_000);
    j.status = "queued";
    j.nextAttemptAt = now + backoff;
  } else {
    j.status = "failed";
  }
  j.errorCode = args.errorCode;
  j.errorMessage = args.errorMessage;
  j.leaseToken = undefined;
  return true;
}

function fakeComplete(args: {
  jobId: string;
  leaseToken: string;
  source: { fileName: string; fileType: string; fileSize: number; url: string; provider: string; externalId?: string };
  chunks: { content: string; chunkIndex: number }[];
}) {
  const j = jobs.get(args.jobId);
  if (!j || !owns(j, args.leaseToken)) return { ok: false };
  const now = Date.now();

  let sourceId = j.sourceId;
  if (!sourceId && args.source.externalId) {
    sourceId = [...sources.values()].find(
      (s) => s.notebookId === j.notebookId && s.provider === args.source.provider && s.externalId === args.source.externalId
    )?._id;
  }
  if (sourceId) {
    const old = sources.get(sourceId)!;
    sources.set(sourceId, { ...old, ...args.source, importedAt: now });
    chunks.set(sourceId, []); // replaced, never duplicated
  } else {
    sourceId = `s${++sourceSeq}`;
    sources.set(sourceId, { _id: sourceId, ownerId: j.ownerId, notebookId: j.notebookId, ...args.source, importedAt: now });
  }
  chunks.set(sourceId, args.chunks.map((c) => ({ sourceId, ...c })));

  j.status = "completed";
  j.sourceId = sourceId;
  j.leaseToken = undefined;
  return { ok: true, sourceId };
}

function fakeCancel(args: { jobId: string }) {
  const j = jobs.get(args.jobId);
  if (!j) throw new Error("Job nicht gefunden");
  if (["completed", "failed", "cancelled"].includes(j.status)) throw new Error("Job ist bereits abgeschlossen");
  j.status = "cancelled";
  j.leaseToken = undefined;
  return true;
}

// Test hook: simulate lease expiry / backoff elapse without real waiting
function expireLeases() {
  for (const j of jobs.values()) if (RUNNING.includes(j.status)) j.leaseExpiresAt = 0;
}
function tickQueue() {
  for (const j of jobs.values()) if (j.status === "queued") j.nextAttemptAt = 0;
}

// ── Fake Convex HTTP server ──

let convexServer: http.Server;
let convexUrl = "";

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

    convexServer = http.createServer(async (req, res) => {
      const body = await new Promise<string>((r) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => r(data));
      });
      const { path: fnPath, args = {} } = JSON.parse(body);
      try {
        let value: unknown;
        if (fnPath === "importJobs:create") value = fakeCreate(args);
        else if (fnPath === "importJobs:claim") value = fakeClaim(args.workerKey);
        else if (fnPath === "importJobs:heartbeat") value = fakeHeartbeat(args);
        else if (fnPath === "importJobs:updatePhase") value = fakeUpdatePhase(args);
        else if (fnPath === "importJobs:fail") value = fakeFail(args);
        else if (fnPath === "importJobs:complete") value = fakeComplete(args);
        else if (fnPath === "importJobs:cancel") value = fakeCancel(args);
        else throw new Error(`unknown function ${fnPath}`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ value }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ errorMessage: (err as Error).message }));
      }
    });

    resourceServer.listen(0, "127.0.0.1", () => {
      convexServer.listen(0, "127.0.0.1", () => {
        resourceBase = `http://127.0.0.1:${(resourceServer.address() as { port: number }).port}`;
        convexUrl = `http://127.0.0.1:${(convexServer.address() as { port: number }).port}`;
        resolve();
      });
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
        CONVEX_URL: convexUrl,
        INTERNAL_API_KEY: "e2e-internal",
        WORKER_KEY,
        OPENAI_API_KEY: "dummy-e2e",
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

async function mutate(fnPath: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`${convexUrl}/api/mutation`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-key": "e2e-internal" },
    body: JSON.stringify({ path: fnPath, args }),
  });
  return (await res.json()) as { value: unknown };
}

async function createJob(url: string): Promise<{ jobId: string; deduped: boolean }> {
  // Mirrors what POST /api/imports does: classify locally, then enqueue
  const classified = classifyUrl(url);
  const { value } = (await mutate("importJobs:create", {
    ownerId: "u1",
    notebookId: "nb1",
    url,
    provider: classified.provider,
    kind: classified.kind,
    resourceKey: classified.resourceKey,
    ...(classified.externalId ? { externalId: classified.externalId } : {}),
    ...(classified.canonicalUrl ? { canonicalUrl: classified.canonicalUrl } : {}),
  })) as { value: { jobId: string; deduped: boolean } };
  return value;
}

function getJob(id: string): Job {
  return jobs.get(id)!;
}

async function waitFor(desc: string, predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      const jobStates = [...jobs.values()].map((j) => `${j._id}:${j.status}/${j.attempts}${j.errorCode ? `/${j.errorCode}` : ""}`).join(", ") || "none";
      const logTail = worker ? worker.logs.join("").split("\n").slice(-6).join("\n") : "no worker";
      throw new Error(`timeout waiting for: ${desc}\njobs: ${jobStates}\nworker tail:\n${logTail}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

const jobCompleted = (id: string) => getJob(id).status === "completed";
const jobFailed = (id: string) => getJob(id).status === "failed";
const sourcesForNotebook = () => [...sources.values()].filter((s) => s.notebookId === "nb1");

// ── Suite ──

let worker: WorkerHandle | null = null;

beforeAll(async () => {
  await startServers();
});

afterEach(async () => {
  if (worker) {
    await stopWorker(worker);
    worker = null;
  }
  jobs.clear();
  sources.clear();
  chunks.clear();
  rateLimitHits = 0;
});

afterAll(async () => {
  await new Promise<void>((r) => resourceServer.close(() => r()));
  await new Promise<void>((r) => convexServer.close(() => r()));
});

describe("ingestion worker e2e", () => {
  it("imports an HTML page into chunks with title and provenance", async () => {
    const { jobId } = await createJob(`${resourceBase}/page.html?utm=tracker`);
    worker = startWorker();
    await waitFor("job completed", () => jobCompleted(jobId));

    const job = getJob(jobId);
    const source = sources.get(job.sourceId!)!;
    expect(source.fileType).toBe("text/html");
    expect(source.fileName).toBe("E2E Testseite");
    expect(source.url).toBe(`${resourceBase}/page.html?utm=tracker`); // original URL kept
    expect(source.importedAt).toBeGreaterThan(0);

    const jobChunks = chunks.get(job.sourceId!)!;
    expect(jobChunks.length).toBeGreaterThan(0);
    expect(jobChunks[0].content).toContain("Artikelinhalt");
    expect(job.attempts).toBe(1);
  });

  it("imports a direct text file with unknown size", async () => {
    const { jobId } = await createJob(`${resourceBase}/document.txt`);
    worker = startWorker();
    await waitFor("job completed", () => jobCompleted(jobId));

    const source = sources.get(getJob(jobId).sourceId!)!;
    expect(source.fileType).toBe("text/plain");
    expect(chunks.get(source._id)!.length).toBeGreaterThan(0);
  });

  it("follows redirects within the same provider", async () => {
    const { jobId } = await createJob(`${resourceBase}/redirect-page`);
    worker = startWorker();
    await waitFor("job completed", () => jobCompleted(jobId));
    const source = sources.get(getJob(jobId).sourceId!)!;
    expect(source.fileType).toBe("text/html");
  });

  it("re-dispatches when a short link lands on a direct file", async () => {
    const { jobId } = await createJob(`${resourceBase}/redirect-to-file`);
    worker = startWorker();
    await waitFor("job completed", () => jobCompleted(jobId));

    const job = getJob(jobId);
    expect(worker.logs.join("")).toContain("REDISPATCH");
    const source = sources.get(job.sourceId!)!;
    expect(source.fileType).toBe("text/plain");
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
      tickQueue();
      await waitFor(
        `attempt ${i + 1} runs`,
        () => getJob(jobId).status !== "queued" || getJob(jobId).status === "failed",
        30_000
      );
      await waitFor(
        `attempt ${i + 1} ends`,
        () => ["queued", "failed"].includes(getJob(jobId).status),
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
    await waitFor("first attempt failed and requeued", () => getJob(jobId).status === "queued" && getJob(jobId).attempts === 1, 30_000);
    expect(getJob(jobId).errorCode).toBe("rate_limited");
    tickQueue(); // skip the 1s wait
    await waitFor("job completed", () => jobCompleted(jobId), 30_000);
    expect(getJob(jobId).attempts).toBe(2);
    expect(sources.get(getJob(jobId).sourceId!)!.fileType).toBe("text/plain");
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

    expect(sourcesForNotebook().length).toBe(1); // reused, not duplicated
    const job = getJob(second.jobId);
    expect(job.sourceId).toBe(getJob(first.jobId).sourceId);
    expect(chunks.get(job.sourceId!)!.length).toBe(chunks.get(getJob(first.jobId).sourceId!)!.length);
  });

  it("cancelling mid-download fences the stale worker write", async () => {
    const { jobId } = await createJob(`${resourceBase}/slow.html`);
    worker = startWorker();
    await waitFor("download started", () => getJob(jobId).status === "downloading");
    await mutate("importJobs:cancel", { jobId });

    // worker finishes its download, then its next phase write is rejected
    await waitFor("worker aborted", () => worker!.logs.join("").includes("ABORTED"), 30_000);
    await waitFor("cancel visible", () => getJob(jobId).status === "cancelled");
    expect(sourcesForNotebook().length).toBe(0);
  });

  it("a worker killed mid-download is recovered after lease expiry without duplicates", async () => {
    const { jobId } = await createJob(`${resourceBase}/slow.html`);
    worker = startWorker();
    await waitFor("download started", () => getJob(jobId).status === "downloading");

    // SIGKILL: no finally-cleanup, no fail() write — simulates a crash
    worker.proc.kill("SIGKILL");
    await worker.waitEnd();
    worker = null;

    expect(getJob(jobId).status).toBe("downloading"); // stuck, owned by dead worker

    expireLeases(); // simulate lease timeout
    worker = startWorker();
    await waitFor("job completed after recovery", () => jobCompleted(jobId), 30_000);

    const job = getJob(jobId);
    expect(job.attempts).toBe(2);
    expect(sourcesForNotebook().length).toBe(1);
    expect(chunks.get(job.sourceId!)!.length).toBeGreaterThan(0);
  });

  it("blocks cloud metadata addresses when the private-range policy is active", async () => {
    const { jobId } = await createJob("http://169.254.169.254/latest/meta-data/");
    worker = startWorker({ INGEST_ALLOW_PRIVATE: "0" });
    await waitFor("job failed", () => jobFailed(jobId));
    expect(getJob(jobId).errorCode).toBe("blocked");
    expect(sourcesForNotebook().length).toBe(0);
  });
});
