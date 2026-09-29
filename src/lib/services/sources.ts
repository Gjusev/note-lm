import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
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

/** Replace all chunks of a source idempotently (upload/search/fetch paths). */
export function replaceChunks(
  db: LocalDb,
  args: { ownerId: string; sourceId: string; notebookId: string },
  chunkTexts: string[]
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

export type { MessageCitation };
