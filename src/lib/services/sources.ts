import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { chunks, sources, type MessageCitation, type SourceStatus } from "@/db/local/schema";
import { purgeOrphanVectors } from "./vector-index";
import type { LocalStore } from "@/lib/storage/local";
import { toWire } from "./wire";

export function listSourcesByNotebook(db: LocalDb, notebookId: string) {
  const rows = db.select().from(sources).where(eq(sources.notebookId, notebookId)).all();
  return rows.map(toWire);
}

export function getSource(db: LocalDb, sourceId: string) {
  const row = db.select().from(sources).where(eq(sources.id, sourceId)).limit(1).get();
  return row ? toWire(row) : null;
}

export interface CreateSourceInput {
  ownerId: string;
  notebookId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  storageId?: string;
  url?: string;
  provider?: string;
  canonicalUrl?: string;
  externalId?: string;
}

export async function createSource(db: LocalDb, args: CreateSourceInput): Promise<string> {
  const now = Date.now();
  const id = randomUUID();
  await db.insert(sources).values({
    id,
    ...args,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updateSourceStatus(
  db: LocalDb,
  sourceId: string,
  patch: {
    status: SourceStatus;
    errorMessage?: string;
    transcriptStorageId?: string;
  }
): Promise<void> {
  await db
    .update(sources)
    .set({
      status: patch.status,
      ...(patch.errorMessage !== undefined && { errorMessage: patch.errorMessage }),
      ...(patch.transcriptStorageId !== undefined && { transcriptStorageId: patch.transcriptStorageId }),
      updatedAt: Date.now(),
    })
    .where(eq(sources.id, sourceId));
}

/** Point an existing source at re-imported bytes (sources.reimportVersion):
 *  the processing pipeline reads originals through storageId, so the row must
 *  reference the new file before the job runs. The previous bytes stay
 *  referenced by older source_versions rows — never deleted here. */
export async function updateSourceStorage(
  db: LocalDb,
  sourceId: string,
  patch: { storageId: string; fileSize?: number; fileName?: string }
): Promise<void> {
  await db
    .update(sources)
    .set({
      storageId: patch.storageId,
      ...(patch.fileSize !== undefined && { fileSize: patch.fileSize }),
      ...(patch.fileName !== undefined && { fileName: patch.fileName }),
      updatedAt: Date.now(),
    })
    .where(eq(sources.id, sourceId));
}

/**
 * Replace all chunks of a source idempotently (upload/search/fetch paths).
 * `sourceVersionId` (migration 0013) stamps every chunk with the version that
 * produced it, so citations resolve provenance from the chunk. Omit it only
 * for writers that have no version at hand (fetch-url / search routes write
 * chunks before any version is recorded — legacy null, resolved to latest at
 * retrieval time).
 */
export function replaceChunks(
  db: LocalDb,
  args: { ownerId: string; sourceId: string; notebookId: string },
  chunkTexts: string[],
  sourceVersionId?: string
): number {
  const now = Date.now();
  const result = db.transaction((tx) => {
    tx.delete(chunks).where(eq(chunks.sourceId, args.sourceId)).run();
    // SQLite caps host parameters per statement (~32k) — batch big inserts
    const CHUNK_BATCH = 500;
    for (let i = 0; i < chunkTexts.length; i += CHUNK_BATCH) {
      const slice = chunkTexts.slice(i, i + CHUNK_BATCH);
      tx.insert(chunks)
        .values(
          slice.map((content, j) => ({
            id: randomUUID(),
            ownerId: args.ownerId,
            sourceId: args.sourceId,
            notebookId: args.notebookId,
            content,
            chunkIndex: i + j,
            embeddingId: `emb_${args.sourceId}_${i + j}`,
            // chunk provenance (migration 0013): the version that produced
            // this chunk; null only for writers without a version at hand
            sourceVersionId: sourceVersionId ?? null,
            createdAt: now,
          }))
        )
        .run();
    }
    return chunkTexts.length;
  }, { behavior: "immediate" });
  // vec0 rows have no FK — purge ghosts AFTER the commit so stale vectors
  // never consume KNN slots (finding 4)
  purgeOrphanVectors(db);
  return result;
}

/**
 * Tag chunks that were published before their version row existed (URL-import
 * path: completeImportJob commits chunks before recordVersion lands). Only
 * NULL rows are touched — a chunk that already carries its producing version
 * is never rewritten.
 */
export function backfillChunkVersion(db: LocalDb, sourceId: string, sourceVersionId: string): void {
  db.update(chunks)
    .set({ sourceVersionId })
    .where(and(eq(chunks.sourceId, sourceId), isNull(chunks.sourceVersionId)))
    .run();
}

export function getChunksBySource(db: LocalDb, sourceId: string) {
  const rows = db
    .select()
    .from(chunks)
    .where(eq(chunks.sourceId, sourceId))
    .orderBy(asc(chunks.chunkIndex))
    .all();
  return rows.map(toWire);
}

export function getChunksByNotebook(db: LocalDb, notebookId: string) {
  const rows = db.select().from(chunks).where(eq(chunks.notebookId, notebookId)).all();
  return rows.map(toWire);
}

export async function removeSource(db: LocalDb, store: LocalStore, sourceId: string): Promise<void> {
  const [row] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  await db.delete(sources).where(eq(sources.id, sourceId)); // cascades chunks
  purgeOrphanVectors(db); // vec0 rows have no FK — explicit cleanup
  if (row) {
    for (const fid of [row.storageId, row.transcriptStorageId]) {
      if (fid) await store.delete(fid);
    }
  }
}

/**
 * Open one source at a resolved version (sources.open): latest, or the given
 * versionId. Built for the desktop SourceReader, which must open ANY source
 * (not only anchored ones) and switch versions. absolutePath is reported only
 * when the stored original actually exists on disk - never a fabricated path.
 * sidecarKind reflects what the immutable version remembers: pages, sheet,
 * media (with per-segment times) or null (no sidecar, e.g. a version recorded
 * without bytes).
 */
export async function openSourceVersion(
  db: LocalDb,
  store: LocalStore,
  dataDir: string,
  args: { sourceId: string; versionId?: string }
): Promise<{
  fileName: string | null;
  contentType: string | null;
  version: number;
  pageCount: number | null;
  absolutePath: string | null;
  sidecarKind: "pages" | "sheet" | "media" | null;
} | null> {
  const { getLatestVersion, listVersions, readVersionMediaSegments, readVersionSheet, readVersionPages } =
    await import("./source-versions");
  const source = getSource(db, args.sourceId);
  if (!source) return null;
  const version = args.versionId
    ? listVersions(db, args.sourceId).find((v) => v.id === args.versionId) ?? null
    : getLatestVersion(db, args.sourceId);
  if (!version) return null;

  let absolutePath: string | null = null;
  if (version.storageId) {
    const stored = await store.get(version.storageId);
    const candidate = stored
      ? path.join(dataDir, stored.path)
      : path.join(dataDir, "files", version.storageId);
    absolutePath = fs.existsSync(candidate) ? candidate : null;
  }

  const media = await readVersionMediaSegments(store, version.id);
  let sidecarKind: "pages" | "sheet" | "media" | null = media ? "media" : null;
  if (!media && (await readVersionSheet(store, version.id))) sidecarKind = "sheet";
  if (!media && !sidecarKind && (await readVersionPages(store, version.id))) sidecarKind = "pages";

  return {
    fileName: source.fileName,
    contentType: source.fileType,
    version: version.version,
    pageCount: version.pageCount,
    absolutePath,
    sidecarKind,
  };
}

export type { MessageCitation };
