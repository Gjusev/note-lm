import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLocalDb, closeLocalDb, fastForwardForTests, rawClient } from "@/db/local";
import { LocalStore } from "@/lib/storage/local";
import {
  createNotebook,
  getNotebook,
  listNotebooks,
  removeNotebook,
  updateNotebook,
} from "@/lib/services/notebooks";
import {
  createSource,
  getSource,
  listSourcesByNotebook,
  replaceChunks,
  removeSource,
  getChunksBySource,
  updateSourceStatus,
} from "@/lib/services/sources";
import { createMessage, listMessagesByNotebook, clearMessagesByNotebook } from "@/lib/services/messages";
import { createNote, listNotesByNotebook, updateNote, removeNote } from "@/lib/services/notes";
import {
  requestGeneration,
  listMaterialsByNotebook,
  updateMaterial,
  removeMaterial,
} from "@/lib/services/learning-materials";
import {
  createImportJob,
  claimImportJob,
  heartbeatImportJob,
  updateImportJobPhase,
  failImportJob,
  completeImportJob,
  cancelImportJob,
  retryImportJob,
  listImportJobsByNotebook,
  getImportJob,
} from "@/lib/services/import-jobs";
import { enqueueProcessingJob, claimProcessingJob } from "@/lib/services/processing-jobs";
import {
  setJobCheckpoint,
  getJobCheckpoints,
  deleteJobCheckpoints,
} from "@/lib/services/job-control";
import { getOrCreateProfile } from "@/lib/services/profile";
import { searchChunks } from "@/lib/services/search";
import {
  registerEmbeddingProfile,
  getEmbeddingProfile,
} from "@/lib/services/embedding-profiles";

let dir: string;
let db: ReturnType<typeof openLocalDb>;
let store: LocalStore;
let notebookId: string;
const OWNER = "local";

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-test-"));
  db = openLocalDb(dir);
  store = new LocalStore(db, dir);
  notebookId = await createNotebook(db, { ownerId: OWNER, title: "NB", description: "d" });
});

afterEach(() => {
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("local db bootstrap", () => {
  it("applies migrations idempotently across reopens", () => {
    const version = rawClient(db).pragma("user_version", { simple: true });
    expect(version).toBeGreaterThan(0);
    const db2 = openLocalDb(dir); // same dir, already migrated
    expect(rawClient(db2).pragma("user_version", { simple: true })).toBe(version);
    closeLocalDb(db2);
  });

  it("creates the local profile once", async () => {
    const p1 = await getOrCreateProfile(db);
    const p2 = await getOrCreateProfile(db);
    expect(p1.id).toBe("local");
    expect(p2.id).toBe(p1.id);
  });
});

describe("notebook + dependents", () => {
  it("cruds notebooks with updatedAt ordering", async () => {
    const id2 = await createNotebook(db, { ownerId: OWNER, title: "Zweites" });
    await new Promise((r) => setTimeout(r, 3)); // distinct updatedAt ms
    await updateNotebook(db, id2, { title: "Neu" });
    const list = await listNotebooks(db, OWNER);
    expect(list).toHaveLength(2);
    const updated = await getNotebook(db, id2);
    expect(updated?.title).toBe("Neu");
    // most recently updated first
    expect(list[0]._id).toBe(id2);
    expect(list[0].updatedAt).toBeGreaterThan(list[1].updatedAt);
  });

  it("cascades delete to sources/chunks/messages/notes/materials/jobs and removes files", async () => {
    const sourceId = await createSource(db, {
      ownerId: OWNER,
      notebookId,
      fileName: "a.txt",
      fileType: "text/plain",
      fileSize: 3,
    });
    await replaceChunks(db, { ownerId: OWNER, sourceId, notebookId }, ["one", "two"]);
    await createMessage(db, { ownerId: OWNER, notebookId, role: "user", content: "hi" });
    await createNote(db, { ownerId: OWNER, notebookId, title: "n", content: "c" });
    const materialId = await requestGeneration(db, { ownerId: OWNER, notebookId, type: "summary" });
    const file = await store.save(Buffer.from("audio-bytes"), { fileName: "pod.mp3", contentType: "audio/mpeg" });
    await updateMaterial(db, materialId, { status: "completed", audioFileId: file.id });
    await enqueueProcessingJob(db, { ownerId: OWNER, sourceId, notebookId });
    await createImportJob(db, {
      ownerId: OWNER, notebookId, url: "https://x.test/a", provider: "web", kind: "page", resourceKey: "web:https://x.test/a",
    });

    await removeNotebook(db, store, notebookId);

    const sqlite = rawClient(db);
    for (const table of ["sources", "chunks", "messages", "notes", "learning_materials", "import_jobs", "processing_jobs", "files"]) {
      const n = (sqlite.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
      expect(n, table).toBe(0);
    }
    expect(fs.existsSync(path.join(dir, file.path))).toBe(false);
  });
});

describe("sources + chunks", () => {
  it("replaces chunks idempotently and keeps ordering", async () => {
    const sourceId = await createSource(db, {
      ownerId: OWNER, notebookId, fileName: "a.txt", fileType: "text/plain", fileSize: 3,
    });
    await replaceChunks(db, { ownerId: OWNER, sourceId, notebookId }, ["a", "b", "c"]);
    await replaceChunks(db, { ownerId: OWNER, sourceId, notebookId }, ["x", "y"]);
    const chunks = await getChunksBySource(db, sourceId);
    expect(chunks.map((c) => c.content)).toEqual(["x", "y"]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
  });

  it("deletes the source with its file", async () => {
    const file = await store.save(Buffer.from("abc"), { fileName: "a.txt", contentType: "text/plain" });
    const sourceId = await createSource(db, {
      ownerId: OWNER, notebookId, fileName: "a.txt", fileType: "text/plain", fileSize: 3, storageId: file.id,
    });
    await removeSource(db, store, sourceId);
    expect(await getSource(db, sourceId)).toBeNull();
    expect(await store.get(file.id)).toBeNull();
    expect(fs.existsSync(path.join(dir, file.path))).toBe(false);
  });
});

describe("messages / notes / materials", () => {
  it("roundtrips citations JSON", async () => {
    await createMessage(db, {
      ownerId: OWNER, notebookId, role: "assistant", content: "antwort",
      citations: [{ sourceId: "s1", chunkIndex: 2, text: "zitat" }],
    });
    const list = await listMessagesByNotebook(db, notebookId);
    expect(list[0].citations).toEqual([{ sourceId: "s1", chunkIndex: 2, text: "zitat" }]);
    await clearMessagesByNotebook(db, notebookId);
    expect(await listMessagesByNotebook(db, notebookId)).toHaveLength(0);
  });

  it("manages notes and materials with audio file cleanup", async () => {
    const noteId = await createNote(db, { ownerId: OWNER, notebookId, title: "t", content: "c" });
    await updateNote(db, noteId, { content: "c2" });
    expect((await listNotesByNotebook(db, notebookId))[0].content).toBe("c2");
    await removeNote(db, noteId);
    expect(await listNotesByNotebook(db, notebookId)).toHaveLength(0);

    const materialId = await requestGeneration(db, { ownerId: OWNER, notebookId, type: "podcastSummary" });
    const file = await store.save(Buffer.from("mp3"), { fileName: "p.mp3", contentType: "audio/mpeg" });
    await updateMaterial(db, materialId, { status: "completed", audioFileId: file.id });
    const materials = await listMaterialsByNotebook(db, notebookId);
    expect(materials[0].audioStorageId).toBe(file.id); // wire name preserved
    await removeMaterial(db, store, materialId);
    expect(await store.get(file.id)).toBeNull();
  });
});

describe("import job lease machine (port of convex/importJobs.ts)", () => {
  // function, not object literal: notebookId is only assigned in beforeEach
  const baseJob = () => ({
    ownerId: OWNER,
    notebookId,
    url: "https://x.test/page",
    provider: "web",
    kind: "page",
    resourceKey: "web:https://x.test/page",
  });

  it("dedups an active job per notebook+resource", async () => {
    const first = await createImportJob(db, baseJob());
    const second = await createImportJob(db, baseJob());
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.jobId).toBe(first.jobId);
  });

  it("claims once, fences a second claimant, heartbeats", () => {
    return (async () => {
      const { jobId } = await createImportJob(db, baseJob());
      const job = claimImportJob(db)!;
      expect(job._id).toBe(jobId);
      expect(job.status).toBe("inspecting");
      expect(job.attempts).toBe(1);
      expect(job.leaseToken).toBeTruthy();

      expect(claimImportJob(db)).toBeNull(); // lease held, nothing due

      expect(heartbeatImportJob(db, jobId, job.leaseToken!)).toBe(true);
      expect(heartbeatImportJob(db, jobId, "wrong-token")).toBe(false);
    })();
  });

  it("updatePhase is fenced by token and running status", async () => {
    const { jobId } = await createImportJob(db, baseJob());
    const job = claimImportJob(db)!;
    expect(updateImportJobPhase(db, jobId, "wrong", "downloading")).toBe(false);
    expect(updateImportJobPhase(db, jobId, job.leaseToken!, "downloading")).toBe(true);

    await cancelImportJob(db, jobId);
    // stale worker write after user cancel: fenced
    expect(updateImportJobPhase(db, jobId, job.leaseToken!, "processing")).toBe(false);
    expect((await getImportJob(db, jobId))!.status).toBe("cancelled");
  });

  it("fail transient requeues with backoff, permanent fails after max attempts", async () => {
    const { jobId } = await createImportJob(db, baseJob());
    for (let attempt = 1; attempt <= 3; attempt++) {
      const job = claimImportJob(db)!;
      expect(job.attempts).toBe(attempt);
      await failImportJob(db, jobId, job.leaseToken!, {
        errorCode: "network", errorMessage: "boom", transient: true,
      });
      if (attempt < 3) {
        const j = (await getImportJob(db, jobId))!;
        expect(j.status).toBe("queued");
        expect(j.nextAttemptAt).toBeGreaterThan(Date.now());
        fastForwardForTests(db); // pretend backoff elapsed
      }
    }
    const j = (await getImportJob(db, jobId))!;
    expect(j.status).toBe("failed");
    expect(j.attempts).toBe(3);
    expect(j.errorCode).toBe("network");

    await retryImportJob(db, jobId);
    expect((await getImportJob(db, jobId))!.status).toBe("queued");
  });

  it("complete is idempotent: reuses source, replaces chunks, never duplicates", async () => {
    const { jobId } = await createImportJob(db, { ...baseJob(), externalId: "ext-1" });
    const job = claimImportJob(db)!;
    const res = await completeImportJob(db, jobId, job.leaseToken!, {
      fileName: "Seite", fileType: "text/html", fileSize: 100, url: baseJob().url,
      provider: "web", externalId: "ext-1",
    }, [
      { content: "c1", chunkIndex: 0 },
      { content: "c2", chunkIndex: 1 },
    ]);
    expect(res.ok).toBe(true);
    const sourceId = res.sourceId!;

    // re-import same resource → new job reuses the source, replaces chunks
    const second = await createImportJob(db, { ...baseJob(), externalId: "ext-1" });
    expect(second.deduped).toBe(false);
    const job2 = claimImportJob(db)!;
    const res2 = await completeImportJob(db, second.jobId, job2.leaseToken!, {
      fileName: "Seite", fileType: "text/html", fileSize: 120, url: baseJob().url,
      provider: "web", externalId: "ext-1",
    }, [{ content: "neu", chunkIndex: 0 }]);
    expect(res2.sourceId).toBe(sourceId);

    const sources = await listSourcesByNotebook(db, notebookId);
    expect(sources).toHaveLength(1);
    expect(sources[0].fileSize).toBe(120);
    expect((await getChunksBySource(db, sourceId)).map((c) => c.content)).toEqual(["neu"]);
  });

  it("reclaims a job whose worker died (lease expiry)", async () => {
    const { jobId } = await createImportJob(db, baseJob());
    const dead = claimImportJob(db)!;
    expect(claimImportJob(db)).toBeNull(); // lease still valid
    fastForwardForTests(db); // lease expires
    const revived = claimImportJob(db)!;
    expect(revived._id).toBe(jobId);
    expect(revived.attempts).toBe(2);
    expect(revived.leaseToken).not.toBe(dead.leaseToken);
    // dead worker's write is fenced by the old token
    expect(updateImportJobPhase(db, jobId, dead.leaseToken!, "processing")).toBe(false);
  });

  it("lists jobs by notebook newest-first", async () => {
    await createImportJob(db, baseJob());
    await createImportJob(db, { ...baseJob(), resourceKey: "web:https://x.test/b", url: "https://x.test/b" });
    const jobs = await listImportJobsByNotebook(db, notebookId);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].createdAt).toBeGreaterThanOrEqual(jobs[1].createdAt);
  });
});

describe("processing queue (manual uploads)", () => {
  it("claims once and reclaims after crash", async () => {
    const sourceId = await createSource(db, {
      ownerId: OWNER, notebookId, fileName: "x.pdf", fileType: "application/pdf", fileSize: 9,
    });
    await enqueueProcessingJob(db, { ownerId: OWNER, sourceId, notebookId });
    const job = claimProcessingJob(db)!;
    expect(job.sourceId).toBe(sourceId);
    expect(job.status).toBe("running");
    expect(claimProcessingJob(db)).toBeNull();
    fastForwardForTests(db);
    const revived = claimProcessingJob(db)!;
    expect(revived.attempts).toBe(2);
  });
});

describe("FTS5 search", () => {
  it("finds chunks by BM25, scoped to notebook, updated on delete", async () => {
    const otherNotebook = await createNotebook(db, { ownerId: OWNER, title: "Other" });
    const s1 = await createSource(db, { ownerId: OWNER, notebookId, fileName: "a", fileType: "text/plain", fileSize: 1 });
    const s2 = await createSource(db, { ownerId: OWNER, notebookId: otherNotebook, fileName: "b", fileType: "text/plain", fileSize: 1 });
    await replaceChunks(db, { ownerId: OWNER, sourceId: s1, notebookId }, [
      "Quantenphysik beschreibt Teilchen und Wellen",
      "Kartoffeln wachsen unter der Erde",
    ]);
    await replaceChunks(db, { ownerId: OWNER, sourceId: s2, notebookId: otherNotebook }, ["Quantenphysik in anderem Notizbuch"]);
    await updateSourceStatus(db, s1, { status: "completed" });
    await updateSourceStatus(db, s2, { status: "completed" });

    const hits = searchChunks(db, notebookId, "quantenphysik wellen");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].content).toContain("Quantenphysik");
    expect(hits.every((h) => h.notebookId === notebookId)).toBe(true);

    await replaceChunks(db, { ownerId: OWNER, sourceId: s1, notebookId }, []);
    expect(searchChunks(db, notebookId, "quantenphysik")).toHaveLength(0);
  });

  it("sanitizes FTS syntax from user input", () => {
    expect(() => searchChunks(db, notebookId, 'foo" OR 1=1 --')).not.toThrow();
  });
});

describe("RAG schema — embedding profiles (issue #3)", () => {
  it("registers profiles idempotently by natural key and retrieves them", async () => {
    const first = await registerEmbeddingProfile(db, {
      provider: "llamacpp",
      model: "bge-small-en-v1.5",
      revision: "q8_0",
      dimension: 384,
      pooling: "mean",
      queryPrefix: "",
      docPrefix: "",
    });
    expect(first).toBeTruthy();

    // same natural key → same row, no duplicate
    const again = await registerEmbeddingProfile(db, {
      provider: "llamacpp",
      model: "bge-small-en-v1.5",
      revision: "q8_0",
      dimension: 384,
      pooling: "mean",
      queryPrefix: "",
      docPrefix: "",
    });
    expect(again._id).toBe(first._id);

    const fetched = await getEmbeddingProfile(db, first._id);
    expect(fetched?.dimension).toBe(384);
    expect(fetched?.model).toBe("bge-small-en-v1.5");

    // a different revision is a different profile (never mix vectors)
    const other = await registerEmbeddingProfile(db, {
      provider: "llamacpp",
      model: "bge-small-en-v1.5",
      revision: "f16",
      dimension: 384,
      pooling: "mean",
      queryPrefix: "",
      docPrefix: "",
    });
    expect(other._id).not.toBe(first._id);
  });

  it("treats a changed recipe (dimension/pooling/prefix) as a different profile — finding 3", async () => {
    const base = {
      provider: "llamacpp", model: "m", revision: "r", pooling: "mean",
      queryPrefix: "", docPrefix: "",
    };
    const a = await registerEmbeddingProfile(db, { ...base, dimension: 384 });
    const sameRecipe = await registerEmbeddingProfile(db, { ...base, dimension: 384 });
    expect(sameRecipe._id).toBe(a._id);

    const dim = await registerEmbeddingProfile(db, { ...base, dimension: 768 });
    expect(dim._id).not.toBe(a._id);
    const pool = await registerEmbeddingProfile(db, { ...base, dimension: 384, pooling: "cls" });
    expect(pool._id).not.toBe(a._id);
    const prefix = await registerEmbeddingProfile(db, { ...base, dimension: 384, queryPrefix: "q: " });
    expect(prefix._id).not.toBe(a._id);

    // nonsense dimensions are rejected loudly
    await expect(registerEmbeddingProfile(db, { ...base, dimension: 12.5 })).rejects.toThrow(/dimension/);
    await expect(registerEmbeddingProfile(db, { ...base, dimension: 0 })).rejects.toThrow(/dimension/);
  });

  it("keeps the bge and Qwen3-Embedding recipes separate — equal provider is not interchangeability (P3)", async () => {
    // the two production recipes: bge mean/384 vs Qwen3-Embedding last/1024
    // (T3-frozen: no instruct prefix on either)
    const bge = await registerEmbeddingProfile(db, {
      provider: "llamacpp", model: "bge-small-en-v1.5", revision: "q8_0",
      dimension: 384, pooling: "mean",
    });
    const qwen3 = await registerEmbeddingProfile(db, {
      provider: "llamacpp", model: "Qwen3-Embedding-0.6B", revision: "q8_0",
      dimension: 1024, pooling: "last",
    });
    expect(qwen3._id).not.toBe(bge._id);
    expect(qwen3.dimension).toBe(1024);
    expect(qwen3.pooling).toBe("last");

    // re-registering each recipe resolves to its OWN row, never the other's
    const bgeAgain = await registerEmbeddingProfile(db, {
      provider: "llamacpp", model: "bge-small-en-v1.5", revision: "q8_0",
      dimension: 384, pooling: "mean",
    });
    const qwen3Again = await registerEmbeddingProfile(db, {
      provider: "llamacpp", model: "Qwen3-Embedding-0.6B", revision: "q8_0",
      dimension: 1024, pooling: "last",
    });
    expect(bgeAgain._id).toBe(bge._id);
    expect(qwen3Again._id).toBe(qwen3._id);
  });

  it("still applies migrations idempotently alongside FTS5 (0002 included)", () => {
    const sqlite = rawClient(db);
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('embedding_profiles','chunk_embeddings','source_versions','retrieval_runs')")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).toEqual([
      "chunk_embeddings",
      "embedding_profiles",
      "retrieval_runs",
      "source_versions",
    ]);
    // reopen over the same dir: user_version must guard a clean no-op
    const db2 = openLocalDb(dir);
    expect(rawClient(db2).pragma("user_version", { simple: true })).toBe(
      rawClient(db).pragma("user_version", { simple: true })
    );
    closeLocalDb(db2);
  });
});

describe("job checkpoints (token-fenced, desktop-workers-plan slice 3a)", () => {
  it("checkpoint upsert survives a lost lease — a stale runner's checkpoint write is rejected, the new claimant's wins", async () => {
    const sourceId = await createSource(db, {
      ownerId: OWNER, notebookId, fileName: "ckpt.txt", fileType: "text/plain", fileSize: 3,
    });
    const jobId = enqueueProcessingJob(db, { ownerId: OWNER, sourceId, notebookId });
    const first = claimProcessingJob(db)!;
    const staleToken = first.leaseToken!;
    expect(setJobCheckpoint(db, "processing", jobId, staleToken, "extract", JSON.stringify({ offset: 1 }))).toBe(true);

    // crash: the lease expires and a new attempt reclaims the job (new token)
    fastForwardForTests(db);
    const second = claimProcessingJob(db)!;
    expect(second.leaseToken).not.toBe(staleToken);

    // the stale runner's write is rejected …
    expect(setJobCheckpoint(db, "processing", jobId, staleToken, "extract", JSON.stringify({ offset: 99 }))).toBe(false);
    // … while the new claimant's upsert lands
    expect(setJobCheckpoint(db, "processing", jobId, second.leaseToken!, "extract", JSON.stringify({ offset: 42 }))).toBe(true);
    expect(setJobCheckpoint(db, "processing", jobId, second.leaseToken!, "transcribe", JSON.stringify({ offset: 77 }))).toBe(true);

    // only the winning attempt's rows survive
    expect(getJobCheckpoints(db, "processing", jobId)).toEqual([
      { stage: "extract", cursor: JSON.stringify({ offset: 42 }), updatedAt: expect.any(Number) },
      { stage: "transcribe", cursor: JSON.stringify({ offset: 77 }), updatedAt: expect.any(Number) },
    ]);

    deleteJobCheckpoints(db, "processing", jobId);
    expect(getJobCheckpoints(db, "processing", jobId)).toEqual([]);
  });
});
