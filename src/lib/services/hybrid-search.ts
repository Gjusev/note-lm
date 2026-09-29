/**
 * Hybrid retrieval (issue #4, hardened per agent-execution-plan finding 2/5):
 * FTS5/BM25 + vector KNN fused with RRF. Plan rules:
 * - up to 40 candidates per branch, notebook/source filters applied INSIDE
 *   both branches (never post-filtered after truncation)
 * - fusion by reciprocal rank, never by raw score sums
 * - the vector status is TYPED so the UI can explain what happened:
 *   ok | indexing | failed | unavailable — a failed branch is never
 *   presented as a successful hybrid run
 */
import type { LocalDb } from "@/db/local";
import { searchChunks } from "./search";
import { vectorSearch, vecExtensionAvailable } from "./vector-index";
import { fuseRankings } from "./retrieval";
import { getChunksByNotebook } from "./sources";

const CANDIDATES_PER_BRANCH = 40;

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

  const fused = fuseRankings(
    { fts: ftsHits.map((h) => h.chunkId), vector: vectorChunkIds },
    { limit }
  );

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
