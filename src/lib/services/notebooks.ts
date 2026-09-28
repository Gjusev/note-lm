import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { learningMaterials, notebooks, sources } from "@/db/local/schema";
import type { LocalStore } from "@/lib/storage/local";
import { toWire } from "./wire";

export async function listNotebooks(db: LocalDb, ownerId: string) {
  const rows = await db
    .select()
    .from(notebooks)
    .where(eq(notebooks.ownerId, ownerId))
    .orderBy(desc(notebooks.updatedAt));
  return rows.map(toWire);
}

export async function getNotebook(db: LocalDb, notebookId: string) {
  const [row] = await db.select().from(notebooks).where(eq(notebooks.id, notebookId)).limit(1);
  return row ? toWire(row) : null;
}

export async function createNotebook(
  db: LocalDb,
  args: { ownerId: string; title: string; description?: string }
): Promise<string> {
  const now = Date.now();
  const id = randomUUID();
  await db.insert(notebooks).values({ id, ...args, createdAt: now, updatedAt: now });
  return id;
}

export async function updateNotebook(
  db: LocalDb,
  notebookId: string,
  patch: { title?: string; description?: string }
): Promise<void> {
  const [existing] = await db.select().from(notebooks).where(eq(notebooks.id, notebookId)).limit(1);
  if (!existing) throw new Error("Notebook not found");
  await db
    .update(notebooks)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(notebooks.id, notebookId));
}

/** Delete a notebook with everything it owns. Row fan-out is handled by FK
 *  cascades; file bytes (originals, transcripts, material audio) are collected
 *  first and removed from disk afterwards. Fixes two Convex-era gaps:
 *  processingJobs are cascaded by the DB now, and material audio is deleted. */
export async function removeNotebook(db: LocalDb, store: LocalStore, notebookId: string): Promise<void> {
  const srcRows = await db
    .select({ storageId: sources.storageId, transcriptStorageId: sources.transcriptStorageId })
    .from(sources)
    .where(eq(sources.notebookId, notebookId));
  const matRows = await db
    .select({ audioFileId: learningMaterials.audioFileId })
    .from(learningMaterials)
    .where(eq(learningMaterials.notebookId, notebookId));

  await db.delete(notebooks).where(eq(notebooks.id, notebookId));

  const fileIds = [
    ...srcRows.flatMap((s) => [s.storageId, s.transcriptStorageId]),
    ...matRows.map((m) => m.audioFileId),
  ].filter((id): id is string => !!id);
  await Promise.all(fileIds.map((id) => store.delete(id)));
}

export async function userOwnsNotebook(db: LocalDb, ownerId: string, notebookId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notebooks.id })
    .from(notebooks)
    .where(and(eq(notebooks.id, notebookId), eq(notebooks.ownerId, ownerId)))
    .limit(1);
  return !!row;
}
