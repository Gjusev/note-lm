import { rawClient, type LocalDb } from "@/db/local";

/**
 * Notebook-scoped full-text search over chunk content via SQLite FTS5
 * (BM25 ranking) — replaces in-memory keyword scoring, no search server.
 */

export interface ScoredChunk {
  chunkId: string; // chunk UUID (joined via rowid)
  sourceId: string;
  notebookId: string;
  chunkIndex: number;
  content: string;
  rank: number;
}

/** Quote each term so user input can't break FTS5 query syntax. */
export function toFtsMatch(query: string): string {
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, ""))
    .filter((t) => t.length > 0)
    .slice(0, 12);
  if (terms.length === 0) return "";
  return terms.map((t) => `"${t}"`).join(" OR ");
}

export function searchChunks(db: LocalDb, notebookId: string, query: string, limit = 50): ScoredChunk[] {
  const match = toFtsMatch(query);
  if (!match) return [];
  const rows = rawClient(db)
    .prepare(
      `SELECT c.id AS "chunkId", f.source_id AS "sourceId", f.notebook_id AS "notebookId",
              f.chunk_index AS "chunkIndex", f.content, bm25(chunks_fts) AS rank
       FROM chunks_fts f
       JOIN chunks c ON c.rowid = f.rowid
       WHERE chunks_fts MATCH ? AND f.notebook_id = ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(match, notebookId, limit) as ScoredChunk[];
  return rows;
}
