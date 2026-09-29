import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Local SQLite schema — 1:1 port of convex/schema.ts.
 * IDs stay text (crypto.randomUUID for new rows, Convex ids preserved on
 * migration); timestamps stay epoch milliseconds. API payloads keep the
 * Convex field name `_id` so the UI contract is unchanged.
 */

export type SourceStatus = "pending" | "processing" | "completed" | "error";
export type ProcessingJobType = "transcription" | "chunking" | "embedding" | "source";
export type ProcessingJobStatus = "pending" | "running" | "completed" | "failed";
export type ImportJobStatus =
  | "queued"
  | "inspecting"
  | "awaiting_selection"
  | "downloading"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";
export type MaterialType =
  | "summary"
  | "flashcards"
  | "quiz"
  | "studyGuide"
  | "keyInsights"
  | "podcastSummary"
  | "slides";
export type MaterialStatus = "pending" | "generating" | "completed" | "error";

export type ClaimOrigin = "user" | "chat";
export type ClaimStatus = "active" | "reviewed" | "retired";
export type AnchorRelation = "supports" | "questions";
export type ReviewReason = "quote_missing" | "quote_moved";
export type ReviewStatus = "pending" | "accepted" | "rejected";

export interface MessageCitation {
  sourceId: string;
  chunkIndex: number;
  text: string;
  fileName?: string;
  /** Provenance (priority-1 fix): the source_versions row retrieval actually
   * read, stamped at retrieval time so a re-import during generation can
   * never re-point the persisted citation. Absent on legacy citations. */
  sourceVersionId?: string;
  /** Media time range (strategy 5A) when the cited chunk is a transcript
   * segment: carried through evidence context into the persisted citation. */
  startSec?: number;
  endSec?: number | null;
}

export const notebooks = sqliteTable(
  "notebooks",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("notebooks_by_owner_updated").on(t.ownerId, t.updatedAt)],
);

/** Metadata for a file on disk under `<dataDir>/files/`. No FK: file rows are
 * created/deleted by the storage layer, sources only reference them. */
export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  path: text("path").notNull(), // relative to dataDir, POSIX separators, no ".."
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    notebookId: text("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    fileSize: integer("file_size").notNull(),
    storageId: text("storage_id"), // -> files.id (original upload)
    url: text("url"),
    status: text("status").$type<SourceStatus>().notNull().default("pending"),
    transcriptStorageId: text("transcript_storage_id"), // -> files.id
    errorMessage: text("error_message"),
    // Import provenance (optional, set by the resource importer)
    provider: text("provider"),
    canonicalUrl: text("canonical_url"),
    externalId: text("external_id"),
    author: text("author"),
    language: text("language"),
    importedAt: integer("imported_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("sources_by_notebook").on(t.notebookId),
    index("sources_by_owner").on(t.ownerId),
    index("sources_by_notebook_status").on(t.notebookId, t.status),
    index("sources_by_notebook_provider_external").on(t.notebookId, t.provider, t.externalId),
  ],
);

/** Manual uploads (transcription/chunking) queued for the worker. Shares the
 * single worker loop with import_jobs; `type: "source"` covers the whole
 * extract → chunk pipeline for one source. */
export const processingJobs = sqliteTable(
  "processing_jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    notebookId: text("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    type: text("type").$type<ProcessingJobType>().notNull(),
    status: text("status").$type<ProcessingJobStatus>().notNull().default("pending"),
    progress: integer("progress"),
    errorMessage: text("error_message"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: integer("lease_expires_at"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("processing_jobs_by_source").on(t.sourceId),
    index("processing_jobs_by_notebook").on(t.notebookId),
    index("processing_jobs_by_status").on(t.status),
    index("processing_jobs_by_lease").on(t.leaseExpiresAt),
  ],
);

export const chunks = sqliteTable(
  "chunks",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    notebookId: text("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    embeddingId: text("embedding_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("chunks_by_source").on(t.sourceId),
    index("chunks_by_notebook").on(t.notebookId),
    uniqueIndex("chunks_unique_source_index").on(t.sourceId, t.chunkIndex),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    notebookId: text("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    citations: text("citations", { mode: "json" }).$type<MessageCitation[] | null>(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("messages_by_notebook_created").on(t.notebookId, t.createdAt)],
);

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    notebookId: text("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("notes_by_notebook").on(t.notebookId), index("notes_by_owner").on(t.ownerId)],
);

export const importJobs = sqliteTable(
  "import_jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    notebookId: text("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(),
    resourceKey: text("resource_key").notNull(),
    externalId: text("external_id"),
    canonicalUrl: text("canonical_url"),
    status: text("status").$type<ImportJobStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: integer("lease_expires_at"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    sourceId: text("source_id"),
    title: text("title"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("import_jobs_by_notebook_created").on(t.notebookId, t.createdAt),
    index("import_jobs_by_status_next_attempt").on(t.status, t.nextAttemptAt),
    index("import_jobs_by_notebook_resource").on(t.notebookId, t.resourceKey),
    index("import_jobs_by_lease_expires").on(t.leaseExpiresAt),
  ],
);

export const learningMaterials = sqliteTable(
  "learning_materials",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    notebookId: text("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    type: text("type").$type<MaterialType>().notNull(),
    status: text("status").$type<MaterialStatus>().notNull().default("pending"),
    content: text("content"),
    audioFileId: text("audio_file_id"), // -> files.id
    errorMessage: text("error_message"),
    // change review (S2): flagged when a versioned source the material was
    // built from re-imports with changed bytes; provenance is a later slice's
    // snapshot of {sourceId: versionId} (legacy rows stay null, honest)
    needsReview: integer("needs_review").notNull().default(0),
    provenance: text("provenance"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("materials_by_notebook").on(t.notebookId),
    index("materials_by_notebook_type").on(t.notebookId, t.type),
    index("materials_by_owner").on(t.ownerId),
  ],
);

/** Single local profile (one row, id "local") — replaces Better Auth accounts. */
export const profile = sqliteTable("profile", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Key/value settings store (JSON-encoded values). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// ── RAG metadata (issue #3, migration 0002) ────────────────────────────────

/** Immutable snapshot of a source's original bytes + page texts (5A/5B).
 * Changed re-imports append versions; claims anchor to versions, never to the
 * mutable source row. Sidecar page texts live in files/versions/<id>.json. */
export const sourceVersions = sqliteTable(
  "source_versions",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    storageId: text("storage_id"),
    fileHash: text("file_hash"),
    pageCount: integer("page_count"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("source_versions_unique").on(t.sourceId, t.version)]
);

// ── Claims & evidence anchors (open-source-innovation-strategy 5A, migration 0008)

/** A human-saved or chat-saved statement. Statuses stay honest: never a
 * model-granted "verified" label. */
export const claims = sqliteTable(
  "claims",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    notebookId: text("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    origin: text("origin").$type<ClaimOrigin>().notNull(),
    originMessageId: text("origin_message_id"),
    status: text("status").$type<ClaimStatus>().notNull().default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("claims_by_notebook").on(t.notebookId), index("claims_by_owner").on(t.ownerId)]
);

/** Locators beyond pages (migration 0011): a time_range anchor carries
 * {startSec, endSec} - endSec null is an honest open end ("until the audio
 * ends"). Never invented: present only when the segmenter truly provided
 * the times. */
export type AnchorKind = "pdf_page" | "time_range";
export interface TimeRangeLocator {
  startSec: number;
  endSec: number | null;
}

/** Tolerant sidecar/locator reader: corrupt JSON or wrong shape stays null,
 * callers show "unresolvable" honestly instead of inventing times. */
export function parseTimeLocator(raw: string | null): TimeRangeLocator | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TimeRangeLocator> | null;
    return typeof parsed?.startSec === "number" ? { startSec: parsed.startSec, endSec: parsed.endSec ?? null } : null;
  } catch {
    return null;
  }
}

/** A citation made durable: IMMUTABLE version + locator (page only when
 * truly known - a page is never invented) + the quoted text. */
export const evidenceAnchors = sqliteTable(
  "evidence_anchors",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => sourceVersions.id, { onDelete: "cascade" }),
    page: integer("page"),
    locator: text("locator"),
    quote: text("quote").notNull(),
    kind: text("kind").$type<AnchorKind>().notNull().default("pdf_page"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("anchors_by_version").on(t.sourceVersionId)]
);

/** supports/questions relation between a claim and an anchor. */
export const evidenceLinks = sqliteTable(
  "evidence_links",
  {
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    anchorId: text("anchor_id")
      .notNull()
      .references(() => evidenceAnchors.id, { onDelete: "cascade" }),
    relation: text("relation").$type<AnchorRelation>().notNull().default("supports"),
  },
  (t) => [primaryKey({ columns: [t.claimId, t.anchorId] })]
);

/** Deterministic staleness finding of change review (5B). Flags changed
 * inputs, never a falsified conclusion; decisions keep the history. */
export const reviewProposals = sqliteTable(
  "review_proposals",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    fromVersion: integer("from_version").notNull(),
    toVersion: integer("to_version").notNull(),
    reason: text("reason").$type<ReviewReason>().notNull(),
    detail: text("detail"),
    anchorId: text("anchor_id"),
    note: text("note"), // human note, recorded verbatim, never overwritten
    status: text("status").$type<ReviewStatus>().notNull().default("pending"),
    resolvedAt: integer("resolved_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("proposals_by_claim").on(t.claimId),
    index("proposals_by_status").on(t.status),
    // priority-1 fix: one PENDING proposal per (anchor, target version) at the
    // DB level; decided proposals are terminal and never resurrected
    uniqueIndex("proposals_unique_pending").on(t.anchorId, t.toVersion)
      .where(sql`${t.status} = 'pending'`),
  ]
);

/** Durable ledger of change-review scans (migration 0012, priority-1 fix):
 * one row per appended version, written BEFORE the scan runs. A crashed or
 * failed scan is re-run at engine startup via reconcileReviewScans instead
 * of being lost with a console.error. */
export const reviewScans = sqliteTable(
  "review_scans",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(), // ledger is a log: no FK, sources may go away
    fromVersion: integer("from_version").notNull(),
    toVersionId: text("to_version_id").notNull(),
    status: text("status").$type<"pending" | "ok" | "failed">().notNull().default("pending"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (t) => [index("review_scans_by_source").on(t.sourceId)]
);

// ── Inspectable calculations (open-source-innovation-strategy 5C, migration 0010)

/** The reproducibility record: one deterministic op over one immutable
 * source_version sheet sidecar (input version + query + result + timestamp).
 * No LLM computes the number; blocked ops (ambiguous cells, E4) never
 * produce a row. unit stays null in v1 (units in headers are a later
 * refinement). */
export const calculations = sqliteTable(
  "calculations",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    notebookId: text("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => sourceVersions.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    argsJson: text("args_json").notNull(),
    result: text("result"),
    unit: text("unit"),
    status: text("status").notNull().default("ok"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("calculations_by_notebook").on(t.notebookId)]
);

/** How embeddings were produced — vectors from different profiles never mix. */
export const embeddingProfiles = sqliteTable(
  "embedding_profiles",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    revision: text("revision").notNull(),
    dimension: integer("dimension").notNull(),
    pooling: text("pooling").notNull(),
    normalize: integer("normalize").notNull().default(1),
    queryPrefix: text("query_prefix").notNull().default(""),
    docPrefix: text("doc_prefix").notNull().default(""),
    processingVersion: integer("processing_version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("embedding_profiles_natural").on(
      t.provider, t.model, t.revision, t.dimension, t.pooling,
      t.queryPrefix, t.docPrefix, t.processingVersion
    ),
  ]
);

/** Per-chunk embedding state for one profile (indexing is resumable). */
export const chunkEmbeddings = sqliteTable(
  "chunk_embeddings",
  {
    id: text("id").primaryKey(),
    chunkId: text("chunk_id")
      .notNull()
      .references(() => chunks.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => embeddingProfiles.id, { onDelete: "cascade" }),
    textHash: text("text_hash").notNull(),
    status: text("status").$type<"pending" | "indexing" | "indexed" | "error">().notNull().default("pending"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("chunk_embeddings_unique").on(t.chunkId, t.profileId),
    index("chunk_embeddings_by_status").on(t.profileId, t.status),
  ]
);

/** User intent for a job, separate from observed state (workers plan). */
export const jobIntents = sqliteTable(
  "job_intents",
  {
    jobKind: text("job_kind").notNull(),
    jobId: text("job_id").notNull(),
    intent: text("intent").$type<"run" | "pause" | "cancel">().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("job_intents_pk").on(t.jobKind, t.jobId)]
);

/** Durable event log; seq is the cursor the UI resumes from. */
export const jobEvents = sqliteTable("job_events", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  jobKind: text("job_kind").notNull(),
  jobId: text("job_id").notNull(),
  type: text("type").notNull(),
  payload: text("payload"),
});

/** Managed GGUF models (phase 5): verified by content hash. */
export const models = sqliteTable(
  "models",
  {
    id: text("id").primaryKey(),
    capability: text("capability").$type<"chat" | "embeddings">().notNull(),
    fileName: text("file_name").notNull(),
    path: text("path").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    origin: text("origin"),
    status: text("status").$type<"available" | "importing" | "failed">().notNull().default("available"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("models_by_sha256").on(t.sha256),
    index("models_by_capability").on(t.capability, t.status),
  ]
);

/** Local retrieval debug trail (config + retrieved ids, never full texts). */
export const retrievalRuns = sqliteTable(
  "retrieval_runs",
  {
    id: text("id").primaryKey(),
    notebookId: text("notebook_id").notNull(),
    profileId: text("profile_id"),
    config: text("config", { mode: "json" }).notNull(),
    resultChunkIds: text("result_chunk_ids", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("retrieval_runs_by_notebook").on(t.notebookId, t.createdAt)]
);

/** Provider run telemetry (multi-provider S3): one honest row per model call
 *  written at the capability seam. Tokens only when usage was returned
 *  (unknown is null, never 0); no prompt text is ever stored. */
export const providerRuns = sqliteTable(
  "provider_runs",
  {
    id: text("id").primaryKey(),
    capability: text("capability").$type<"chat" | "embed" | "transcribe" | "tts">().notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    ok: integer("ok").notNull(),
    errorCode: text("error_code"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_provider_runs_created").on(t.createdAt)]
);
