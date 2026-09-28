// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLocalDb, closeLocalDb, type LocalDb } from "@/db/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource, replaceChunks } from "@/lib/services/sources";
import { registerEmbeddingProfile } from "@/lib/services/embedding-profiles";
import { ensureVecTable, insertVector } from "@/lib/services/vector-index";
import { searchHybrid } from "@/lib/services/hybrid-search";

let dir: string;
let db: LocalDb;
let notebookId: string;
let otherNotebook: string;
const OWNER = "local";
const PROFILE = { id: "p-hyb-8", dimension: 8 };

/** Deterministic embeddings: "gamma" lives near axis 0, others on far axes. */
const embedText = (text: string): Buffer => {
  const v = new Float32Array(PROFILE.dimension);
  const i = text.includes("gamma") ? 0 : text.includes("beta") ? 1 : text.includes("alpha") ? 2 : 3;
  v[i] = 1;
  return Buffer.from(v.buffer);
};
const embedQuery = (topic: string) => embedText(topic);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-hyb-"));
  db = openLocalDb(dir);
  notebookId = await createNotebook(db, { ownerId: OWNER, title: "Hyb" });
  otherNotebook = await createNotebook(db, { ownerId: OWNER, title: "Other" });

  await registerEmbeddingProfile(db, {
    provider: "test", model: "axis", revision: "1", dimension: PROFILE.dimension, pooling: "mean",
  });

  const { updateSourceStatus } = await import("@/lib/services/sources");
  const s1 = await createSource(db, { ownerId: OWNER, notebookId, fileName: "a.txt", fileType: "text/plain", fileSize: 1 });
  replaceChunks(db, { ownerId: OWNER, sourceId: s1, notebookId }, ["alpha content", "beta content", "gamma content"]);
  await updateSourceStatus(db, s1, { status: "completed" });
  const s2 = await createSource(db, { ownerId: OWNER, notebookId: otherNotebook, fileName: "b.txt", fileType: "text/plain", fileSize: 1 });
  replaceChunks(db, { ownerId: OWNER, sourceId: s2, notebookId: otherNotebook }, ["gamma private other notebook"]);
  await updateSourceStatus(db, s2, { status: "completed" });

  ensureVecTable(db, PROFILE.id, PROFILE.dimension);
  const { getChunksByNotebook } = await import("@/lib/services/sources");
  for (const nb of [notebookId, otherNotebook]) {
    for (const c of getChunksByNotebook(db, nb)) {
      insertVector(db, PROFILE.id, c._id, nb, embedText(c.content), c.sourceId);
    }
  }
});

afterEach(() => {
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("hybrid search (issue #4)", () => {
  it("fuses FTS and vector branches — the chunk both branches rank wins", async () => {
    // FTS for "gamma" ranks the gamma chunk; the vector query is ALSO near
    // gamma → RRF must place the gamma chunk of THIS notebook first.
    const result = await searchHybrid(db, {
      notebookId,
      query: "gamma",
      profile: PROFILE,
      embedQuery,
      limit: 3,
    });
    expect(result.mode).toBe("hybrid");
    expect(result.hits[0].content).toContain("gamma");
    expect(result.hits.every((h) => h.notebookId === notebookId)).toBe(true);
    // no leakage from the other notebook in EITHER branch
    expect(result.hits.some((h) => h.content.includes("other notebook"))).toBe(false);
  });

  it("degrades to FTS-only when no profile/embedder is available", async () => {
    const result = await searchHybrid(db, {
      notebookId,
      query: "alpha",
      profile: null,
      embedQuery: null,
      limit: 3,
    });
    expect(result.mode).toBe("fts");
    expect(result.hits[0].content).toContain("alpha");
  });

  it("keeps FTS results when the vector branch is empty (unindexed profile)", async () => {
    const emptyProfile = { id: "p-empty-8", dimension: 8 };
    ensureVecTable(db, emptyProfile.id, emptyProfile.dimension);
    const result = await searchHybrid(db, {
      notebookId,
      query: "beta",
      profile: emptyProfile,
      embedQuery,
      limit: 3,
    });
    // nothing indexed for this profile yet → the UI can say "indexing"
    expect(result.vectorStatus).toBe("indexing");
    expect(result.hits[0].content).toContain("beta");
  });

  it("reports a typed vector status — failure is never presented as hybrid (finding 2)", async () => {
    // extension present, profile given, but the embedder THROWS
    const boom = () => {
      throw new Error("llama died");
    };
    const failed = await searchHybrid(db, {
      notebookId,
      query: "alpha",
      profile: PROFILE,
      embedQuery: boom,
      limit: 3,
    });
    expect(failed.mode).toBe("fts");
    expect(failed.vectorStatus).toBe("failed");
    expect(failed.hits[0].content).toContain("alpha"); // textual results survive

    // profile given, embedder fine, but nothing indexed for it → still
    // building, and the UI can say so
    const emptyProfile = { id: "p-status-8", dimension: 8 };
    ensureVecTable(db, emptyProfile.id, emptyProfile.dimension);
    const indexing = await searchHybrid(db, {
      notebookId,
      query: "alpha",
      profile: emptyProfile,
      embedQuery,
      limit: 3,
    });
    expect(indexing.vectorStatus).toBe("indexing");

    // no profile at all → plainly unavailable
    const none = await searchHybrid(db, {
      notebookId,
      query: "alpha",
      profile: null,
      embedQuery: null,
      limit: 3,
    });
    expect(none.vectorStatus).toBe("unavailable");

    // healthy hybrid run
    const ok = await searchHybrid(db, {
      notebookId,
      query: "gamma",
      profile: PROFILE,
      embedQuery,
      limit: 3,
    });
    expect(ok.mode).toBe("hybrid");
    expect(ok.vectorStatus).toBe("ok");
  });
});
