import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listByNotebook = query({
  args: { notebookId: v.id("notebooks") },
  handler: async (ctx, { notebookId }) => {
    return await ctx.db
      .query("notes")
      .withIndex("by_notebookId", (q) => q.eq("notebookId", notebookId))
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: {
    ownerId: v.string(),
    notebookId: v.id("notebooks"),
    title: v.string(),
    content: v.string(),
  },
  handler: async (ctx, { ownerId, notebookId, title, content }) => {
    const now = Date.now();
    return await ctx.db.insert("notes", {
      ownerId,
      notebookId,
      title,
      content,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    noteId: v.id("notes"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
  },
  handler: async (ctx, { noteId, title, content }) => {
    await ctx.db.patch(noteId, {
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, { noteId }) => {
    await ctx.db.delete(noteId);
  },
});
