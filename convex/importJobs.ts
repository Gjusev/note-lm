import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Persistent import jobs. Worker-side mutations require the worker credential
 * (WORKER_KEY, set via Convex env) — an internal header alone is not enough.
 * A lease token fences stale workers: every write re-checks token + status.
 */

const LEASE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_DEFAULT = 3;
const RUNNING_STATUSES = ["inspecting", "awaiting_selection", "downloading", "processing"] as const;

function checkWorkerKey(workerKey: string) {
  const expected = process.env.WORKER_KEY;
  if (!expected || workerKey !== expected) {
    throw new Error("Worker-Schlüssel ungültig");
  }
}

function leaseToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** May this worker still write to this job? */
function ownsJob(job: { leaseToken?: string; status: string }, token: string): boolean {
  return job.leaseToken === token && RUNNING_STATUSES.includes(job.status as (typeof RUNNING_STATUSES)[number]);
}

export const create = mutation({
  args: {
    ownerId: v.string(),
    notebookId: v.id("notebooks"),
    url: v.string(),
    provider: v.string(),
    kind: v.string(),
    resourceKey: v.string(),
    externalId: v.optional(v.string()),
    canonicalUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Dedup: one active job per notebook + resource
    const active = await ctx.db
      .query("importJobs")
      .withIndex("by_notebookId_resourceKey", (q) => q.eq("notebookId", args.notebookId).eq("resourceKey", args.resourceKey))
      .collect();
    const existing = active.find(
      (j) => !["completed", "failed", "cancelled"].includes(j.status)
    );
    if (existing) return { jobId: existing._id, deduped: true };

    const jobId = await ctx.db.insert("importJobs", {
      ...args,
      status: "queued",
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS_DEFAULT,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { jobId, deduped: false };
  },
});

export const listByNotebook = query({
  args: { notebookId: v.id("notebooks") },
  handler: async (ctx, { notebookId }) => {
    return await ctx.db
      .query("importJobs")
      .withIndex("by_notebookId_createdAt", (q) => q.eq("notebookId", notebookId))
      .order("desc")
      .take(30);
  },
});

export const get = query({
  args: { jobId: v.id("importJobs") },
  handler: async (ctx, { jobId }) => {
    return await ctx.db.get(jobId);
  },
});

export const cancel = mutation({
  args: { jobId: v.id("importJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job nicht gefunden");
    if (["completed", "failed", "cancelled"].includes(job.status)) {
      throw new Error("Job ist bereits abgeschlossen");
    }
    await ctx.db.patch(jobId, { status: "cancelled", leaseToken: undefined, updatedAt: Date.now() });
  },
});

export const retry = mutation({
  args: { jobId: v.id("importJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job nicht gefunden");
    if (!["failed", "cancelled"].includes(job.status)) {
      throw new Error("Nur fehlgeschlagene oder abgebrochene Jobs können wiederholt werden");
    }
    await ctx.db.patch(jobId, {
      status: "queued",
      attempts: 0,
      nextAttemptAt: Date.now(),
      errorCode: undefined,
      errorMessage: undefined,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Atomic claim with lease. Reclaims jobs whose lease expired (worker crash). */
export const claim = mutation({
  args: { workerKey: v.string() },
  handler: async (ctx, { workerKey }) => {
    checkWorkerKey(workerKey);
    const now = Date.now();

    // 1) queued jobs whose next attempt is due
    const queued = await ctx.db
      .query("importJobs")
      .withIndex("by_status_nextAttemptAt", (q) => q.eq("status", "queued").lt("nextAttemptAt", now))
      .order("asc")
      .first();

    let job = queued ?? null;

    // 2) running jobs whose lease expired (crashed worker)
    if (!job) {
      const stale = await ctx.db
        .query("importJobs")
        .withIndex("by_leaseExpiresAt", (q) => q.lt("leaseExpiresAt", now))
        .collect();
      job = stale.find((j) => RUNNING_STATUSES.includes(j.status as (typeof RUNNING_STATUSES)[number])) ?? null;
    }

    if (!job) return null;

    const token = leaseToken();
    await ctx.db.patch(job._id, {
      status: "inspecting",
      attempts: job.attempts + 1,
      leaseToken: token,
      leaseExpiresAt: now + LEASE_MS,
      updatedAt: now,
    });
    return { ...job, status: "inspecting", attempts: job.attempts + 1, leaseToken: token, leaseExpiresAt: now + LEASE_MS };
  },
});

export const heartbeat = mutation({
  args: { jobId: v.id("importJobs"), leaseToken: v.string(), workerKey: v.string() },
  handler: async (ctx, { jobId, leaseToken, workerKey }) => {
    checkWorkerKey(workerKey);
    const job = await ctx.db.get(jobId);
    if (!job || !ownsJob(job, leaseToken)) return false;
    await ctx.db.patch(jobId, { leaseExpiresAt: Date.now() + LEASE_MS, updatedAt: Date.now() });
    return true;
  },
});

export const updatePhase = mutation({
  args: {
    jobId: v.id("importJobs"),
    leaseToken: v.string(),
    workerKey: v.string(),
    phase: v.union(
      v.literal("inspecting"),
      v.literal("awaiting_selection"),
      v.literal("downloading"),
      v.literal("processing")
    ),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, leaseToken, workerKey, phase, title }) => {
    checkWorkerKey(workerKey);
    const job = await ctx.db.get(jobId);
    if (!job || !ownsJob(job, leaseToken)) return false;
    await ctx.db.patch(jobId, {
      status: phase,
      ...(title !== undefined && { title }),
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const fail = mutation({
  args: {
    jobId: v.id("importJobs"),
    leaseToken: v.string(),
    workerKey: v.string(),
    errorCode: v.string(),
    errorMessage: v.string(),
    transient: v.boolean(),
    retryAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, { jobId, leaseToken, workerKey, errorCode, errorMessage, transient, retryAfterMs }) => {
    checkWorkerKey(workerKey);
    const job = await ctx.db.get(jobId);
    if (!job || job.leaseToken !== leaseToken) return false;

    const now = Date.now();
    if (transient && job.attempts < job.maxAttempts) {
      const backoff = retryAfterMs ?? Math.min(15_000 * 2 ** (job.attempts - 1), 10 * 60_000);
      await ctx.db.patch(jobId, {
        status: "queued",
        nextAttemptAt: now + backoff,
        errorCode,
        errorMessage,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      return true;
    }
    await ctx.db.patch(jobId, {
      status: "failed",
      errorCode,
      errorMessage,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    return true;
  },
});

/**
 * Atomic completion: create-or-reuse the source, replace its chunks
 * idempotently, mark job done. Retries never duplicate sources or chunks.
 */
export const complete = mutation({
  args: {
    jobId: v.id("importJobs"),
    leaseToken: v.string(),
    workerKey: v.string(),
    source: v.object({
      fileName: v.string(),
      fileType: v.string(),
      fileSize: v.number(),
      url: v.string(),
      provider: v.string(),
      canonicalUrl: v.optional(v.string()),
      externalId: v.optional(v.string()),
      title: v.optional(v.string()),
      author: v.optional(v.string()),
      language: v.optional(v.string()),
    }),
    chunks: v.array(v.object({ content: v.string(), chunkIndex: v.number() })),
  },
  handler: async (ctx, { jobId, leaseToken, workerKey, source, chunks }) => {
    checkWorkerKey(workerKey);
    const job = await ctx.db.get(jobId);
    if (!job || !ownsJob(job, leaseToken)) return { ok: false };

    const now = Date.now();

    let sourceId = job.sourceId;
    if (!sourceId && source.externalId) {
      const existing = await ctx.db
        .query("sources")
        .withIndex("by_notebookId_provider_externalId", (q) =>
          q.eq("notebookId", job.notebookId).eq("provider", source.provider).eq("externalId", source.externalId)
        )
        .unique();
      if (existing) sourceId = existing._id;
    }

    if (sourceId) {
      const old = await ctx.db
        .query("chunks")
        .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId!))
        .collect();
      for (const c of old) await ctx.db.delete(c._id);
      await ctx.db.patch(sourceId, {
        fileName: source.fileName,
        fileType: source.fileType,
        fileSize: source.fileSize,
        url: source.url,
        status: "completed",
        errorMessage: undefined,
        ...(source.canonicalUrl !== undefined && { canonicalUrl: source.canonicalUrl }),
        ...(source.externalId !== undefined && { externalId: source.externalId }),
        ...(source.author !== undefined && { author: source.author }),
        ...(source.language !== undefined && { language: source.language }),
        importedAt: now,
        updatedAt: now,
      });
    } else {
      sourceId = await ctx.db.insert("sources", {
        ownerId: job.ownerId,
        notebookId: job.notebookId,
        fileName: source.fileName,
        fileType: source.fileType,
        fileSize: source.fileSize,
        url: source.url,
        status: "completed",
        provider: source.provider,
        ...(source.canonicalUrl !== undefined && { canonicalUrl: source.canonicalUrl }),
        ...(source.externalId !== undefined && { externalId: source.externalId }),
        ...(source.author !== undefined && { author: source.author }),
        ...(source.language !== undefined && { language: source.language }),
        importedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const chunk of chunks) {
      await ctx.db.insert("chunks", {
        ownerId: job.ownerId,
        sourceId,
        notebookId: job.notebookId,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        embeddingId: `emb_${sourceId}_${chunk.chunkIndex}`,
        createdAt: now,
      });
    }

    await ctx.db.patch(jobId, {
      status: "completed",
      sourceId,
      ...(source.title !== undefined && { title: source.title }),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    return { ok: true, sourceId };
  },
});
