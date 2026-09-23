import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  notebooks: defineTable({
    ownerId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_updatedAt", ["ownerId", "updatedAt"]),

  sources: defineTable({
    ownerId: v.string(),
    notebookId: v.id("notebooks"),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    storageId: v.optional(v.id("_storage")),
    url: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("error")
    ),
    transcriptStorageId: v.optional(v.id("_storage")),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_notebookId", ["notebookId"])
    .index("by_ownerId", ["ownerId"])
    .index("by_notebookId_status", ["notebookId", "status"]),

  processingJobs: defineTable({
    ownerId: v.string(),
    sourceId: v.id("sources"),
    notebookId: v.id("notebooks"),
    type: v.union(
      v.literal("transcription"),
      v.literal("chunking"),
      v.literal("embedding")
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    progress: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sourceId", ["sourceId"])
    .index("by_notebookId", ["notebookId"])
    .index("by_status", ["status"]),

  chunks: defineTable({
    ownerId: v.string(),
    sourceId: v.id("sources"),
    notebookId: v.id("notebooks"),
    content: v.string(),
    chunkIndex: v.number(),
    embeddingId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_sourceId", ["sourceId"])
    .index("by_notebookId", ["notebookId"])
    .index("by_notebookId_chunkIndex", ["notebookId", "chunkIndex"]),

  messages: defineTable({
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
    createdAt: v.number(),
  })
    .index("by_notebookId", ["notebookId"])
    .index("by_notebookId_createdAt", ["notebookId", "createdAt"]),

  notes: defineTable({
    ownerId: v.string(),
    notebookId: v.id("notebooks"),
    title: v.string(),
    content: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_notebookId", ["notebookId"])
    .index("by_ownerId", ["ownerId"]),

  learningMaterials: defineTable({
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
    status: v.union(
      v.literal("pending"),
      v.literal("generating"),
      v.literal("completed"),
      v.literal("error")
    ),
    content: v.optional(v.string()),
    audioStorageId: v.optional(v.id("_storage")),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_notebookId", ["notebookId"])
    .index("by_notebookId_type", ["notebookId", "type"])
    .index("by_ownerId", ["ownerId"]),
});
