/**
 * Vector index over chunks via sqlite-vec vec0 tables (issues #3/#4).
 * One vec0 table per embedding profile — vectors of different dimensions
 * or recipes never share a table. The notebook is a metadata column so KNN
 * filters INSIDE the query (probe-verified on sqlite-vec 0.1.9).
 */
import { createHash, randomUUID } from "node:crypto";
import { rawClient, type LocalDb } from "@/db/local";

const TABLE_PREFIX = "vec_chunks_";

const tableName = (profileId: string) =>
  // profile ids are UUIDs; keep the table name a safe identifier
  `${TABLE_PREFIX}${profileId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

/** True when the sqlite-vec extension is loaded on this connection. */
export function vecExtensionAvailable(db: LocalDb): boolean {
  try {
    rawClient(db).prepare("SELECT vec_version() AS v").get();
    return true;
  } catch {
    return false;
  }
}

/** Idempotent: create the vec0 table for a profile (requires the extension). */
export function ensureVecTable(db: LocalDb, profileId: string, dimension: number): string {
  const table = tableName(profileId);
  rawClient(db)
    .prepare(
      `CREATE VIRTUAL TABLE IF NOT EXISTS "${table}" USING vec0(
         chunk_id TEXT PRIMARY KEY,
         notebook_id TEXT METADATA,
         embedding FLOAT[${dimension}]
       )`
    )
    .run();
  return table;
}

/** Insert or replace one vector (bind float32 LE buffers directly).
 *  vec0 has no UPSERT — replace means delete + insert. */
export function insertVector(
  db: LocalDb,
  profileId: string,
  chunkId: string,
  notebookId: string,
  vector: Buffer
): void {
  const sqlite = rawClient(db);
  const table = tableName(profileId);
  sqlite.prepare(`DELETE FROM "${table}" WHERE chunk_id = ?`).run(chunkId);
  sqlite
    .prepare(
      `INSERT INTO "${table}" (chunk_id, notebook_id, embedding) VALUES (?, ?, ?)`
    )
    .run(chunkId, notebookId, vector);
}

export interface VectorHit {
  chunkId: string;
  notebookId: string;
  distance: number;
}

/** KNN restricted to one notebook via the metadata column. */
export function vectorSearch(
  db: LocalDb,
  profileId: string,
  query: Buffer,
  notebookId: string,
  k: number
): VectorHit[] {
  return rawClient(db)
    .prepare(
      `SELECT chunk_id AS "chunkId", notebook_id AS "notebookId", distance
       FROM "${tableName(profileId)}"
       WHERE embedding MATCH ? AND notebook_id = ? AND k = ?
       ORDER BY distance`
    )
    .all(query, notebookId, k) as VectorHit[];
}

/**
 * Resumable batched indexing (issue #3): embed chunks of a notebook that
 * have no indexed embedding for this profile yet, record progress in
 * chunk_embeddings, and insert into the profile's vec0 table. Re-running
 * continues where the last run stopped — indexed work is never redone.
 */
export function indexNotebookChunks(
  db: LocalDb,
  opts: {
    profileId: string;
    dimension: number;
    notebookId: string;
    batchSize: number;
    embed: (texts: string[]) => Buffer[];
  }
): { indexed: number } {
  ensureVecTable(db, opts.profileId, opts.dimension);
  const sqlite = rawClient(db);

  const pending = sqlite
    .prepare(
      `SELECT c.id AS id, c.content AS content
       FROM chunks c
       WHERE c.notebook_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM chunk_embeddings ce
           WHERE ce.chunk_id = c.id AND ce.profile_id = ? AND ce.status = 'indexed'
         )
       ORDER BY c.created_at, c.chunk_index
       LIMIT ?`
    )
    .all(opts.notebookId, opts.profileId, opts.batchSize) as Array<{ id: string; content: string }>;

  let indexed = 0;
  const now = Date.now();
  for (const chunk of pending) {
    const [vector] = opts.embed([chunk.content]);
    insertVector(db, opts.profileId, chunk.id, opts.notebookId, vector);
    const existing = sqlite
      .prepare(`SELECT id FROM chunk_embeddings WHERE chunk_id = ? AND profile_id = ?`)
      .get(chunk.id, opts.profileId) as { id: string } | undefined;
    if (existing) {
      sqlite
        .prepare(
          `UPDATE chunk_embeddings SET status='indexed', text_hash=?, error_message=NULL, updated_at=? WHERE id=?`
        )
        .run(hashText(chunk.content), now, existing.id);
    } else {
      sqlite
        .prepare(
          `INSERT INTO chunk_embeddings (id, chunk_id, profile_id, text_hash, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'indexed', ?, ?)`
        )
        .run(randomUUID(), chunk.id, opts.profileId, hashText(chunk.content), now, now);
    }
    indexed += 1;
  }
  return { indexed };
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
