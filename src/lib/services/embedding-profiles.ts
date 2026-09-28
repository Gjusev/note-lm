import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { embeddingProfiles } from "@/db/local/schema";
import { toWire } from "./wire";

/**
 * Embedding profiles (issue #3): the exact recipe that produced a set of
 * vectors. Vectors from different profiles never mix — the natural key
 * (provider, model, revision) identifies a profile; changing any part of
 * the recipe means registering a NEW profile and reindexing into it.
 */

export interface EmbeddingProfileInput {
  provider: string;
  model: string;
  revision: string;
  dimension: number;
  pooling: string;
  queryPrefix?: string;
  docPrefix?: string;
}

/** Idempotent by natural key: re-registering returns the existing row. */
export async function registerEmbeddingProfile(db: LocalDb, input: EmbeddingProfileInput) {
  const existing = await db
    .select()
    .from(embeddingProfiles)
    .where(
      and(
        eq(embeddingProfiles.provider, input.provider),
        eq(embeddingProfiles.model, input.model),
        eq(embeddingProfiles.revision, input.revision)
      )
    )
    .limit(1);
  if (existing[0]) return toWire(existing[0]);

  const row = {
    id: randomUUID(),
    provider: input.provider,
    model: input.model,
    revision: input.revision,
    dimension: input.dimension,
    pooling: input.pooling,
    queryPrefix: input.queryPrefix ?? "",
    docPrefix: input.docPrefix ?? "",
    createdAt: Date.now(),
  };
  await db.insert(embeddingProfiles).values(row);
  return toWire(row);
}

export async function getEmbeddingProfile(db: LocalDb, profileId: string) {
  const [row] = await db
    .select()
    .from(embeddingProfiles)
    .where(eq(embeddingProfiles.id, profileId))
    .limit(1);
  return row ? toWire(row) : null;
}
