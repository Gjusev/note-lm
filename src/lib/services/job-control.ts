/**
 * Unified job control (desktop-workers-plan, slice 1): one view over the
 * existing queues (processing_jobs, import_jobs, materials) with the user's
 * intent (run/pause/cancel) persisted separately from observed state, plus a
 * durable event log the activity center resumes from via cursor.
 *
 * The engine is the sole state writer: intents are recorded here, the
 * scheduler loop reads them before claiming/executing and only it confirms
 * state transitions — a worker never marks its own job complete.
 */
import type { LocalDb } from "@/db/local";
import { rawClient } from "@/db/local";
import { releaseImportJob } from "./import-jobs";
import { releaseProcessingJob, failProcessingJob } from "./processing-jobs";

export type JobKind = "processing" | "import" | "material";
export type JobIntent = "run" | "pause" | "cancel";

/**
 * Result of observing a job's user intent at a stage boundary: "run" proceeds,
 * "paused"/"cancelled" mean the runner released its lease accordingly, "lost"
 * means the lease was already gone (another claimant fenced us out).
 */
export type IntentObservation = "run" | "paused" | "cancelled" | "lost";

export interface UnifiedJob {
  kind: JobKind;
  id: string;
  notebookId: string;
  title: string;
  status: string;
  intent: JobIntent; // user intent; observed status may lag (pause in flight)
  updatedAt: number;
}

export interface JobEvent {
  seq: number;
  jobKind: JobKind;
  jobId: string;
  type: string;
  payload: string | null;
}

export function setJobIntent(
  db: LocalDb,
  kind: JobKind,
  jobId: string,
  intent: JobIntent
): void {
  const sqlite = rawClient(db);
  const now = Date.now();
  sqlite
    .prepare(
      `INSERT INTO job_intents (job_kind, job_id, intent, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (job_kind, job_id) DO UPDATE SET intent = excluded.intent, updated_at = excluded.updated_at`
    )
    .run(kind, jobId, intent, now);
  emitJobEvent(db, kind, jobId, `intent.${intent}`);
}

export function getJobIntent(db: LocalDb, kind: JobKind, jobId: string): JobIntent {
  const sqlite = rawClient(db);
  const row = sqlite
    .prepare(`SELECT intent FROM job_intents WHERE job_kind = ? AND job_id = ?`)
    .get(kind, jobId) as { intent: JobIntent } | undefined;
  return row?.intent ?? "run";
}

/**
 * Stage-boundary gate shared by both lease-fenced runners (extracted from
 * imports.ts enterPhase, slice 3a): observe a pending user intent and release
 * the lease accordingly. pause refunds the attempt back to the queue, cancel
 * ends the job. Checked before and after the runner's hook — the hook itself
 * may record an intent (that is how the engine loop and tests pause/cancel
 * mid-run). Returns "run" to proceed into the stage.
 */
export function observeJobIntent(
  db: LocalDb,
  kind: "import" | "processing",
  jobId: string,
  token: string
): IntentObservation {
  const intent = getJobIntent(db, kind, jobId);
  if (intent === "pause") {
    const released =
      kind === "import"
        ? releaseImportJob(db, jobId, token, "queued")
        : releaseProcessingJob(db, jobId, token);
    if (!released) return "lost";
    emitJobEvent(db, kind, jobId, "paused");
    return "paused";
  }
  if (intent === "cancel") {
    const released =
      kind === "import"
        ? releaseImportJob(db, jobId, token, "cancelled")
        : failProcessingJob(db, jobId, token, {
            errorMessage: "Vom Benutzer abgebrochen",
            transient: false,
          });
    if (!released) return "lost";
    emitJobEvent(db, kind, jobId, "cancelled");
    return "cancelled";
  }
  return "run";
}

export function emitJobEvent(
  db: LocalDb,
  kind: JobKind,
  jobId: string,
  type: string,
  payload?: unknown
): void {
  const sqlite = rawClient(db);
  sqlite
    .prepare(`INSERT INTO job_events (job_kind, job_id, type, payload) VALUES (?, ?, ?, ?)`)
    .run(kind, jobId, type, payload === undefined ? null : JSON.stringify(payload));
}

export function eventsSince(db: LocalDb, cursor: number, limit = 200): JobEvent[] {
  const sqlite = rawClient(db);
  return sqlite
    .prepare(
      `SELECT seq, job_kind AS "jobKind", job_id AS "jobId", type, payload
       FROM job_events WHERE seq > ? ORDER BY seq ASC LIMIT ?`
    )
    .all(cursor, limit) as JobEvent[];
}

/** Unified snapshot: existing queues + pending materials, intents joined in. */
export function listJobs(db: LocalDb, notebookId?: string): UnifiedJob[] {
  const sqlite = rawClient(db);
  const jobs: UnifiedJob[] = [];

  const processing = sqlite
    .prepare(
      `SELECT p.id, p.notebook_id, p.status, p.updated_at, s.file_name
       FROM processing_jobs p JOIN sources s ON s.id = p.source_id
       ${notebookId ? "WHERE p.notebook_id = ?" : ""}
       ORDER BY p.updated_at DESC LIMIT 100`
    )
    .all(...(notebookId ? [notebookId] : [])) as Array<{
    id: string; notebook_id: string; status: string; updated_at: number; file_name: string;
  }>;
  for (const p of processing) {
    jobs.push({
      kind: "processing",
      id: p.id,
      notebookId: p.notebook_id,
      title: p.file_name,
      status: p.status,
      intent: getJobIntent(db, "processing", p.id),
      updatedAt: p.updated_at,
    });
  }

  const imports = sqlite
    .prepare(
      `SELECT id, notebook_id, status, updated_at, COALESCE(title, url) AS title
       FROM import_jobs ${notebookId ? "WHERE notebook_id = ?" : ""}
       ORDER BY updated_at DESC LIMIT 100`
    )
    .all(...(notebookId ? [notebookId] : [])) as Array<{
    id: string; notebook_id: string; status: string; updated_at: number; title: string;
  }>;
  for (const j of imports) {
    jobs.push({
      kind: "import",
      id: j.id,
      notebookId: j.notebook_id,
      title: j.title,
      status: j.status,
      intent: getJobIntent(db, "import", j.id),
      updatedAt: j.updated_at,
    });
  }

  const materials = sqlite
    .prepare(
      `SELECT id, notebook_id, status, updated_at, type
       FROM learning_materials ${notebookId ? "WHERE notebook_id = ?" : ""}
       ORDER BY updated_at DESC LIMIT 100`
    )
    .all(...(notebookId ? [notebookId] : [])) as Array<{
    id: string; notebook_id: string; status: string; updated_at: number; type: string;
  }>;
  for (const m of materials) {
    jobs.push({
      kind: "material",
      id: m.id,
      notebookId: m.notebook_id,
      title: `Lernmaterial · ${m.type}`,
      status: m.status,
      intent: getJobIntent(db, "material", m.id),
      updatedAt: m.updated_at,
    });
  }

  jobs.sort((a, b) => b.updatedAt - a.updatedAt);
  return jobs;
}

/** Leased queue tables that checkpoints fence against; materials have no lease. */
const LEASE_TABLE: Partial<Record<JobKind, string>> = {
  processing: "processing_jobs",
  import: "import_jobs",
};

/**
 * Token-fenced stage checkpoint upsert (desktop-workers-plan slice 3a):
 * verifies the writer still owns the live lease inside the write transaction,
 * so a stale runner's cursor can never clobber the winning attempt's.
 * cursor is a JSON string (or null). Returns false when fenced out.
 */
export function setJobCheckpoint(
  db: LocalDb,
  kind: JobKind,
  jobId: string,
  token: string,
  stage: string,
  cursor: string | null
): boolean {
  const table = LEASE_TABLE[kind];
  if (!table) return false; // materials have no lease to fence against
  const sqlite = rawClient(db);
  const run = sqlite.transaction((): boolean => {
    const job = sqlite
      .prepare(`SELECT lease_token FROM ${table} WHERE id = ?`)
      .get(jobId) as { lease_token: string | null } | undefined;
    if (!job || job.lease_token !== token) return false;
    sqlite
      .prepare(
        `INSERT INTO job_checkpoints (job_kind, job_id, stage, v, cursor, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT (job_kind, job_id, stage) DO UPDATE SET
           v = v + 1, cursor = excluded.cursor, updated_at = excluded.updated_at`
      )
      .run(kind, jobId, stage, cursor, Date.now());
    return true;
  });
  return run.immediate();
}

export interface JobCheckpoint {
  stage: string;
  cursor: string | null;
  updatedAt: number;
}

/** Resume markers of a job, ordered by stage. */
export function getJobCheckpoints(db: LocalDb, kind: JobKind, jobId: string): JobCheckpoint[] {
  return rawClient(db)
    .prepare(
      `SELECT stage, cursor, updated_at AS "updatedAt" FROM job_checkpoints
       WHERE job_kind = ? AND job_id = ? ORDER BY stage ASC`
    )
    .all(kind, jobId) as JobCheckpoint[];
}

/** Drop a job's resume markers (terminal state — nothing left to resume). */
export function deleteJobCheckpoints(db: LocalDb, kind: JobKind, jobId: string): void {
  rawClient(db)
    .prepare(`DELETE FROM job_checkpoints WHERE job_kind = ? AND job_id = ?`)
    .run(kind, jobId);
}
