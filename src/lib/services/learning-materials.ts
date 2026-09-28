import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { learningMaterials, type MaterialStatus, type MaterialType } from "@/db/local/schema";
import type { LocalStore } from "@/lib/storage/local";
import { toWire } from "./wire";

/** Wire shape keeps the Convex field name audioStorageId (= audioFileId). */
function toMaterial(row: typeof learningMaterials.$inferSelect) {
  const { audioFileId, ...rest } = row;
  return { ...toWire({ ...rest, id: row.id }), audioStorageId: audioFileId ?? undefined };
}

export async function listMaterialsByNotebook(db: LocalDb, notebookId: string) {
  const rows = await db
    .select()
    .from(learningMaterials)
    .where(eq(learningMaterials.notebookId, notebookId));
  return rows.map(toMaterial);
}

export async function getMaterial(db: LocalDb, materialId: string) {
  const [row] = await db
    .select()
    .from(learningMaterials)
    .where(eq(learningMaterials.id, materialId))
    .limit(1);
  return row ? toMaterial(row) : null;
}

export async function requestGeneration(
  db: LocalDb,
  args: { ownerId: string; notebookId: string; type: MaterialType }
): Promise<string> {
  const now = Date.now();
  const id = randomUUID();
  await db.insert(learningMaterials).values({
    id,
    ...args,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updateMaterial(
  db: LocalDb,
  materialId: string,
  patch: {
    status: MaterialStatus;
    content?: string;
    errorMessage?: string;
    audioFileId?: string;
  }
): Promise<void> {
  await db
    .update(learningMaterials)
    .set({
      status: patch.status,
      ...(patch.content !== undefined && { content: patch.content }),
      ...(patch.errorMessage !== undefined && { errorMessage: patch.errorMessage }),
      ...(patch.audioFileId !== undefined && { audioFileId: patch.audioFileId }),
      updatedAt: Date.now(),
    })
    .where(eq(learningMaterials.id, materialId));
}

/** Delete a material and its generated audio file (Convex never did the latter). */
export async function removeMaterial(db: LocalDb, store: LocalStore, materialId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(learningMaterials)
    .where(eq(learningMaterials.id, materialId))
    .limit(1);
  await db.delete(learningMaterials).where(eq(learningMaterials.id, materialId));
  if (row?.audioFileId) await store.delete(row.audioFileId);
}
