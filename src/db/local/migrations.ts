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
