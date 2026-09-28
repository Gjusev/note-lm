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

/** Idempotent: create the vec0 table for a profile (requires the extension).
 *  dimension must be a sane integer (finding 3: the recipe is part of the
 *  profile identity — a bad dimension must fail loudly, not corrupt vectors). */
export function ensureVecTable(db: LocalDb, profileId: string, dimension: number): string {
  if (!Number.isInteger(dimension) || dimension < 1 || dimension > 4096) {
    throw new Error(`invalid embedding dimension: ${dimension}`);
  }
  const table = tableName(profileId);
  rawClient(db)
    .prepare(
      `CREATE VIRTUAL TABLE IF NOT EXISTS "${table}" USING vec0(
         chunk_id TEXT PRIMARY KEY,
         notebook_id TEXT METADATA,
         source_id TEXT METADATA,
         embedding FLOAT[${dimension}]
       )`
    )
    .run();
  return table;
}

/** Insert or replace one vector (bind float32 LE buffers directly).
 *  vec0 has no UPSERT — replace means delete + insert. The buffer must be a
 *  finite float32 vector of exactly the profile's dimension (finding 4). */
export function insertVector(
  db: LocalDb,
  profileId: string,
  chunkId: string,
  notebookId: string,
  vector: Buffer,
  sourceId?: string
): void {
  const sqlite = rawClient(db);
  const table = tableName(profileId);
  sqlite.prepare(`DELETE FROM "${table}" WHERE chunk_id = ?`).run(chunkId);
  sqlite
    .prepare(
      `INSERT INTO "${table}" (chunk_id, notebook_id, source_id, embedding) VALUES (?, ?, ?, ?)`
    )
    .run(chunkId, notebookId, sourceId ?? null, vector);
}

/** Validate a float32 buffer: right byte length and all values finite. */
export function validateVector(vector: Buffer, dimension: number): void {
  if (vector.length !== dimension * 4) {
    throw new Error(`vector is ${vector.length / 4} dims, profile expects ${dimension}`);
  }
  const view = new Float32Array(vector.buffer, vector.byteOffset, dimension);
  for (let i = 0; i < dimension; i++) {
    if (!Number.isFinite(view[i])) {
      throw new Error(`vector has a non-finite value at index ${i}`);
    }
  }
}

export interface VectorHit {
  chunkId: string;
  notebookId: string;
  distance: number;
}

/** KNN restricted to one notebook via the metadata column; optional source
 *  selection applies INSIDE the query (finding 5 — never post-filtered). */
export function vectorSearch(
  db: LocalDb,
  profileId: string,
  query: Buffer,
  notebookId: string,
  k: number,
  allowedSourceIds?: Set<string> | null
): VectorHit[] {
  const sourceFilter = allowedSourceIds
    ? `AND source_id IN (${[...allowedSourceIds].map(() => "?").join(",")})`
    : "";
  const params: unknown[] = [query, notebookId];
  if (allowedSourceIds) params.push(...allowedSourceIds);
  return rawClient(db)
    .prepare(
      `SELECT chunk_id AS "chunkId", notebook_id AS "notebookId", distance
       FROM "${tableName(profileId)}"
       WHERE embedding MATCH ? AND notebook_id = ? ${sourceFilter} AND k = ?
       ORDER BY distance`
    )
    .all(...(params as never[]), k) as VectorHit[];
}

/**
 * Purge vector rows whose chunk no longer exists (finding 4): deletion or
 * replacement of sources/chunks must not leave ghosts occupying KNN slots.
 * chunk_embeddings rows are cascaded by SQLite; vec0 has no FK — explicit.
 */
export function purgeOrphanVectors(db: LocalDb): number {
  const sqlite = rawClient(db);
  let purged = 0;
  // vec0 rejects DELETE with a subquery (shadow-table guard) — resolve ghost
  // ids first, then delete row by row
  // only the virtual tables themselves — vec0 keeps shadow tables
  // (_info, _rowids, …) that must not be touched
  const tables = sqlite
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name LIKE 'vec_chunks_%' AND sql LIKE 'CREATE VIRTUAL TABLE%'`
    )
    .all() as Array<{ name: string }>;
  for (const { name } of tables) {
    const ghosts = sqlite
      .prepare(
        `SELECT chunk_id FROM "${name}" WHERE chunk_id NOT IN (SELECT id FROM chunks)`
      )
      .all() as Array<{ chunk_id: string }>;
    const del = sqlite.prepare(`DELETE FROM "${name}" WHERE chunk_id = ?`);
    for (const g of ghosts) {
      purged += del.run(g.chunk_id).changes;
    }
  }
  return purged;
}

/**
 * Resumable batched indexing (issue #3): embed chunks of a notebook that
 * have no indexed embedding for this profile yet, record progress in
 * chunk_embeddings, and insert into the profile's vec0 table. Re-running
 * continues where the last run stopped — indexed work is never redone.
 */
export async function indexNotebookChunks(
  db: LocalDb,
  opts: {
    profileId: string;
    dimension: number;
    notebookId: string;
    batchSize: number;
    /** Async on purpose: real embedders (llama-server) return promises and
     *  inference must NEVER run inside a SQLite transaction. */
    embed: (texts: string[]) => Promise<Buffer[]>;
  }
): Promise<{ indexed: number; skipped: number }> {
  ensureVecTable(db, opts.profileId, opts.dimension);
  const sqlite = rawClient(db);

  const pending = sqlite
    .prepare(
      `SELECT c.id AS id, c.content AS content, c.source_id AS source
       FROM chunks c
       WHERE c.notebook_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM chunk_embeddings ce
           WHERE ce.chunk_id = c.id AND ce.profile_id = ? AND ce.status = 'indexed'
         )
       ORDER BY c.created_at, c.chunk_index
       LIMIT ?`
    )
    .all(opts.notebookId, opts.profileId, opts.batchSize) as Array<{ id: string; content: string; source: string }>;

  let indexed = 0;
  let skipped = 0;
  const now = Date.now();
  for (const chunk of pending) {
    // inference happens OUTSIDE any transaction; the confirm below re-checks
    // the chunk is still live before writing vector + state together
    const [vector] = await opts.embed([chunk.content]);
    validateVector(vector, opts.dimension);
    const stillLive = sqlite
      .prepare(`SELECT 1 FROM chunks WHERE id = ?`)
      .get(chunk.id);
    if (!stillLive) {
      skipped += 1;
      continue; // deleted/replaced while embedding — result discarded
    }
    insertVector(db, opts.profileId, chunk.id, opts.notebookId, vector, chunk.source);
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
  return { indexed, skipped };
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
