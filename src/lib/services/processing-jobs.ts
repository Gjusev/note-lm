import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { rawClient, type LocalDb } from "@/db/local";
import { processingJobs } from "@/db/local/schema";
import { toWire } from "./wire";

/**
 * Queue for manual-upload processing (extract/transcribe → chunk), replacing
 * the fire-and-forget POST /api/process. Same lease/fencing/backoff pattern as
 * import jobs, simplified to pending → running → completed/failed. Revives the
 * previously dead processingJobs table with a real producer (upload route)
 * and consumer (local worker). Sync transaction callbacks (better-sqlite3).
 */

const LEASE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;

type Row = typeof processingJobs.$inferSelect;

export function toProcessingDoc(row: Row) {
  return toWire(row);
}

const PJ_COLUMNS = `id, owner_id AS "ownerId", source_id AS "sourceId", notebook_id AS "notebookId",
  type, status, progress, error_message AS "errorMessage", lease_token AS "leaseToken",
  lease_expires_at AS "leaseExpiresAt", attempts, created_at AS "createdAt", updated_at AS "updatedAt"`;

export function enqueueProcessingJob(
  db: LocalDb,
  args: { ownerId: string; sourceId: string; notebookId: string; type?: string }
): string {
  const now = Date.now();
  const id = randomUUID();
  db.insert(processingJobs)
    .values({
      id,
      ownerId: args.ownerId,
      sourceId: args.sourceId,
      notebookId: args.notebookId,
      type: (args.type as "source") ?? "source",
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

/** A paused/cancelled intent must never be claimed: claiming-and-releasing
 *  every tick would starve the sibling queue and flood job_events. */
const CLAIM_INTENT_FILTER = (kind: string, table: string) =>
  `AND NOT EXISTS (SELECT 1 FROM job_intents ji WHERE ji.job_kind = '${kind}'
     AND ji.job_id = ${table}.id AND ji.intent IN ('pause','cancel'))`;

/** Atomic claim with lease; reclaims jobs whose worker crashed mid-run.
 *  Pending rows whose lease_expires_at lies in the future are waiting out a
 *  transient-failure backoff (column reused as the not-before gate). */
export function claimProcessingJob(db: LocalDb): Row | null {
  const sqlite = rawClient(db);
  const run = sqlite.transaction((): Row | null => {
    const now = Date.now();
    let stale = false;
    let row = sqlite
      .prepare(
        `SELECT ${PJ_COLUMNS} FROM processing_jobs
         WHERE status = 'pending' AND (lease_expires_at IS NULL OR lease_expires_at < ?)
         ${CLAIM_INTENT_FILTER("processing", "processing_jobs")}
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(now) as Row | undefined;
    if (!row) {
      stale = true;
      row = sqlite
        .prepare(
          `SELECT ${PJ_COLUMNS} FROM processing_jobs
           WHERE lease_expires_at IS NOT NULL AND lease_expires_at < ? AND status = 'running'
           ${CLAIM_INTENT_FILTER("processing", "processing_jobs")}
           ORDER BY lease_expires_at ASC LIMIT 1`
        )
        .get(now) as Row | undefined;
    }
    if (!row) return null;
    if (stale && row.attempts >= MAX_ATTEMPTS) {
      // a job that keeps crashing the worker must not loop forever
      sqlite
        .prepare(
          `UPDATE processing_jobs SET status='failed',
           error_message='Nach wiederholten Abstürzen abgebrochen',
           lease_token=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?`
        )
        .run(now, row.id);
      return null;
    }
    const token = randomUUID();
    sqlite
      .prepare(
        `UPDATE processing_jobs SET status='running', attempts=attempts+1, lease_token=?,
         lease_expires_at=?, updated_at=? WHERE id=?`
      )
      .run(token, now + LEASE_MS, now, row.id);
    return { ...row, status: "running", attempts: row.attempts + 1, leaseToken: token, leaseExpiresAt: now + LEASE_MS };
  });
  return run.immediate();
}

export function heartbeatProcessingJob(db: LocalDb, jobId: string, token: string): boolean {
  const now = Date.now();
  const res = rawClient(db)
    .prepare(
      `UPDATE processing_jobs SET lease_expires_at=?, updated_at=? WHERE id=? AND lease_token=? AND status='running'`
    )
    .run(now + LEASE_MS, now, jobId, token);
  return res.changes > 0;
}

/** Fenced lease release (user pause observed mid-run): back to pending, the
 *  attempt is refunded and the job is immediately claimable again — mirrors
 *  releaseImportJob(to "queued"). False when the lease is already gone. */
export function releaseProcessingJob(db: LocalDb, jobId: string, token: string): boolean {
  const now = Date.now();
  const res = rawClient(db)
    .prepare(
      `UPDATE processing_jobs
       SET status='pending', attempts=MAX(attempts-1, 0), lease_token=NULL,
           lease_expires_at=NULL, updated_at=?
       WHERE id=? AND lease_token=? AND status='running'`
    )
    .run(now, jobId, token);
  return res.changes > 0;
}

export function completeProcessingJob(db: LocalDb, jobId: string, token: string): boolean {
  return db.transaction((tx) => {
    const job = tx.select().from(processingJobs).where(eq(processingJobs.id, jobId)).limit(1).get();
    if (!job || job.leaseToken !== token) return false;
    tx.update(processingJobs)
      .set({ status: "completed", leaseToken: null, leaseExpiresAt: null, updatedAt: Date.now() })
      .where(eq(processingJobs.id, jobId))
      .run();
    return true;
  }, { behavior: "immediate" });
}

/** End a not-yet-started job: the engine is the sole writer, so a plain
 *  status update (no fence) is safe for rows that were never claimed.
 *  Returns false when the job already left 'pending'. */
export function cancelPendingProcessingJob(db: LocalDb, jobId: string): boolean {
  const res = rawClient(db)
    .prepare(
      `UPDATE processing_jobs SET status='cancelled', lease_token=NULL, lease_expires_at=NULL, updated_at=?
       WHERE id=? AND status='pending'`
    )
    .run(Date.now(), jobId);
  return res.changes > 0;
}

/** Failure with the same backoff policy as import jobs; marks the source
 *  errored so the UI reflects the outcome regardless of retries. */
export function failProcessingJob(
  db: LocalDb,
  jobId: string,
  token: string,
  failure: { errorMessage: string; transient: boolean }
): boolean {
  return db.transaction((tx) => {
    const job = tx.select().from(processingJobs).where(eq(processingJobs.id, jobId)).limit(1).get();
    if (!job || job.leaseToken !== token) return false;
    const now = Date.now();
    if (failure.transient && job.attempts < MAX_ATTEMPTS) {
      // No next_attempt_at column: pending jobs whose lease_expires_at is in
      // the future wait, so reuse it as the not-before gate.
      const backoff = Math.min(15_000 * 2 ** (job.attempts - 1), 10 * 60_000);
      tx.update(processingJobs)
        .set({
          status: "pending",
          errorMessage: failure.errorMessage,
          leaseToken: null,
          leaseExpiresAt: now + backoff,
          updatedAt: now,
        })
        .where(eq(processingJobs.id, jobId))
        .run();
      return true;
    }
    tx.update(processingJobs)
      .set({ status: "failed", errorMessage: failure.errorMessage, leaseToken: null, leaseExpiresAt: null, updatedAt: now })
      .where(eq(processingJobs.id, jobId))
      .run();
    return true;
  }, { behavior: "immediate" });
}
