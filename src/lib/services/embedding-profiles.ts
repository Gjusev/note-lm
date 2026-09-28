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

/** Idempotent by the FULL recipe: re-registering returns the existing row.
 *  A changed dimension/pooling/prefix is a different profile — never reuse
 *  incompatible vectors (finding 3). */
export async function registerEmbeddingProfile(db: LocalDb, input: EmbeddingProfileInput) {
  if (!Number.isInteger(input.dimension) || input.dimension < 1 || input.dimension > 4096) {
    throw new Error(`invalid embedding dimension: ${input.dimension}`);
  }
  if (!input.provider || !input.model || !input.revision || !input.pooling) {
    throw new Error("provider, model, revision, dimension and pooling are required");
  }
  const existing = await db
    .select()
    .from(embeddingProfiles)
    .where(
      and(
        eq(embeddingProfiles.provider, input.provider),
        eq(embeddingProfiles.model, input.model),
        eq(embeddingProfiles.revision, input.revision),
        eq(embeddingProfiles.dimension, input.dimension),
        eq(embeddingProfiles.pooling, input.pooling),
        eq(embeddingProfiles.queryPrefix, input.queryPrefix ?? ""),
        eq(embeddingProfiles.docPrefix, input.docPrefix ?? "")
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
