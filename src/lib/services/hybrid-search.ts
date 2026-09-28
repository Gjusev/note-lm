/**
 * Hybrid retrieval (issue #4): FTS5/BM25 + vector KNN fused with RRF.
 * Plan rules (local-ai-rag-plan §Búsqueda híbrida):
 * - up to 40 candidates per branch, notebook filter applied INSIDE both
 *   branches (never post-filtered)
 * - fusion by reciprocal rank, never by raw score sums
 * - degrades to FTS with a visible mode when embeddings are unavailable
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
  score: number;
  branches: Array<"fts" | "vector">;
}

export interface HybridResult {
  mode: "hybrid" | "fts";
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
  }
): Promise<HybridResult> {
  const limit = opts.limit ?? 10;

  // FTS branch — notebook-scoped by construction
  const ftsHits = searchChunks(db, opts.notebookId, opts.query, CANDIDATES_PER_BRANCH);

  // Vector branch — only when a profile, an embedder AND the extension exist
  let vectorChunkIds: string[] = [];
  const canVector =
    !!opts.profile &&
    !!opts.embedQuery &&
    vecExtensionAvailable(db);
  if (canVector) {
    try {
      const q = opts.embedQuery!(opts.query);
      vectorChunkIds = vectorSearch(
        db,
        opts.profile!.id,
        q,
        opts.notebookId,
        CANDIDATES_PER_BRANCH
      ).map((h) => h.chunkId);
    } catch {
      vectorChunkIds = []; // extension table missing etc. → textual mode
    }
  }

  const fused = fuseRankings(
    { fts: ftsHits.map((h) => h.chunkId), vector: vectorChunkIds },
    { limit }
  );

  // resolve fused ids back to chunk rows (chunks from the OTHER notebook can
  // never be here — both branches were notebook-scoped)
  const byId = new Map(
    getChunksByNotebook(db, opts.notebookId).map((c) => [c._id, c])
  );
  const hits: HybridHit[] = [];
  for (const f of fused) {
    const chunk = byId.get(f.key);
    if (!chunk) continue; // vector row without a live chunk (deleted source)
    hits.push({
      chunkId: chunk._id,
      notebookId: opts.notebookId,
      sourceId: chunk.sourceId,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      score: f.score,
      branches: f.branches,
    });
  }

  return {
    mode: canVector && vectorChunkIds.length >= 0 && opts.profile ? "hybrid" : "fts",
    hits,
  };
}
