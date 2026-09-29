/**
 * Versioned migrations for the local SQLite database, applied through
 * PRAGMA user_version. Each entry is one migration; append-only.
 *
 * ponytail: hand-written SQL + user_version instead of drizzle-kit's file-
 * based journal — no bundling concerns for `next start`, tsx worker and tests
 * all apply the same list through openLocalDb(). Switch to drizzle-kit
 * migrations if migrations need generating/editing by tooling.
 */
export const MIGRATIONS: string[] = [
  // 0001 — initial schema
  `
CREATE TABLE notebooks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX notebooks_by_owner_updated ON notebooks (owner_id, updated_at);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  notebook_id TEXT NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_id TEXT,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  transcript_storage_id TEXT,
  error_message TEXT,
  provider TEXT,
  canonical_url TEXT,
  external_id TEXT,
  author TEXT,
  language TEXT,
  imported_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX sources_by_notebook ON sources (notebook_id);
CREATE INDEX sources_by_owner ON sources (owner_id);
CREATE INDEX sources_by_notebook_status ON sources (notebook_id, status);
CREATE INDEX sources_by_notebook_provider_external ON sources (notebook_id, provider, external_id);

CREATE TABLE processing_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  notebook_id TEXT NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER,
  error_message TEXT,
  lease_token TEXT,
  lease_expires_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX processing_jobs_by_source ON processing_jobs (source_id);
CREATE INDEX processing_jobs_by_notebook ON processing_jobs (notebook_id);
CREATE INDEX processing_jobs_by_status ON processing_jobs (status);
CREATE INDEX processing_jobs_by_lease ON processing_jobs (lease_expires_at);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  notebook_id TEXT NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX chunks_by_source ON chunks (source_id);
CREATE INDEX chunks_by_notebook ON chunks (notebook_id);
CREATE UNIQUE INDEX chunks_unique_source_index ON chunks (source_id, chunk_index);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  notebook_id TEXT NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_by_notebook_created ON messages (notebook_id, created_at);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  notebook_id TEXT NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX notes_by_notebook ON notes (notebook_id);
CREATE INDEX notes_by_owner ON notes (owner_id);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  notebook_id TEXT NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  external_id TEXT,
  canonical_url TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_expires_at INTEGER,
  error_code TEXT,
  error_message TEXT,
  source_id TEXT,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX import_jobs_by_notebook_created ON import_jobs (notebook_id, created_at);
CREATE INDEX import_jobs_by_status_next_attempt ON import_jobs (status, next_attempt_at);
CREATE INDEX import_jobs_by_notebook_resource ON import_jobs (notebook_id, resource_key);
CREATE INDEX import_jobs_by_lease_expires ON import_jobs (lease_expires_at);

CREATE TABLE learning_materials (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  notebook_id TEXT NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  content TEXT,
  audio_file_id TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX materials_by_notebook ON learning_materials (notebook_id);
CREATE INDEX materials_by_notebook_type ON learning_materials (notebook_id, type);
CREATE INDEX materials_by_owner ON learning_materials (owner_id);

CREATE TABLE profile (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`,
  // 0002 — RAG metadata (issue #3): versions, embedding profiles, chunk
  // embedding state and retrieval debug runs. vec0 tables are created per
  // profile at activation time (they need the sqlite-vec extension loaded).
  `
CREATE TABLE source_versions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  extractor TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX source_versions_unique ON source_versions (source_id, version);
CREATE INDEX source_versions_by_source ON source_versions (source_id);

CREATE TABLE embedding_profiles (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  revision TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  pooling TEXT NOT NULL,
  normalize INTEGER NOT NULL DEFAULT 1,
  query_prefix TEXT NOT NULL DEFAULT '',
  doc_prefix TEXT NOT NULL DEFAULT '',
  processing_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX embedding_profiles_natural
  ON embedding_profiles (provider, model, revision);

CREATE TABLE chunk_embeddings (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES embedding_profiles (id) ON DELETE CASCADE,
  text_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX chunk_embeddings_unique ON chunk_embeddings (chunk_id, profile_id);
CREATE INDEX chunk_embeddings_by_status ON chunk_embeddings (profile_id, status);

CREATE TABLE retrieval_runs (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL,
  profile_id TEXT,
  config TEXT NOT NULL,
  result_chunk_ids TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX retrieval_runs_by_notebook ON retrieval_runs (notebook_id, created_at);
`,
  // 0003 — the profile identity is the FULL recipe (finding 3): the same
  // provider/model/revision with a different dimension, pooling or prefix
  // is a DIFFERENT profile; vectors must never be silently reused.
  `
DROP INDEX IF EXISTS embedding_profiles_natural;
CREATE UNIQUE INDEX embedding_profiles_natural
  ON embedding_profiles (provider, model, revision, dimension, pooling,
                          query_prefix, doc_prefix, processing_version);
`,
  // 0004 — model library (phase 5): GGUF files managed by the app, verified
  // by content hash; capability separates chat from embeddings models.
  `
CREATE TABLE models (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL CHECK (capability IN ('chat', 'embeddings')),
  file_name TEXT NOT NULL,
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  origin TEXT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'importing', 'failed')),
  error_message TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX models_by_sha256 ON models (sha256);
CREATE INDEX models_by_capability ON models (capability, status);
`,
  // 0005 — unified job control (desktop-workers-plan): user intent separated
  // from observed state, and a durable event log with a monotonic cursor so
  // the activity center can rebuild from snapshot + events after a restart.
  `
CREATE TABLE job_intents (
  job_kind TEXT NOT NULL,
  job_id TEXT NOT NULL,
  intent TEXT NOT NULL CHECK (intent IN ('run', 'pause', 'cancel')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (job_kind, job_id)
);
CREATE TABLE job_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  job_kind TEXT NOT NULL,
  job_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT
);
`,
  // 0006 — job checkpoints (desktop-workers-plan slice 3a): per-stage resume
  // markers keyed by (kind, job, stage). Writes are token-fenced against the
  // live lease, so a stale runner's cursor can never clobber the winner's.
  `
CREATE TABLE job_checkpoints (
  job_kind TEXT NOT NULL,
  job_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 1,
  cursor TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (job_kind, job_id, stage)
);
`,
  // 0007 — versioned evidence (open-source-innovation-strategy 5A/5B):
  // immutable document versions. Replaces the never-used RAG-plan
  // source_versions table from 0002 (no service ever read or wrote it): a
  // version now references the persisted original bytes (storage_id), carries
  // the sha256 file hash (identical re-imports dedupe) and the page count of
  // the per-version sidecar JSON under files/versions/. Claims in later
  // slices anchor to versions, never to the mutable source row.
  `
DROP TABLE IF EXISTS source_versions;
CREATE TABLE source_versions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  storage_id TEXT,
  file_hash TEXT,
  page_count INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (source_id, version)
);
`,
  // 0008 — claims & evidence anchors (open-source-innovation-strategy 5A/5B,
  // slice S2). Claims anchor to immutable versions; anchors carry the page
  // only when truly known (never invented). review_proposals records the
  // deterministic staleness findings of change review; acceptance/rejection
  // keeps the history (from/to versions + human note). provenance on
  // learning_materials is a snapshot of {sourceId: versionId} written by a
  // later slice - the migration lands the column now.
  `
CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  notebook_id TEXT NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('user', 'chat')),
  origin_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reviewed', 'retired')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX claims_by_notebook ON claims (notebook_id);
CREATE INDEX claims_by_owner ON claims (owner_id);

CREATE TABLE evidence_anchors (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  source_version_id TEXT NOT NULL REFERENCES source_versions (id) ON DELETE CASCADE,
  page INTEGER,
  quote TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'pdf_page',
  created_at INTEGER NOT NULL
);
CREATE INDEX anchors_by_version ON evidence_anchors (source_version_id);

CREATE TABLE evidence_links (
  claim_id TEXT NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  anchor_id TEXT NOT NULL REFERENCES evidence_anchors (id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'supports' CHECK (relation IN ('supports', 'questions')),
  PRIMARY KEY (claim_id, anchor_id)
);

CREATE TABLE review_proposals (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('quote_missing', 'quote_moved')),
  detail TEXT,
  anchor_id TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  resolved_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX proposals_by_claim ON review_proposals (claim_id);
CREATE INDEX proposals_by_status ON review_proposals (status);

ALTER TABLE learning_materials ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learning_materials ADD COLUMN provenance TEXT;
`,
  // 0009 — provider run telemetry (multi-provider plan, slice S3): one row per
  // model call at the capability seam. Tokens are stored only when the provider
  // actually returned usage (unknown is null, never zero); no prompt text is
  // ever persisted. Pruned opportunistically (engine boot, keepDays = 30).
  `
CREATE TABLE provider_runs (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  latency_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  ok INTEGER NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_provider_runs_created ON provider_runs(created_at);
`,
  // 0010 — inspectable calculations (open-source-innovation-strategy 5C): one
  // row per deterministic op over one immutable source_version sidecar. Input
  // version + query + result + timestamp together are the reproducibility
  // record — no LLM ever computes the number. Blocked ops (ambiguous cells,
  // E4 "bloquear o marcar ambigüedad", v1 blocks) never produce a row.
  `
CREATE TABLE calculations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  notebook_id TEXT NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
  source_version_id TEXT NOT NULL REFERENCES source_versions (id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  args_json TEXT NOT NULL,
  result TEXT,
  unit TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX calculations_by_notebook ON calculations (notebook_id);
`,
  // 0011 — media time-range anchors (open-source-innovation-strategy 5A):
  // evidence anchors gain a JSON locator for locators beyond pages. A
  // time_range anchor stores {startSec, endSec} (endSec null = open end) and
  // page stays null - page and locator are never both required.
  `
ALTER TABLE evidence_anchors ADD COLUMN locator TEXT;
`,
  // 0012 — durable review-scan ledger (priority-1 fix): every appended
  // version writes one review_scans row BEFORE scanning, so a crashed or
  // failed scan survives the process and is re-run at engine startup
  // (reconcileReviewScans). The partial unique index makes a pending proposal
  // per (anchor, target version) a DB-level invariant, not just an app check.
  `
CREATE TABLE review_scans (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  from_version INTEGER NOT NULL,
  to_version_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX review_scans_by_source ON review_scans (source_id);
CREATE UNIQUE INDEX proposals_unique_pending
  ON review_proposals (anchor_id, to_version) WHERE status = 'pending';
`,
  // 0013 — chunk provenance: every chunk row carries the source_version id of
  // the run that produced it, so citations resolve to the version FROM THE
  // CHUNK instead of guessing at retrieval time. Nullable: legacy writers
  // (fetch-url/search routes) and pre-0013 rows stay null and keep the
  // latest-version fallback. Backfill: existing chunks get their source's
  // CURRENT latest version id (best available estimate; sources without any
  // version stay null).
  `
ALTER TABLE chunks ADD COLUMN source_version_id TEXT;
UPDATE chunks SET source_version_id = (
  SELECT v.id FROM source_versions v
  WHERE v.source_id = chunks.source_id
  ORDER BY v.version DESC LIMIT 1
);
`,
];

/** FTS5 index over chunk content, kept in sync by triggers._bm25-ranked
 * notebook-scoped search without an external search server. Idempotent. */
export const FTS_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content,
  source_id UNINDEXED,
  notebook_id UNINDEXED,
  chunk_index UNINDEXED,
  tokenize = 'unicode61'
);
CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts (rowid, content, source_id, notebook_id, chunk_index)
  VALUES (new.rowid, new.content, new.source_id, new.notebook_id, new.chunk_index);
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON chunks BEGIN
  DELETE FROM chunks_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_au AFTER UPDATE ON chunks BEGIN
  DELETE FROM chunks_fts WHERE rowid = old.rowid;
  INSERT INTO chunks_fts (rowid, content, source_id, notebook_id, chunk_index)
  VALUES (new.rowid, new.content, new.source_id, new.notebook_id, new.chunk_index);
END;
`;
