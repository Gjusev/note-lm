import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    ownerId: v.string(),
    sourceId: v.id("sources"),
    notebookId: v.id("notebooks"),
    type: v.union(
      v.literal("transcription"),
      v.literal("chunking"),
      v.literal("embedding")
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("processingJobs", {
      ...args,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStatus = mutation({
  args: {
    jobId: v.id("processingJobs"),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    progress: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, status, progress, errorMessage }) => {
    await ctx.db.patch(jobId, {
      status,
      ...(progress !== undefined && { progress }),
      ...(errorMessage !== undefined && { errorMessage }),
      updatedAt: Date.now(),
    });
  },
});
