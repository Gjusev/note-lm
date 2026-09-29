// @vitest-environment node
//
// P3 fusion-policy regression (eval/fusion-proto): the T3 finding, pinned at
// the searchHybrid seam. Geometry copied from the measured T3 case
// (t3-report.md §4): a cross-lingual query whose correct chunk is ranked 1st
// by the vector branch but has no lexical foothold for FTS, while
// same-language distractors collect BOTH an FTS rank and a mid vector rank —
// 1/(60+f) + 1/(60+v) beats a pure vector-first 1/(60+1), so RRF fusion drops
// the correct chunk out of top-k. The first test is the PERMANENT guard: it
// was written first (red), then turned green by the adopted fusion policy. It
// runs against the DEFAULT policy — no parameter — so it guards what ships.
// The rest pin the "protected-vector" contract: filters, provenance,
// vectorStatus typing and limit semantics are exactly the rrf contract.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLocalDb, closeLocalDb, type LocalDb } from "@/db/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource, replaceChunks, getChunksByNotebook } from "@/lib/services/sources";
import { registerEmbeddingProfile } from "@/lib/services/embedding-profiles";
import { ensureVecTable, insertVector } from "@/lib/services/vector-index";
import { searchHybrid } from "@/lib/services/hybrid-search";

let dir: string;
let db: LocalDb;
let notebookId: string;
let correctSourceId: string;
let distractorSourceId: string;
const OWNER = "local";
const PROFILE = { id: "p-fusion-8", dimension: 8 };

/**
 * Deterministic fake embeddings (CONTEXT.md loop rules). Query lives exactly
 * on axis 0. The correct German chunk is pure axis 0 (vector rank 1, distance
 * 0). Each Spanish distractor leans 0.90..0.80 on axis 0 and puts the rest on
 * a far axis — distance sqrt(2-2a), so distractors take vector ranks 2..12.
 */
const embedText = (text: string): Buffer => {
  const v = new Float32Array(PROFILE.dimension);
  if (text.includes("wetterwarte")) {
    v[0] = 1;
    return Buffer.from(v.buffer);
  }
  const m = text.match(/distractor-(\d+)/);
  if (m) {
    const k = Number(m[1]); // 1..11
    const a = 0.9 - 0.01 * (k - 1);
    const axis = 1 + ((k - 1) % 7);
    v[0] = a;
    v[axis] = Math.sqrt(1 - a * a);
    return Buffer.from(v.buffer);
  }
  v[0] = 1;
  return Buffer.from(v.buffer);
};
/** The query embedding sits on axis 0: closest to the German evidence chunk. */
const embedQuery = (_q: string) => embedText("wetterwarte");

/** The Spanish query — its FTS tokens appear ONLY in the distractor chunks. */
const QUERY =
  "¿A qué altura sobre el nivel del mar está la atalaya meteorológica?";

const CORRECT =
  "Die Wetterwarte auf dem Kamm liegt auf 1.640 Metern über dem Meer und " +
  "misst ganzjährig Luftdruck, Temperatur und Windrichtung für das Netz.";
const DISTRACTORS = Array.from({ length: 11 }, (_, i) => {
  const k = i + 1;
  return (
    `distractor-${k}: la altura de esta atalaya sobre el nivel del mar se ` +
    `mide cada temporada ${k} con instrumentos propios del observatorio`
  );
});

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-fusion-"));
  db = openLocalDb(dir);
  notebookId = await createNotebook(db, { ownerId: OWNER, title: "Fusion" });

  await registerEmbeddingProfile(db, {
    provider: "test", model: "axis", revision: "1", dimension: PROFILE.dimension, pooling: "mean",
  });

  const { updateSourceStatus } = await import("@/lib/services/sources");
  correctSourceId = await createSource(db, { ownerId: OWNER, notebookId, fileName: "de.txt", fileType: "text/plain", fileSize: 1 });
  replaceChunks(db, { ownerId: OWNER, sourceId: correctSourceId, notebookId }, [CORRECT]);
  await updateSourceStatus(db, correctSourceId, { status: "completed" });
  distractorSourceId = await createSource(db, { ownerId: OWNER, notebookId, fileName: "es.txt", fileType: "text/plain", fileSize: 1 });
  replaceChunks(db, { ownerId: OWNER, sourceId: distractorSourceId, notebookId }, DISTRACTORS);
  await updateSourceStatus(db, distractorSourceId, { status: "completed" });

  ensureVecTable(db, PROFILE.id, PROFILE.dimension);
  for (const c of getChunksByNotebook(db, notebookId)) {
    insertVector(db, PROFILE.id, c._id, notebookId, embedText(c.content), c.sourceId);
  }
});

afterEach(() => {
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("hybrid fusion policy — T3 cross-lingual regression (p3)", () => {
  it("keeps a vector-rank-1 cross-lingual hit inside top-k when same-language distractors score in both branches (default policy)", async () => {
    const result = await searchHybrid(db, {
      notebookId,
      query: QUERY,
      profile: PROFILE,
      embedQuery,
      limit: 10,
    });
    expect(result.mode).toBe("hybrid");
    expect(result.vectorStatus).toBe("ok");
    // The failure this guards against: every distractor collects an FTS rank
    // plus a mid vector rank (>= 1/71 + 1/72) and outranks the correct chunk's
    // pure 1/(60+1), pushing it to fused rank 12 — outside top-10.
    const rank = result.hits.findIndex((h) => h.content.includes("Wetterwarte")) + 1;
    expect(rank).toBeGreaterThan(0);
    expect(rank).toBeLessThanOrEqual(10);
  });
});

describe("hybrid fusion policy — protected-vector contract", () => {
  it("rescues the buried vector head into the page (policy param, before any default change)", async () => {
    const result = await searchHybrid(db, {
      notebookId,
      query: QUERY,
      profile: PROFILE,
      embedQuery,
      limit: 10,
      fusionPolicy: "protected-vector",
    });
    expect(result.mode).toBe("hybrid");
    expect(result.vectorStatus).toBe("ok");
    expect(result.hits.length).toBeLessThanOrEqual(10); // limit still respected
    const rank = result.hits.findIndex((h) => h.content.includes("Wetterwarte")) + 1;
    expect(rank).toBe(10); // tail seat: RRF wanted it at 12, protection gives it the evicted slot
    // the rescued hit carries the full provenance of its chunk row
    const chunk = getChunksByNotebook(db, notebookId).find((c) => c._id === result.hits[rank - 1].chunkId)!;
    const hit = result.hits[rank - 1];
    expect(hit.notebookId).toBe(chunk.notebookId);
    expect(hit.sourceId).toBe(chunk.sourceId);
    expect(hit.chunkIndex).toBe(chunk.chunkIndex);
    expect(hit.content).toBe(chunk.content);
    expect(hit.sourceVersionId).toBe(chunk.sourceVersionId ?? null);
    expect(hit.branches).toEqual(["vector"]); // it reached the page via the vector branch only
  });

  it("is a no-op when RRF already has the vector head inside the page (position never worsens)", async () => {
    // "wetterwarte" is an FTS token of the correct chunk → both branches
    // rank it 1st → fused rank 1. Protection must not reorder anything.
    const base = await searchHybrid(db, {
      notebookId, query: "wetterwarte 1.640 metern", profile: PROFILE, embedQuery, limit: 10,
      fusionPolicy: "rrf",
    });
    const protectedRun = await searchHybrid(db, {
      notebookId, query: "wetterwarte 1.640 metern", profile: PROFILE, embedQuery, limit: 10,
      fusionPolicy: "protected-vector",
    });
    expect(base.hits[0].content).toContain("Wetterwarte");
    expect(protectedRun.hits).toEqual(base.hits); // identical page, same order, same scores
  });

  it("protects the whole vector head (top-3), not just rank 1", async () => {
    // Own fixture, own notebook: 8 both-branch distractors (fts rank via
    // "kappa" repetitions, vector ranks 4..11) all outrank the three
    // vector-only items V1..V3 under plain RRF, so a top-5 page drops the
    // entire vector head. Protection must seat all three.
    const nb2 = await createNotebook(db, { ownerId: OWNER, title: "Head" });
    const { updateSourceStatus } = await import("@/lib/services/sources");
    const s = await createSource(db, { ownerId: OWNER, notebookId: nb2, fileName: "head.txt", fileType: "text/plain", fileSize: 1 });
    const headTexts = [
      "vektor eins", // V1: vector rank 1, no FTS foothold
      "vektor zwei", // V2
      "vektor drei", // V3
      ...Array.from({ length: 8 }, (_, i) => `filler ${i + 1}: ${"kappa ".repeat(i + 1)}`),
    ];
    replaceChunks(db, { ownerId: OWNER, sourceId: s, notebookId: nb2 }, headTexts);
    await updateSourceStatus(db, s, { status: "completed" });
    ensureVecTable(db, PROFILE.id, PROFILE.dimension);
    for (const c of getChunksByNotebook(db, nb2)) {
      const i = headTexts.indexOf(c.content);
      const v = new Float32Array(PROFILE.dimension);
      v[0] = i < 3 ? 0.95 - 0.05 * i : 0.7 - 0.02 * (i - 3); // V1..V3 then filler 4..11
      v[1 + (i % 7)] = Math.sqrt(1 - v[0] * v[0]);
      insertVector(db, PROFILE.id, c._id, nb2, Buffer.from(v.buffer), c.sourceId);
    }
    const base = await searchHybrid(db, {
      notebookId: nb2, query: "kappa", profile: PROFILE, embedQuery, limit: 5,
      fusionPolicy: "rrf",
    });
    expect(base.hits.every((h) => h.content.includes("kappa"))).toBe(true); // head dropped
    const head = await searchHybrid(db, {
      notebookId: nb2, query: "kappa", profile: PROFILE, embedQuery, limit: 5,
      fusionPolicy: "protected-vector",
    });
    expect(head.hits.length).toBe(5);
    for (const marker of ["eins", "zwei", "drei"]) {
      expect(head.hits.some((h) => h.content.includes(marker))).toBe(true);
    }
    // the two survivors keep their (better) RRF positions ahead of the seats
    expect(head.hits[0].content).toContain("kappa");
    expect(head.hits[1].content).toContain("kappa");
    expect(head.hits[2].content).toContain("eins"); // seats filled in vector order
    expect(head.hits[3].content).toContain("zwei");
    expect(head.hits[4].content).toContain("drei");
  });

  it("applies source filters inside the branches — protection never leaks an excluded source", async () => {
    // allowed = only the distractor source: the correct chunk is filtered out
    // of the vector branch BEFORE fusion, so protection cannot resurrect it.
    const onlyDistractors = await searchHybrid(db, {
      notebookId, query: QUERY, profile: PROFILE, embedQuery, limit: 10,
      allowedSourceIds: new Set([distractorSourceId]),
      fusionPolicy: "protected-vector",
    });
    expect(onlyDistractors.hits.every((h) => h.sourceId === distractorSourceId)).toBe(true);
    expect(onlyDistractors.hits.some((h) => h.content.includes("Wetterwarte"))).toBe(false);

    // allowed = only the correct source: FTS has nothing (no Spanish tokens
    // there), the vector branch is exactly the correct chunk — rank 1.
    const onlyCorrect = await searchHybrid(db, {
      notebookId, query: QUERY, profile: PROFILE, embedQuery, limit: 10,
      allowedSourceIds: new Set([correctSourceId]),
      fusionPolicy: "protected-vector",
    });
    expect(onlyCorrect.hits.length).toBe(1);
    expect(onlyCorrect.hits[0].sourceId).toBe(correctSourceId);
    expect(onlyCorrect.hits[0].branches).toEqual(["vector"]);
  });

  it("keeps the typed vectorStatus contract — protection is inert when the vector branch is dead", async () => {
    // failed: embedder throws → same fts page as plain rrf, status "failed"
    const boom = () => {
      throw new Error("llama died");
    };
    const failed = await searchHybrid(db, {
      notebookId, query: QUERY, profile: PROFILE, embedQuery: boom, limit: 10,
      fusionPolicy: "protected-vector",
    });
    expect(failed.mode).toBe("fts");
    expect(failed.vectorStatus).toBe("failed");
    const failedBase = await searchHybrid(db, {
      notebookId, query: QUERY, profile: PROFILE, embedQuery: boom, limit: 10,
      fusionPolicy: "rrf",
    });
    expect(failed.hits).toEqual(failedBase.hits);

    // indexing: profile without vectors → status "indexing", fts page intact
    const emptyProfile = { id: "p-fusion-empty-8", dimension: 8 };
    ensureVecTable(db, emptyProfile.id, emptyProfile.dimension);
    const indexing = await searchHybrid(db, {
      notebookId, query: QUERY, profile: emptyProfile, embedQuery, limit: 10,
      fusionPolicy: "protected-vector",
    });
    expect(indexing.vectorStatus).toBe("indexing");
    expect(indexing.mode).toBe("fts");
    expect(indexing.hits.length).toBe(10); // the plain FTS page, untouched

    // unavailable: no profile at all
    const none = await searchHybrid(db, {
      notebookId, query: QUERY, profile: null, embedQuery: null, limit: 10,
      fusionPolicy: "protected-vector",
    });
    expect(none.vectorStatus).toBe("unavailable");
    expect(none.mode).toBe("fts");
  });
});
