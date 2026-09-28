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

export type JobKind = "processing" | "import" | "material";
export type JobIntent = "run" | "pause" | "cancel";

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
