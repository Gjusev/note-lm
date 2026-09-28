import { eq } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { settings } from "@/db/local/schema";

/** Key/value app settings (JSON values). Simple get/set over the table. */
export async function getSetting<T>(db: LocalDb, key: string): Promise<T | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row ? (row.value as T) : null;
}

export async function setSetting(db: LocalDb, key: string, value: unknown): Promise<void> {
  const now = Date.now();
  const [row] = await db.select({ key: settings.key }).from(settings).where(eq(settings.key, key)).limit(1);
  if (row) {
    await db.update(settings).set({ value, updatedAt: now }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value, updatedAt: now });
  }
}
