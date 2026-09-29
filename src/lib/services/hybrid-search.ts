/**
 * Hybrid retrieval (issue #4, hardened per agent-execution-plan finding 2/5):
 * FTS5/BM25 + vector KNN fused with RRF. Plan rules:
 * - up to 40 candidates per branch, notebook/source filters applied INSIDE
 *   both branches (never post-filtered after truncation)
 * - fusion by reciprocal rank, never by raw score sums; since the P3 decision
 *   the fused page additionally protects the vector branch's head (see
 *   FusionPolicy below — same branches, same filters, same contract)
 * - the vector status is TYPED so the UI can explain what happened:
 *   ok | indexing | failed | unavailable — a failed branch is never
 *   presented as a successful hybrid run
 */
import type { LocalDb } from "@/db/local";
import { searchChunks } from "./search";
import { vectorSearch, vecExtensionAvailable } from "./vector-index";
import { fuseRankings, type FusedResult } from "./retrieval";
import { getChunksByNotebook } from "./sources";

const CANDIDATES_PER_BRANCH = 40;

/**
 * Fusion policy (eval/fusion-proto, P3 — the T3 follow-up). The T3 reserved
 * run measured that plain RRF buries a cross-lingual vector hit: a chunk the
 * vector branch ranks 1st but FTS cannot see scores only 1/(60+1), while
 * query-language distractors collecting BOTH an FTS rank and a mid vector
 * rank score 1/(60+f) + 1/(60+v) and push it out of top-k.
 *
 * - "rrf" — plain reciprocal-rank fusion, the historical behavior.
 * - "protected-vector" — after RRF, the head of the VECTOR branch is
 *   guaranteed survival in the final top-k: every one of the top-N vector
 *   candidates ends up in the returned page, at a position no worse than its
 *   plain-RRF fusion position (items RRF already ranks inside the page keep
 *   their slot; missing ones take the tail slots, evicting the
 *   lowest-fused-scored unprotected items). Post-retrieval and O(limit): the
 *   branch searches, filters, scores, provenance and vectorStatus are
 *   untouched — only the order of the already-fused page changes. This is
 *   the DEFAULT since the P3 decision (see DEFAULT_FUSION_POLICY below).
 *
 * N = 3 (not 1, not 10): the measured failure is the loss of the vector
 * branch's HEAD — a rank-1 hit buried under ~10 both-branch distractors.
 * Protecting only rank 1 leaves the same failure for ranks 2-3 (a correct
 * chunk that shares one cognate with a distractor); protecting deep into the
 * vector list would evict FTS evidence wholesale for queries where vectors
 * are simply wrong (rare-but-real on the English-only default recipe). Three
 * seats ≈ one page of reading, matching how the answer stage consumes
 * evidence. No language detection, no score thresholds, no k tuning.
 */
export type FusionPolicy = "rrf" | "protected-vector";

/** Default per the P3 reserved-set decision (eval/fusion-proto/p3-report.md):
 *  adopted with cross recall@10 +50.0pp (0.500 -> 1.000, qwen3 recipe), mono
 *  0.0pp on both recipes, dev multi-run p95 -2.9% (qwen3) / -28% (bge). */
export const DEFAULT_FUSION_POLICY: FusionPolicy = "protected-vector";

/** Size of the protected vector head for "protected-vector". See above. */
export const PROTECTED_VECTOR_HEAD = 3;

export interface HybridHit {
  chunkId: string;
  notebookId: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  /** Provenance (migration 0013): the source_versions row this chunk came
   * from, as written by the producing run. null on legacy chunks — the
   * citation stamper falls back to the retrieval-time latest version. */
  sourceVersionId?: string | null;
  score: number;
  branches: Array<"fts" | "vector">;
}

export type VectorStatus = "ok" | "indexing" | "failed" | "unavailable";

export interface HybridResult {
  mode: "hybrid" | "fts";
  vectorStatus: VectorStatus;
  hits: HybridHit[];
}

/**
 * "protected-vector": guarantee the top-N vector candidates a seat in the
 * final top-`limit` page, at a position no worse than plain RRF gave them.
 * Operates strictly on the fused candidate list (both branches already
 * filtered); pure post-processing, no extra queries.
 */
function protectVectorHead(
  fused: FusedResult[],
  vectorChunkIds: string[],
  limit: number
): FusedResult[] {
  const page = fused.slice(0, limit);
  if (vectorChunkIds.length === 0) return page;
  const protectedKeys = new Set(vectorChunkIds.slice(0, PROTECTED_VECTOR_HEAD));
  const inPage = new Set(page.map((f) => f.key));
  const missing = [...protectedKeys].filter((k) => !inPage.has(k));
  if (missing.length === 0) return page;
  // evict from the tail, never a protected key; every freed slot is filled
  // by one missing protected key (in vector order) at that tail position —
  // strictly better than the below-the-cut position plain RRF gave it
  let toEvict = missing.length;
  for (let i = page.length - 1; i >= 0 && toEvict > 0; i--) {
    if (protectedKeys.has(page[i].key)) continue;
    page.splice(i, 1);
    toEvict--;
  }
  const byKey = new Map(fused.map((f) => [f.key, f]));
  return page.concat(missing.map((k) => byKey.get(k)!)).slice(0, limit);
}

export async function searchHybrid(
  db: LocalDb,
  opts: {
    notebookId: string;
    query: string;
    profile: { id: string; dimension: number } | null;
    embedQuery: ((query: string) => Buffer) | null;
    limit?: number;
    /** Restrict to these sources (null = all completed sources). */
    allowedSourceIds?: Set<string> | null;
    /** Fusion policy (P3). Defaults to DEFAULT_FUSION_POLICY. */
    fusionPolicy?: FusionPolicy;
  }
): Promise<HybridResult> {
  const limit = opts.limit ?? 10;
  const allowed = opts.allowedSourceIds ?? null;

  // FTS branch — notebook + source filters inside the SQL
  const ftsHits = searchChunks(db, opts.notebookId, opts.query, CANDIDATES_PER_BRANCH, allowed);

  // Vector branch — only when a profile, an embedder AND the extension exist
  let vectorStatus: VectorStatus = "unavailable";
  let vectorChunkIds: string[] = [];
  const canVector = !!opts.profile && !!opts.embedQuery && vecExtensionAvailable(db);
  if (canVector) {
    try {
      const q = opts.embedQuery!(opts.query);
      vectorChunkIds = vectorSearch(
        db,
        opts.profile!.id,
        q,
        opts.notebookId,
        CANDIDATES_PER_BRANCH,
        allowed
      ).map((h) => h.chunkId);
      vectorStatus = vectorChunkIds.length > 0 ? "ok" : "indexing";
    } catch {
      vectorChunkIds = [];
      vectorStatus = "failed";
    }
  }

  const fusedAll = fuseRankings(
    { fts: ftsHits.map((h) => h.chunkId), vector: vectorChunkIds },
    {}
  );
  // With "protected-vector" the returned page's array order is the ranking;
  // `score` stays the plain RRF contribution, so it can be non-monotonic at
  // the protected tail slots (documented in the FusionPolicy comment).
  const fused =
    (opts.fusionPolicy ?? DEFAULT_FUSION_POLICY) === "protected-vector"
      ? protectVectorHead(fusedAll, vectorChunkIds, limit)
      : fusedAll.slice(0, limit);

  // resolve fused ids back to chunk rows — both branches were filtered by
  // notebook and source already; dropped rows (source removed mid-flight)
  // only shrink this page, they never change the ranking
  const byId = new Map(
    getChunksByNotebook(db, opts.notebookId).map((c) => [c._id, c])
  );
  const hits: HybridHit[] = [];
  for (const f of fused) {
    const chunk = byId.get(f.key);
    if (!chunk) continue;
    hits.push({
      chunkId: chunk._id,
      notebookId: opts.notebookId,
      sourceId: chunk.sourceId,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      sourceVersionId: chunk.sourceVersionId ?? null,
      score: f.score,
      branches: f.branches,
    });
  }

  return {
    mode: vectorStatus === "ok" ? "hybrid" : "fts",
    vectorStatus,
    hits,
  };
}
