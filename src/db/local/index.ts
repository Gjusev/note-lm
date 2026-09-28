import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { FTS_DDL, MIGRATIONS } from "./migrations";

export type LocalDb = BetterSQLite3Database<typeof schema>;
export type SqliteClient = Database.Database;

export function resolveDataDir(): string {
  const fromEnv = process.env.NOTELM_DATA_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  // Default: OS user data dir, outside the checkout and install dir.
  const home =
    process.env.APPDATA ||
    process.env.XDG_DATA_HOME ||
    path.join(os.homedir(), ".local", "share");
  return path.join(home, "note-lm");
}

export function ensureDataDirs(dataDir: string): void {
  for (const sub of ["files", "tmp", "backups", "logs"]) {
    fs.mkdirSync(path.join(dataDir, sub), { recursive: true });
  }
}

/**
 * Open (and if needed create/migrate) the local SQLite database.
 * WAL + busy_timeout so the Next.js server and the worker process can share
 * the file: concurrent readers, one serialized writer at a time.
 */
export function openLocalDb(dataDir: string): LocalDb {
  ensureDataDirs(dataDir);
  const sqlite = new Database(path.join(dataDir, "notebook.sqlite"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  // IMMEDIATE so the server and the worker bootstrapping a fresh database
  // serialize; the version is re-read inside the transaction, the loser
  // sees the winner's version and applies nothing.
  const bootstrap = sqlite.transaction(() => {
    const version = (sqlite.pragma("user_version", { simple: true }) as number) ?? 0;
    for (let i = version; i < MIGRATIONS.length; i++) {
      sqlite.exec(MIGRATIONS[i]);
      sqlite.pragma(`user_version = ${i + 1}`);
    }
  });
  bootstrap.immediate();
  sqlite.exec(FTS_DDL);

  // sqlite-vec is optional: FTS5 keeps working without it (local-ai-rag-plan
  // — "FTS5 debe seguir funcionando sin proveedor de embeddings"). Load it
  // when present so vec0 tables are usable on this connection.
  try {
    const { getLoadablePath } = require("sqlite-vec") as typeof import("sqlite-vec");
    sqlite.loadExtension(getLoadablePath());
  } catch (err) {
    // NOT silent (agent-execution-plan finding 7): textual retrieval still
    // works, but the operator must see why vectors are off
    console.error(`[db] sqlite-vec not loaded — vector search disabled: ${err instanceof Error ? err.message : err}`);
  }

  return drizzle(sqlite, { schema });
}

/**
 * Process-wide singleton for the resolved data dir. Cached on globalThis so
 * Next.js dev HMR doesn't open a new connection per reload.
 */
export function getLocalDb(): LocalDb {
  const g = globalThis as { __notelmLocalDb?: LocalDb; __notelmDataDir?: string };
  const dataDir = resolveDataDir();
  if (g.__notelmLocalDb && g.__notelmDataDir === dataDir) return g.__notelmLocalDb;
  g.__notelmLocalDb = openLocalDb(dataDir);
  g.__notelmDataDir = dataDir;
  return g.__notelmLocalDb;
}

/** Raw better-sqlite3 handle (for immediate transactions / FTS queries). */
export function rawClient(db: LocalDb): SqliteClient {
  return (db as unknown as { $client: SqliteClient }).$client;
}

/** Close the underlying connection (releases WAL file locks on Windows).
 *  Also drops the storage-layer context cache for this handle (global slot,
 *  cleared here to avoid an import cycle with lib/storage/local). */
export function closeLocalDb(db: LocalDb): void {
  const g = globalThis as { __notelmLocalDb?: LocalDb; __notelmCtx?: { db: LocalDb } };
  if (g.__notelmLocalDb === db) g.__notelmLocalDb = undefined;
  if (g.__notelmCtx?.db === db) g.__notelmCtx = undefined;
  rawClient(db).close();
}

/** Test hook: pretend leases expired / backoff elapsed, without sleeping. */
export function fastForwardForTests(db: LocalDb): void {
  const sqlite = rawClient(db);
  sqlite
    .prepare(
      `UPDATE import_jobs SET lease_expires_at = 0
       WHERE status IN ('inspecting','awaiting_selection','downloading','processing')`
    )
    .run();
  sqlite.prepare(`UPDATE import_jobs SET next_attempt_at = 0 WHERE status = 'queued'`).run();
  sqlite
    .prepare(
      `UPDATE processing_jobs SET lease_expires_at = 0
       WHERE status IN ('running')`
    )
    .run();
  sqlite.prepare(`UPDATE processing_jobs SET status = 'pending' WHERE status = 'running'`).run();
}

export { schema };
