import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listByNotebook = query({
  args: { notebookId: v.id("notebooks") },
  handler: async (ctx, { notebookId }) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_notebookId_createdAt", (q) => q.eq("notebookId", notebookId))
      .order("asc")
      .collect();
  },
});

export const create = mutation({
  args: {
    ownerId: v.string(),
    notebookId: v.id("notebooks"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    citations: v.optional(
      v.array(
        v.object({
          sourceId: v.id("sources"),
          chunkIndex: v.number(),
          text: v.string(),
        })
      )
    ),
  },
  handler: async (ctx, { ownerId, notebookId, role, content, citations }) => {
    return await ctx.db.insert("messages", {
      ownerId,
      notebookId,
      role,
      content,
      citations,
      createdAt: Date.now(),
    });
  },
});

export const clearByNotebook = mutation({
  args: { notebookId: v.id("notebooks") },
  handler: async (ctx, { notebookId }) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_notebookId_createdAt", (q) => q.eq("notebookId", notebookId))
      .collect();
    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }
  },
});
