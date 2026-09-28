import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { notes } from "@/db/local/schema";
import { toWire } from "./wire";

export async function listNotesByNotebook(db: LocalDb, notebookId: string) {
  const rows = await db
    .select()
    .from(notes)
    .where(eq(notes.notebookId, notebookId))
    .orderBy(desc(notes.createdAt));
  return rows.map(toWire);
}

export async function createNote(
  db: LocalDb,
  args: { ownerId: string; notebookId: string; title: string; content: string }
): Promise<string> {
  const now = Date.now();
  const id = randomUUID();
  await db.insert(notes).values({ id, ...args, createdAt: now, updatedAt: now });
  return id;
}

export async function updateNote(
  db: LocalDb,
  noteId: string,
  patch: { title?: string; content?: string }
): Promise<void> {
  await db
    .update(notes)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(notes.id, noteId));
}

export async function removeNote(db: LocalDb, noteId: string): Promise<void> {
  await db.delete(notes).where(eq(notes.id, noteId));
}
