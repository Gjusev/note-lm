import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listByNotebook = query({
  args: { notebookId: v.id("notebooks") },
  handler: async (ctx, { notebookId }) => {
    return await ctx.db
      .query("learningMaterials")
      .withIndex("by_notebookId", (q) => q.eq("notebookId", notebookId))
      .collect();
  },
});

export const get = query({
  args: { materialId: v.id("learningMaterials") },
  handler: async (ctx, { materialId }) => {
    return await ctx.db.get(materialId);
  },
});

export const requestGeneration = mutation({
  args: {
    ownerId: v.string(),
    notebookId: v.id("notebooks"),
    type: v.union(
      v.literal("summary"),
      v.literal("flashcards"),
      v.literal("quiz"),
      v.literal("studyGuide"),
      v.literal("keyInsights"),
      v.literal("podcastSummary"),
      v.literal("slides")
    ),
  },
  handler: async (ctx, { ownerId, notebookId, type }) => {
    const now = Date.now();
    return await ctx.db.insert("learningMaterials", {
      ownerId,
      notebookId,
      type,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateContent = mutation({
  args: {
    materialId: v.id("learningMaterials"),
    status: v.union(
      v.literal("pending"),
      v.literal("generating"),
      v.literal("completed"),
      v.literal("error")
    ),
    content: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    audioStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { materialId, status, content, errorMessage, audioStorageId }) => {
    await ctx.db.patch(materialId, {
      status,
      ...(content !== undefined && { content }),
      ...(errorMessage !== undefined && { errorMessage }),
      ...(audioStorageId !== undefined && { audioStorageId }),
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { materialId: v.id("learningMaterials") },
  handler: async (ctx, { materialId }) => {
    await ctx.db.delete(materialId);
  },
});
