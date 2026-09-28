import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export interface MessageCitation {
  sourceId: string;
  chunkIndex: number;
  text: string;
  fileName?: string;
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

/** One extraction version of a source; re-imports create a new version. */
export const sourceVersions = sqliteTable(
  "source_versions",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    contentHash: text("content_hash").notNull(),
    extractor: text("extractor"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("source_versions_unique").on(t.sourceId, t.version),
    index("source_versions_by_source").on(t.sourceId),
  ]
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
