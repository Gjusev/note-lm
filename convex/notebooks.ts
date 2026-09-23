import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => {
    return await ctx.db
      .query("notebooks")
      .withIndex("by_ownerId_updatedAt", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { notebookId: v.id("notebooks") },
  handler: async (ctx, { notebookId }) => {
    return await ctx.db.get(notebookId);
  },
});

export const create = mutation({
  args: {
    ownerId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { ownerId, title, description }) => {
    const now = Date.now();
    return await ctx.db.insert("notebooks", {
      ownerId,
      title,
      description,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    notebookId: v.id("notebooks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { notebookId, title, description }) => {
    const existing = await ctx.db.get(notebookId);
    if (!existing) throw new Error("Notebook not found");
    await ctx.db.patch(notebookId, {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { notebookId: v.id("notebooks") },
  handler: async (ctx, { notebookId }) => {
    const sources = await ctx.db
      .query("sources")
      .withIndex("by_notebookId", (q) => q.eq("notebookId", notebookId))
      .collect();
    for (const source of sources) {
      const chunks = await ctx.db
        .query("chunks")
        .withIndex("by_sourceId", (q) => q.eq("sourceId", source._id))
        .collect();
      for (const chunk of chunks) await ctx.db.delete(chunk._id);
      await ctx.db.delete(source._id);
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_notebookId", (q) => q.eq("notebookId", notebookId))
      .collect();
    for (const msg of messages) await ctx.db.delete(msg._id);

    const notes = await ctx.db
      .query("notes")
      .withIndex("by_notebookId", (q) => q.eq("notebookId", notebookId))
      .collect();
    for (const note of notes) await ctx.db.delete(note._id);

    const materials = await ctx.db
      .query("learningMaterials")
      .withIndex("by_notebookId", (q) => q.eq("notebookId", notebookId))
      .collect();
    for (const mat of materials) await ctx.db.delete(mat._id);

    await ctx.db.delete(notebookId);
  },
});
