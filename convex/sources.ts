import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listByNotebook = query({
  args: { notebookId: v.id("notebooks") },
  handler: async (ctx, { notebookId }) => {
    return await ctx.db
      .query("sources")
      .withIndex("by_notebookId", (q) => q.eq("notebookId", notebookId))
      .collect();
  },
});

export const create = mutation({
  args: {
    ownerId: v.string(),
    notebookId: v.id("notebooks"),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    storageId: v.optional(v.id("_storage")),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("sources", {
      ...args,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStatus = mutation({
  args: {
    sourceId: v.id("sources"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("error")
    ),
    errorMessage: v.optional(v.string()),
    transcriptStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { sourceId, status, errorMessage, transcriptStorageId }) => {
    await ctx.db.patch(sourceId, {
      status,
      ...(errorMessage !== undefined && { errorMessage }),
      ...(transcriptStorageId !== undefined && { transcriptStorageId }),
      updatedAt: Date.now(),
    });
  },
});

export const get = query({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    return await ctx.db.get(sourceId);
  },
});

export const remove = mutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
      .collect();
    for (const chunk of chunks) await ctx.db.delete(chunk._id);
    await ctx.db.delete(sourceId);
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const getDownloadUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId);
  },
});
