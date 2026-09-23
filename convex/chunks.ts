import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getByNotebook = query({
  args: { notebookId: v.id("notebooks") },
  handler: async (ctx, { notebookId }) => {
    return await ctx.db
      .query("chunks")
      .withIndex("by_notebookId", (q) => q.eq("notebookId", notebookId))
      .collect();
  },
});

export const getBySource = query({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    return await ctx.db
      .query("chunks")
      .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
      .order("asc")
      .collect();
  },
});

export const create = mutation({
  args: {
    ownerId: v.string(),
    sourceId: v.id("sources"),
    notebookId: v.id("notebooks"),
    content: v.string(),
    chunkIndex: v.number(),
    embeddingId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("chunks", { ...args, createdAt: Date.now() });
  },
});

export const searchSimilar = query({
  args: {
    notebookId: v.id("notebooks"),
  },
  handler: async (ctx, { notebookId }) => {
    return await ctx.db
      .query("chunks")
      .withIndex("by_notebookId", (q) => q.eq("notebookId", notebookId))
      .collect();
  },
});
