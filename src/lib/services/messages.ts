import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { messages, type MessageCitation } from "@/db/local/schema";
import { toWire } from "./wire";

export async function listMessagesByNotebook(db: LocalDb, notebookId: string) {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.notebookId, notebookId))
    .orderBy(asc(messages.createdAt));
  return rows.map(toWire);
}

export async function createMessage(
  db: LocalDb,
  args: {
    ownerId: string;
    notebookId: string;
    role: "user" | "assistant";
    content: string;
    citations?: MessageCitation[];
  }
): Promise<string> {
  const id = randomUUID();
  await db.insert(messages).values({
    id,
    ...args,
    citations: args.citations ?? null,
    createdAt: Date.now(),
  });
  return id;
}

export async function clearMessagesByNotebook(db: LocalDb, notebookId: string): Promise<void> {
  await db.delete(messages).where(eq(messages.notebookId, notebookId));
}
