import { eq } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { profile } from "@/db/local/schema";

export interface LocalProfile {
  id: string;
  name: string;
  email: string;
}

/** Single local profile, created on first use. Replaces Better Auth accounts —
 *  the owner of every notebook; no registration, no password. */
export async function getOrCreateProfile(db: LocalDb): Promise<LocalProfile> {
  const [existing] = await db.select().from(profile).where(eq(profile.id, "local")).limit(1);
  if (existing) return existing;
  const row = {
    id: "local",
    name: process.env.NOTELM_USER_NAME || "Lokales Profil",
    email: "local@note-lm.local",
    createdAt: Date.now(),
  };
  await db.insert(profile).values(row).onConflictDoNothing();
  // Another process may have won the race — read back whatever is stored.
  const [row2] = await db.select().from(profile).where(eq(profile.id, "local")).limit(1);
  return row2 ?? row;
}
