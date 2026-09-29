// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openLocalDb, closeLocalDb, rawClient, type LocalDb } from "@/db/local";
import { LocalStore, type LocalContext } from "@/lib/storage/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource, replaceChunks } from "@/lib/services/sources";
import { enqueueProcessingJob, claimProcessingJob } from "@/lib/services/processing-jobs";
import { setJobIntent } from "@/lib/services/job-control";
import { setSetting } from "@/lib/services/settings";
import { registerEmbeddingProfile } from "@/lib/services/embedding-profiles";
import { setCapabilitiesForTests } from "@/engine/capabilities";
import { startProcessingLoop } from "@/engine/jobs";
import { runProcessingJob } from "@/engine/processing";
import type { TranscribeFn } from "@/lib/ai/providers";

/**
 * Controllable transcription fake (slice 3d, S3 injection): the loop's shared
 * ffmpeg/transcription cap is observed through enter/exit events - real ffmpeg
 * and real transcription never run offline. Injected via the capabilities
 * test seam; the module-level @/lib/openai mock is gone.
 */
const transcribe = vi.hoisted(() => ({
  events: [] as string[],
  active: 0,
  maxActive: 0,
  release: null as null | (() => void),
}));

/** The injected TranscribeFn the loop hands the runner (S3 seam). */
function blockingTranscribe(): TranscribeFn {
  return async () => {
    transcribe.events.push("enter");
    transcribe.active += 1;
    transcribe.maxActive = Math.max(transcribe.maxActive, transcribe.active);
    await new Promise<void>((resolve) => {
      transcribe.release = resolve;
    });
    transcribe.active -= 1;
    transcribe.events.push("exit");
    return { text: "Reden ist Silber, Schweigen ist Gold." };
  };
}

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

describe("engine job pool (desktop-workers-plan slice 3d)", () => {
  /** Deterministic fake embeddings (same seam as the vector-index tests). */
  const axis = (n: number, i: number): Buffer => {
    const v = new Float32Array(n);
    v[i % n] = 1;
    return Buffer.from(v.buffer);
  };

  async function waitUntil(cond: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > timeoutMs) throw new Error(`Zeitueberschreitung beim Warten auf: ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async function storeFile(name: string, contentType: string, content: string): Promise<string> {
    const file = await ctx.store.save(Buffer.from(content, "utf-8"), { fileName: name, contentType });
    return file.id;
  }

  /** Text upload whose original is on disk, so the real pipeline completes. */
  async function createTextJobWithStorage(content: string): Promise<{ jobId: string; sourceId: string }> {
    const storageId = await storeFile("notizen.txt", "text/plain", content);
    const sourceId = await createSource(db, {
      ownerId: "local", notebookId, fileName: "notizen.txt", fileType: "text/plain",
      fileSize: content.length, storageId,
    });
    const jobId = enqueueProcessingJob(db, { ownerId: "local", sourceId, notebookId });
    return { jobId, sourceId };
  }

  async function createMediaJob(fileName: string): Promise<{ jobId: string; sourceId: string }> {
    const storageId = await storeFile(fileName, "audio/mpeg", "fake-audio-bytes");
    const sourceId = await createSource(db, {
      ownerId: "local", notebookId, fileName, fileType: "audio/mpeg",
      fileSize: 16, storageId,
    });
    const jobId = enqueueProcessingJob(db, { ownerId: "local", sourceId, notebookId });
    return { jobId, sourceId };
  }

  function jobRow(jobId: string): { status: string } {
    return rawClient(db)
      .prepare(`SELECT status FROM processing_jobs WHERE id = ?`)
      .get(jobId) as { status: string };
  }

  function indexedForNotebook(notebook: string, profileId: string): number {
    return (rawClient(db).prepare(
      `SELECT COUNT(*) AS n FROM chunk_embeddings ce JOIN chunks c ON c.id = ce.chunk_id
       WHERE c.notebook_id = ? AND ce.profile_id = ? AND ce.status = 'indexed'`
    ).get(notebook, profileId) as { n: number }).n;
  }

  async function seedUnindexedChunks(targetNotebook: string, count: number): Promise<void> {
    const sourceId = await createSource(db, {
      ownerId: "local", notebookId: targetNotebook, fileName: "bulk.txt",
      fileType: "text/plain", fileSize: 1,
    });
    replaceChunks(db, {
      ownerId: "local", sourceId, notebookId: targetNotebook,
    }, Array.from({ length: count }, (_, i) => `Bulkinhalt ${i}`));
  }

  afterEach(() => {
    setCapabilitiesForTests(null);
  });

  it("mass indexing defers while an upload is pending/running, and catches up when idle", async () => {
    const profile = await registerEmbeddingProfile(db, {
      provider: "test", model: "pool", revision: "1", dimension: 8, pooling: "mean",
    });
    await setSetting(db, "retrieval.activeProfile", profile._id);

    let embedCalls = 0;
    setCapabilitiesForTests({
      chat: async () => ({ text: "chat", provider: "test", model: "test" }),
      chatProvider: { kind: "remote", label: "Test" },
      chatProviderKind: "remote",
      embed: async (texts) => {
        embedCalls += texts.length;
        return texts.map((_, i) => axis(8, i));
      },
    });

    // chunks lacking embeddings in a second notebook - the sweep's workload
    const bulk = await createNotebook(db, { ownerId: "local", title: "Bulk" });
    await seedUnindexedChunks(bulk, 5);

    // a slow upload: held at the first stage boundary until the test releases it
    const { jobId } = await createTextJobWithStorage("Notizinhalt, der gechunkpt wird.");
    let release: (() => void) | null = null;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const stop = startProcessingLoop(ctx, 40, {
      processingOpts: (id) => (id === jobId ? { beforeStage: async () => { await held; } } : undefined),
    });

    await waitUntil(() => jobRow(jobId).status === "running", "Upload uebernommen");
    // several ticks pass while the upload occupies its lane: no indexing starts
    await new Promise((r) => setTimeout(r, 120));
    expect(embedCalls).toBe(0);
    expect(indexedForNotebook(bulk, profile._id)).toBe(0);

    release!();
    await waitUntil(() => indexedForNotebook(bulk, profile._id) === 5, "Index aufgeholt");
    expect(embedCalls).toBeGreaterThanOrEqual(5);
    stop();
  });

  it("the loop runs two uploads concurrently but never two ffmpeg extractions (injected transcriber)", async () => {
    // a text upload held mid-run + two media uploads: the text upload and the
    // first audio file occupy the two upload lanes at once, while the shared
    // ffmpeg/transcription cap holds the second audio file back. The fake
    // transcriber rides the capabilities test seam — proof the runner uses the
    // INJECTED transcribe, not a module import.
    const a = await createTextJobWithStorage("Textquelle laeuft parallel.");
    const m1 = await createMediaJob("ton-eins.mp3");
    const m2 = await createMediaJob("ton-zwei.mp3");

    let releaseText: (() => void) | null = null;
    const textHeld = new Promise<void>((r) => {
      releaseText = r;
    });
    setCapabilitiesForTests({
      chat: async () => ({ text: "chat", provider: "test", model: "test" }),
      chatProvider: { kind: "remote", label: "Test" },
      chatProviderKind: "remote",
      transcribe: blockingTranscribe(),
    });
    const stop = startProcessingLoop(ctx, 40, {
      processingOpts: (id) => (id === a.jobId ? { beforeStage: async () => { await textHeld; } } : undefined),
    });

    // two uploads in flight at once: the held text upload AND one media job
    await waitUntil(() => transcribe.events.length > 0, "erste Transkription gestartet");
    expect(jobRow(a.jobId).status).toBe("running");
    const mediaRunning = [m1, m2].filter((m) => jobRow(m.jobId).status === "running").length;
    expect(mediaRunning).toBe(1);
    expect([m1, m2].some((m) => jobRow(m.jobId).status === "pending")).toBe(true);

    // while the first extraction/transcription runs, the second media job is
    // never claimed - several ticks confirm this
    await new Promise((r) => setTimeout(r, 120));
    expect(transcribe.events).toEqual(["enter"]);

    transcribe.release!();
    await waitUntil(() => transcribe.events.length >= 3, "zweite Transkription nach der ersten");
    expect(transcribe.events[1]).toBe("exit");

    transcribe.release!();
    releaseText!();
    await waitUntil(
      () =>
        jobRow(a.jobId).status === "completed" &&
        jobRow(m1.jobId).status === "completed" &&
        jobRow(m2.jobId).status === "completed",
      "alle Uploads abgeschlossen"
    );
    expect(transcribe.maxActive).toBe(1);
    stop();
  });

  it("a crashed lane job (throw) does not stall the sibling lanes on later ticks", async () => {
    // real source rows (FK); the injected runner never reads them
    const s1 = await createSource(db, {
      ownerId: "local", notebookId, fileName: "absturz.txt", fileType: "text/plain", fileSize: 1,
    });
    const j1 = enqueueProcessingJob(db, { ownerId: "local", sourceId: s1, notebookId });
    const j2 = enqueueProcessingJob(db, { ownerId: "local", sourceId: s1, notebookId });
    const seen: string[] = [];
    const stop = startProcessingLoop(ctx, 40, {
      processingRunner: async (_ctx, job) => {
        seen.push(job.id);
        if (seen.length === 1) throw new Error("Kanalabsturz (Test)");
        return "ok";
      },
    });

    await waitUntil(() => seen.length >= 2, "zweiter Job nach dem Absturz uebernommen");
    expect(seen[0]).toBe(j1);
    expect(seen).toContain(j2);
    stop();
  });

  it("global pause (scheduler.paused) stops all claims and survives an engine restart", async () => {
    const { jobId } = await createTextJobWithStorage("Pausierte Quelle.");
    await setSetting(db, "scheduler.paused", true);

    const stop1 = startProcessingLoop(ctx, 40);
    await new Promise((r) => setTimeout(r, 200));
    expect(jobRow(jobId).status).toBe("pending");
    stop1();

    // simulated restart: a fresh loop instance over the same data dir - the
    // pause is a settings row, so the fresh instance must still honor it
    const stop2 = startProcessingLoop(ctx, 40);
    await new Promise((r) => setTimeout(r, 200));
    expect(jobRow(jobId).status).toBe("pending");
    stop2();

    await setSetting(db, "scheduler.paused", false);
    const stop3 = startProcessingLoop(ctx, 40);
    await waitUntil(() => jobRow(jobId).status === "completed", "Arbeit laeuft nach Aufhebung weiter");
    stop3();
  });
});
