import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, not } from "drizzle-orm";
import { rawClient, type LocalDb } from "@/db/local";
import { chunks, importJobs, sources, type ImportJobStatus } from "@/db/local/schema";
import { toWire } from "./wire";

/**
 * Persistent URL-import jobs — 1:1 port of convex/importJobs.ts to SQLite.
 * Same lease/fencing/backoff contract, pinned by e2e:
 * - 10 min lease, token-fenced writes (fail() checks only the token, exactly
 *   like Convex — deliberate), heartbeat extends, stale leases reclaimed.
 * - transient errors requeue with 15s·2^n backoff (cap 10 min, max 3 attempts).
 * - complete() is idempotent: source reuse by job.sourceId or
 *   (notebook, provider, externalId); chunks replaced, never duplicated.
 * Local changes: crypto lease tokens, no WORKER_KEY (a process that can open
 * the data dir is trusted — the boundary is the filesystem), claim runs in a
 * BEGIN IMMEDIATE transaction so two processes can never take one job.
 *
 * drizzle's better-sqlite3 driver only allows SYNCHRONOUS transaction
 * callbacks — inside tx, statements use .run()/.all()/.get(), never await.
 */

const LEASE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_DEFAULT = 3;
const RUNNING: ImportJobStatus[] = ["inspecting", "awaiting_selection", "downloading", "processing"];
const TERMINAL: ImportJobStatus[] = ["completed", "failed", "cancelled"];

const RUNNING_SQL = "('inspecting','awaiting_selection','downloading','processing')";

export interface ImportJobDoc {
  _id: string;
  ownerId: string;
  notebookId: string;
  url: string;
  provider: string;
  kind: string;
  resourceKey: string;
  externalId?: string | null;
  canonicalUrl?: string | null;
  status: ImportJobStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  leaseToken?: string | null;
  leaseExpiresAt?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  sourceId?: string | null;
  title?: string | null;
  createdAt: number;
  updatedAt: number;
}

type Row = typeof importJobs.$inferSelect;

export function toJobDoc(row: Row): ImportJobDoc {
  return toWire(row) as ImportJobDoc;
}

export function createImportJob(
  db: LocalDb,
  args: {
    ownerId: string;
    notebookId: string;
    url: string;
    provider: string;
    kind: string;
    resourceKey: string;
    externalId?: string;
    canonicalUrl?: string;
  }
): { jobId: string; deduped: boolean } {
  return db.transaction((tx) => {
    const active = tx
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(
        and(
          eq(importJobs.notebookId, args.notebookId),
          eq(importJobs.resourceKey, args.resourceKey),
          not(inArray(importJobs.status, TERMINAL))
        )
      )
      .all();
    if (active[0]) return { jobId: active[0].id, deduped: true };

    const now = Date.now();
    const jobId = randomUUID();
    tx.insert(importJobs)
      .values({
        id: jobId,
        ...args,
        status: "queued",
        attempts: 0,
        maxAttempts: MAX_ATTEMPTS_DEFAULT,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return { jobId, deduped: false };
  }, { behavior: "immediate" });
}

export function listImportJobsByNotebook(db: LocalDb, notebookId: string) {
  const rows = db
    .select()
    .from(importJobs)
    .where(eq(importJobs.notebookId, notebookId))
    .orderBy(desc(importJobs.createdAt))
    .limit(30)
    .all();
  return rows.map(toJobDoc);
}

export function getImportJob(db: LocalDb, jobId: string): ImportJobDoc | null {
  const row = db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1).get();
  return row ? toJobDoc(row) : null;
}

export function cancelImportJob(db: LocalDb, jobId: string): void {
  db.transaction((tx) => {
    const job = tx.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1).get();
    if (!job) throw new Error("Job nicht gefunden");
    if (TERMINAL.includes(job.status)) throw new Error("Job ist bereits abgeschlossen");
    tx.update(importJobs)
      .set({ status: "cancelled", leaseToken: null, updatedAt: Date.now() })
      .where(eq(importJobs.id, jobId))
      .run();
  }, { behavior: "immediate" });
}

export function retryImportJob(db: LocalDb, jobId: string): void {
  db.transaction((tx) => {
    const job = tx.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1).get();
    if (!job) throw new Error("Job nicht gefunden");
    if (!["failed", "cancelled"].includes(job.status)) {
      throw new Error("Nur fehlgeschlagene oder abgebrochene Jobs können wiederholt werden");
    }
    tx.update(importJobs)
      .set({
        status: "queued",
        attempts: 0,
        nextAttemptAt: Date.now(),
        errorCode: null,
        errorMessage: null,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: Date.now(),
      })
      .where(eq(importJobs.id, jobId))
      .run();
  }, { behavior: "immediate" });
}

/** Raw SELECT with camelCase aliases (raw rows come back snake_case). */
const JOB_COLUMNS = `id, owner_id AS "ownerId", notebook_id AS "notebookId", url, provider, kind,
  resource_key AS "resourceKey", external_id AS "externalId", canonical_url AS "canonicalUrl",
  status, attempts, max_attempts AS "maxAttempts", next_attempt_at AS "nextAttemptAt",
  lease_token AS "leaseToken", lease_expires_at AS "leaseExpiresAt",
  error_code AS "errorCode", error_message AS "errorMessage",
  source_id AS "sourceId", title, created_at AS "createdAt", updated_at AS "updatedAt"`;

/** Atomic claim with lease. BEGIN IMMEDIATE so concurrent claimants serialize;
 *  reclaims jobs whose lease expired (worker crash). A crashed job that has
 *  burned all attempts is failed instead of reclaimed — a file that kills the
 *  worker must not loop forever. */
export function claimImportJob(db: LocalDb): ImportJobDoc | null {
  const sqlite = rawClient(db);
  const run = sqlite.transaction((): Row | null => {
    const now = Date.now();
    let stale = false;
    let row = sqlite
      .prepare(
        `SELECT ${JOB_COLUMNS} FROM import_jobs
         WHERE status = 'queued' AND next_attempt_at <= ?
         ORDER BY next_attempt_at ASC LIMIT 1`
      )
      .get(now) as Row | undefined;
    if (!row) {
      stale = true;
      row = sqlite
        .prepare(
          `SELECT ${JOB_COLUMNS} FROM import_jobs
           WHERE lease_expires_at IS NOT NULL AND lease_expires_at < ?
             AND status IN ${RUNNING_SQL}
           ORDER BY lease_expires_at ASC LIMIT 1`
        )
        .get(now) as Row | undefined;
    }
    if (!row) return null;
    if (stale && row.attempts >= row.maxAttempts) {
      sqlite
        .prepare(
          `UPDATE import_jobs SET status='failed', error_code='internal',
           error_message='Nach wiederholten Abstürzen abgebrochen',
           lease_token=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?`
        )
        .run(now, row.id);
      return null;
    }
    const token = randomUUID();
    sqlite
      .prepare(
        `UPDATE import_jobs SET status='inspecting', attempts=attempts+1, lease_token=?,
         lease_expires_at=?, updated_at=? WHERE id=?`
      )
      .run(token, now + LEASE_MS, now, row.id);
    return { ...row, status: "inspecting", attempts: row.attempts + 1, leaseToken: token, leaseExpiresAt: now + LEASE_MS };
  });
  const row = run.immediate();
  return row ? toJobDoc(row) : null;
}

export function heartbeatImportJob(db: LocalDb, jobId: string, token: string): boolean {
  const now = Date.now();
  const res = rawClient(db)
    .prepare(
      `UPDATE import_jobs SET lease_expires_at=?, updated_at=?
       WHERE id=? AND lease_token=? AND status IN ${RUNNING_SQL}`
    )
    .run(now + LEASE_MS, now, jobId, token);
  return res.changes > 0;
}

export function updateImportJobPhase(
  db: LocalDb,
  jobId: string,
  token: string,
  phase: "inspecting" | "awaiting_selection" | "downloading" | "processing",
  title?: string
): boolean {
  const now = Date.now();
  const res = rawClient(db)
    .prepare(
      `UPDATE import_jobs SET status=?, ${title !== undefined ? "title=?," : ""} updated_at=?
       WHERE id=? AND lease_token=? AND status IN ${RUNNING_SQL}`
    )
    .run(...(title !== undefined ? [phase, title, now, jobId, token] : [phase, now, jobId, token]));
  return res.changes > 0;
}

export function failImportJob(
  db: LocalDb,
  jobId: string,
  token: string,
  failure: { errorCode: string; errorMessage: string; transient: boolean; retryAfterMs?: number }
): boolean {
  return db.transaction((tx) => {
    const job = tx.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1).get();
    if (!job || job.leaseToken !== token) return false;
    const now = Date.now();
    if (failure.transient && job.attempts < job.maxAttempts) {
      const backoff =
        failure.retryAfterMs ?? Math.min(15_000 * 2 ** (job.attempts - 1), 10 * 60_000);
      tx.update(importJobs)
        .set({
          status: "queued",
          nextAttemptAt: now + backoff,
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(importJobs.id, jobId))
        .run();
      return true;
    }
    tx.update(importJobs)
      .set({
        status: "failed",
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(importJobs.id, jobId))
      .run();
    return true;
  }, { behavior: "immediate" });
}

export interface CompleteSourceInput {
  fileName: string;
  fileType: string;
  fileSize: number;
  url: string;
  provider: string;
  storageId?: string;
  canonicalUrl?: string;
  externalId?: string;
  title?: string;
  author?: string;
  language?: string;
}

/** Atomic completion: create-or-reuse the source, replace its chunks
 *  idempotently, mark the job done. Retries never duplicate sources/chunks.
 *  When an existing source is re-imported with a new original file, the
 *  superseded file id is returned in staleFileIds — the caller deletes the
 *  bytes after the commit (a disk rm must never sit inside the SQL tx). */
export function completeImportJob(
  db: LocalDb,
  jobId: string,
  token: string,
  source: CompleteSourceInput,
  chunkList: { content: string; chunkIndex: number }[]
): { ok: boolean; sourceId?: string; staleFileIds?: string[] } {
  return db.transaction((tx) => {
    const job = tx.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1).get();
    if (!job || job.leaseToken !== token || !RUNNING.includes(job.status as (typeof RUNNING)[number])) {
      return { ok: false };
    }
    const now = Date.now();
    const staleFileIds: string[] = [];

    let sourceId = job.sourceId;
    if (!sourceId && source.externalId) {
      const existing = tx
        .select({ id: sources.id })
        .from(sources)
        .where(
          and(
            eq(sources.notebookId, job.notebookId),
            eq(sources.provider, source.provider),
            eq(sources.externalId, source.externalId)
          )
        )
        .limit(1)
        .all();
      if (existing[0]) sourceId = existing[0].id;
    }

    if (sourceId) {
      const old = tx
        .select({ storageId: sources.storageId })
        .from(sources)
        .where(eq(sources.id, sourceId))
        .limit(1)
        .get();
      if (source.storageId && old?.storageId && old.storageId !== source.storageId) {
        staleFileIds.push(old.storageId);
      }
      tx.delete(chunks).where(eq(chunks.sourceId, sourceId)).run();
      tx.update(sources)
        .set({
          fileName: source.fileName,
          fileType: source.fileType,
          fileSize: source.fileSize,
          url: source.url,
          status: "completed",
          errorMessage: null,
          ...(source.storageId !== undefined && { storageId: source.storageId }),
          ...(source.canonicalUrl !== undefined && { canonicalUrl: source.canonicalUrl }),
          ...(source.externalId !== undefined && { externalId: source.externalId }),
          ...(source.author !== undefined && { author: source.author }),
          ...(source.language !== undefined && { language: source.language }),
          importedAt: now,
          updatedAt: now,
        })
        .where(eq(sources.id, sourceId))
        .run();
    } else {
      sourceId = randomUUID();
      tx.insert(sources)
        .values({
          id: sourceId,
          ownerId: job.ownerId,
          notebookId: job.notebookId,
          fileName: source.fileName,
          fileType: source.fileType,
          fileSize: source.fileSize,
          url: source.url,
          status: "completed",
          provider: source.provider,
          ...(source.storageId !== undefined && { storageId: source.storageId }),
          ...(source.canonicalUrl !== undefined && { canonicalUrl: source.canonicalUrl }),
          ...(source.externalId !== undefined && { externalId: source.externalId }),
          ...(source.author !== undefined && { author: source.author }),
          ...(source.language !== undefined && { language: source.language }),
          importedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    // SQLite caps host parameters per statement (~32k) — batch big inserts
    const CHUNK_BATCH = 500;
    for (let i = 0; i < chunkList.length; i += CHUNK_BATCH) {
      tx.insert(chunks)
        .values(
          chunkList.slice(i, i + CHUNK_BATCH).map((c) => ({
            id: randomUUID(),
            ownerId: job.ownerId,
            sourceId: sourceId!,
            notebookId: job.notebookId,
            content: c.content,
            chunkIndex: c.chunkIndex,
            embeddingId: `emb_${sourceId}_${c.chunkIndex}`,
            createdAt: now,
          }))
        )
        .run();
    }

    tx.update(importJobs)
      .set({
        status: "completed",
        sourceId,
        ...(source.title !== undefined && { title: source.title }),
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(importJobs.id, jobId))
      .run();
    return { ok: true, sourceId, staleFileIds };
  }, { behavior: "immediate" });
}
