/**
 * Provider run telemetry (multi-provider plan, slice S3): one honest row per
 * model call at the capability seam - (capability, provider, model, latency,
 * tokens, error code). Written fire-and-forget by the capability factories;
 * a failing telemetry write must never break the call it observes. Tokens are
 * stored ONLY when the provider returned usage - unknown consumption is null,
 * never zero - and no prompt text is ever persisted. No egress: rows live in
 * the local SQLite only.
 */
import { lt } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { providerRuns } from "@/db/local/schema";
import type { ProviderCapability } from "@/lib/ai/providers";

/** One model call's honest telemetry. Tokens optional: null = unknown. */
export interface ProviderRunInput {
  capability: ProviderCapability;
  provider: string;
  model?: string | null;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  ok: boolean;
  errorCode?: string | null;
}

/** Insert one run row. Synchronous: the caller decides fire-and-forget. */
export function recordProviderRun(db: LocalDb, run: ProviderRunInput): void {
  db.insert(providerRuns)
    .values({
      id: crypto.randomUUID(),
      capability: run.capability,
      provider: run.provider,
      model: run.model ?? null,
      latencyMs: run.latencyMs,
      promptTokens: run.promptTokens ?? null,
      completionTokens: run.completionTokens ?? null,
      ok: run.ok ? 1 : 0,
      errorCode: run.errorCode ?? null,
      createdAt: Date.now(),
    })
    .run();
}

/** Delete rows older than keepDays (default 30). Called at engine boot. */
export function pruneProviderRuns(db: LocalDb, keepDays = 30): void {
  db.delete(providerRuns)
    .where(lt(providerRuns.createdAt, Date.now() - keepDays * 86_400_000))
    .run();
}
