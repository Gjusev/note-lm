// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLocalDb, closeLocalDb } from "@/db/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource, replaceChunks } from "@/lib/services/sources";
import {
  vecExtensionAvailable,
  ensureVecTable,
  insertVector,
  vectorSearch,
  indexNotebookChunks,
} from "@/lib/services/vector-index";

let dir: string;
let db: ReturnType<typeof openLocalDb>;
let notebookId: string;
const OWNER = "local";

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-vec-"));
  db = openLocalDb(dir);
  notebookId = await createNotebook(db, { ownerId: OWNER, title: "Vec" });
});

afterEach(() => {
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Deterministic fake embeddings (issue #3 test rule): unit vectors on axes. */
const axis = (n: number, i: number): Buffer => {
  const v = new Float32Array(n);
  v[i % n] = 1;
  return Buffer.from(v.buffer);
};

describe("vector index (issue #3/#4 — vec0 via sqlite-vec)", () => {
  it("loads the extension and answers KNN scoped by notebook metadata", async () => {
    if (!(await vecExtensionAvailable(db))) {
      throw new Error("sqlite-vec extension not available — it is a dependency; this must not skip");
    }

    const other = await createNotebook(db, { ownerId: OWNER, title: "Other" });
    const s1 = await createSource(db, { ownerId: OWNER, notebookId, fileName: "a", fileType: "text/plain", fileSize: 1 });
    const s2 = await createSource(db, { ownerId: OWNER, notebookId: other, fileName: "b", fileType: "text/plain", fileSize: 1 });
    replaceChunks(db, { ownerId: OWNER, sourceId: s1, notebookId }, ["alpha", "beta", "gamma"]);
    replaceChunks(db, { ownerId: OWNER, sourceId: s2, notebookId: other }, ["other-notebook"]);

    const profile = { id: "p-axis-8", dimension: 8 };
    ensureVecTable(db, profile.id, profile.dimension);

    const chunks1 = (await import("@/lib/services/sources")).getChunksByNotebook(db, notebookId);
    const chunks2 = (await import("@/lib/services/sources")).getChunksByNotebook(db, other);
    for (const [i, c] of chunks1.entries()) {
      insertVector(db, profile.id, c._id, notebookId, axis(8, i), c.sourceId);
    }
    for (const c of chunks2) {
      insertVector(db, profile.id, c._id, other, axis(8, 0), c.sourceId);
    }

    // query near axis 0 → first chunk of THIS notebook, never the other one
    const hits = vectorSearch(db, profile.id, axis(8, 0), notebookId, 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chunkId).toBe(chunks1[0]._id);
    expect(hits.every((h) => h.notebookId === notebookId)).toBe(true);
    expect(hits[0].distance).toBeCloseTo(0, 5);

    // second query near axis 2 → the third chunk wins
    const hits2 = vectorSearch(db, profile.id, axis(8, 2), notebookId, 1);
    expect(hits2[0].chunkId).toBe(chunks1[2]._id);
  });

  it("indexes a notebook in batches and resumes where it stopped", async () => {
    if (!(await vecExtensionAvailable(db))) throw new Error("sqlite-vec missing");

    const { registerEmbeddingProfile } = await import("@/lib/services/embedding-profiles");
    const profile = await registerEmbeddingProfile(db, {
      provider: "test", model: "axis-idx", revision: "1", dimension: 8, pooling: "mean",
    });

    const source = await createSource(db, {
      ownerId: OWNER, notebookId, fileName: "big", fileType: "text/plain", fileSize: 1,
    });
    replaceChunks(
      db,
      { ownerId: OWNER, sourceId: source, notebookId },
      Array.from({ length: 7 }, (_, i) => `content number ${i}`)
    );

    const embed = async (texts: string[]): Promise<Buffer[]> =>
      texts.map((t) => axis(8, Number(t.match(/\d+/)?.[0] ?? 0)));

    // batch size 3 → runs index 7 chunks without re-embedding done work
    const first = await indexNotebookChunks(db, {
      profileId: profile._id,
      dimension: 8,
      notebookId,
      batchSize: 3,
      embed,
    });
    expect(first.indexed).toBe(3);
    await indexNotebookChunks(db, { profileId: profile._id, dimension: 8, notebookId, batchSize: 3, embed });
    const third = await indexNotebookChunks(db, { profileId: profile._id, dimension: 8, notebookId, batchSize: 3, embed });
    expect(third.indexed).toBe(1);
    // a fourth run is a no-op — resumable means never redoing indexed work
    const fourth = await indexNotebookChunks(db, { profileId: profile._id, dimension: 8, notebookId, batchSize: 3, embed });
    expect(fourth.indexed).toBe(0);

    // all 7 vectors answer KNN scoped to the notebook
    const all = vectorSearch(db, profile._id, axis(8, 5), notebookId, 10);
    expect(all).toHaveLength(7);
    expect(all[0].chunkId).toBeDefined();
  });

  it("purges ghost vectors on chunk replacement — deletion never consumes KNN slots (finding 4)", async () => {
    if (!(await vecExtensionAvailable(db))) throw new Error("sqlite-vec missing");
    const { registerEmbeddingProfile } = await import("@/lib/services/embedding-profiles");
    const { getChunksBySource, updateSourceStatus } = await import("@/lib/services/sources");
    const profile = await registerEmbeddingProfile(db, {
      provider: "test", model: "purge", revision: "1", dimension: 8, pooling: "mean",
    });

    const source = await createSource(db, {
      ownerId: OWNER, notebookId, fileName: "p", fileType: "text/plain", fileSize: 1,
    });
    replaceChunks(db, { ownerId: OWNER, sourceId: source, notebookId }, ["old one", "old two"]);
    await updateSourceStatus(db, source, { status: "completed" });

    const embed = async (texts: string[]): Promise<Buffer[]> =>
      texts.map(() => axis(8, 0));
    await indexNotebookChunks(db, { profileId: profile._id, dimension: 8, notebookId, batchSize: 10, embed });
    expect(vectorSearch(db, profile._id, axis(8, 0), notebookId, 10)).toHaveLength(2);

    // replacement deletes the old chunks → their vectors must vanish too
    replaceChunks(db, { ownerId: OWNER, sourceId: source, notebookId }, ["fresh content"]);
    const live = getChunksBySource(db, source);
    expect(vectorSearch(db, profile._id, axis(8, 0), notebookId, 10)).toHaveLength(0);

    // reindexing picks up only the new chunk (old work stays done/purged)
    const embed2 = async (texts: string[]): Promise<Buffer[]> => texts.map(() => axis(8, 0));
    const run = await indexNotebookChunks(db, {
      profileId: profile._id, dimension: 8, notebookId, batchSize: 10, embed: embed2,
    });
    expect(run.indexed).toBe(1);
    const hits = vectorSearch(db, profile._id, axis(8, 0), notebookId, 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].chunkId).toBe(live[0]._id);
  });

  it("discards embeddings for chunks deleted mid-flight (finding 4)", async () => {
    if (!(await vecExtensionAvailable(db))) throw new Error("sqlite-vec missing");
    const { registerEmbeddingProfile } = await import("@/lib/services/embedding-profiles");
    const { removeSource } = await import("@/lib/services/sources");
    const { LocalStore } = await import("@/lib/storage/local");
    const profile = await registerEmbeddingProfile(db, {
      provider: "test", model: "midflight", revision: "1", dimension: 8, pooling: "mean",
    });

    const source = await createSource(db, {
      ownerId: OWNER, notebookId, fileName: "m", fileType: "text/plain", fileSize: 1,
    });
    replaceChunks(db, { ownerId: OWNER, sourceId: source, notebookId }, ["doomed content"]);

    let embedCalls = 0;
    const embed = async (texts: string[]): Promise<Buffer[]> => {
      embedCalls += 1;
      // the source dies WHILE the embedder is "running"
      await removeSource(db, new LocalStore(db, dir), source);
      return texts.map(() => axis(8, 1));
    };

    const result = await indexNotebookChunks(db, {
      profileId: profile._id, dimension: 8, notebookId, batchSize: 5, embed,
    });
    expect(result.skipped).toBe(1);
    expect(result.indexed).toBe(0);
    expect(vectorSearch(db, profile._id, axis(8, 1), notebookId, 10)).toHaveLength(0);
    expect(embedCalls).toBe(1);
  });
});
