/**
 * Engine operation dispatch (issue #10): the seam where engine ops meet the
 * local services, with no HTTP or Next transport involved.
 */
import fs from "node:fs";
import path from "node:path";
import { getLocalContext } from "@/lib/storage/local";
import { getOrCreateProfile } from "@/lib/services/profile";
import { createNotebook, listNotebooks } from "@/lib/services/notebooks";
import { createSource } from "@/lib/services/sources";
import { enqueueProcessingJob } from "@/lib/services/processing-jobs";
import { createNote, listNotesByNotebook, removeNote, updateNote } from "@/lib/services/notes";
import {
  getChunksBySource,
  getSource,
  listSourcesByNotebook,
  removeSource,
} from "@/lib/services/sources";
import { clearMessagesByNotebook, createMessage, listMessagesByNotebook } from "@/lib/services/messages";
import {
  listMaterialsByNotebook,
  removeMaterial,
  requestGeneration,
} from "@/lib/services/learning-materials";
import {
  cancelImportJob,
  createImportJob,
  listImportJobsByNotebook,
  retryImportJob,
} from "@/lib/services/import-jobs";
import { classifyUrl } from "@/lib/ingestion/identify";
import type { MaterialType } from "@/db/local/schema";
import { getSetting, setSetting } from "@/lib/services/settings";
import {
  getEmbeddingProfile,
  registerEmbeddingProfile,
} from "@/lib/services/embedding-profiles";
import { sendChatMessage } from "@/lib/services/chat";
import { resolveCapabilities } from "./capabilities";

const ACTIVE_PROFILE_KEY = "retrieval.activeProfile";

async function preEmbedQuery(
  message: string,
  embed: ((texts: string[]) => Promise<Buffer[]>) | null
): Promise<((q: string) => Buffer) | null> {
  if (!embed) return null;
  const [vector] = await embed([message]);
  let value = vector;
  return () => value;
}

export type EngineResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };

export const PROTOCOL_VERSION = 1;

export async function handleEngineRequest(op: string, args: unknown): Promise<EngineResult> {
  try {
    switch (op) {
      case "protocol.version":
        return { ok: true, result: { version: PROTOCOL_VERSION } };

      case "notebooks.create": {
        const { title } = args as { title?: string };
        if (!title || typeof title !== "string") {
          return { ok: false, error: { code: "bad_args", message: "title is required" } };
        }
        const { db } = getLocalContext();
        const profile = await getOrCreateProfile(db);
        const id = await createNotebook(db, { ownerId: profile.id, title });
        return { ok: true, result: { id } };
      }

      case "notebooks.list": {
        const { db } = getLocalContext();
        const profile = await getOrCreateProfile(db);
        return { ok: true, result: await listNotebooks(db, profile.id) };
      }

      case "notes.create": {
        const { notebookId, title, content } = args as {
          notebookId?: string; title?: string; content?: string;
        };
        if (!notebookId || !title) {
          return { ok: false, error: { code: "bad_args", message: "notebookId and title are required" } };
        }
        const { db } = getLocalContext();
        const profile = await getOrCreateProfile(db);
        const id = await createNote(db, {
          ownerId: profile.id, notebookId, title, content: content ?? "",
        });
        return { ok: true, result: { id } };
      }

      case "notes.list": {
        const { notebookId } = args as { notebookId?: string };
        if (!notebookId) {
          return { ok: false, error: { code: "bad_args", message: "notebookId is required" } };
        }
        const { db } = getLocalContext();
        return { ok: true, result: await listNotesByNotebook(db, notebookId) };
      }

      case "notes.update": {
        const { noteId, title, content } = args as {
          noteId?: string; title?: string; content?: string;
        };
        if (!noteId) {
          return { ok: false, error: { code: "bad_args", message: "noteId is required" } };
        }
        const { db } = getLocalContext();
        await updateNote(db, noteId, {
          ...(title !== undefined && { title }),
          ...(content !== undefined && { content }),
        });
        return { ok: true, result: {} };
      }

      case "notes.delete": {
        const { noteId } = args as { noteId?: string };
        if (!noteId) {
          return { ok: false, error: { code: "bad_args", message: "noteId is required" } };
        }
        const { db } = getLocalContext();
        await removeNote(db, noteId);
        return { ok: true, result: {} };
      }

      case "sources.list": {
        const { notebookId } = args as { notebookId?: string };
        if (!notebookId) {
          return { ok: false, error: { code: "bad_args", message: "notebookId is required" } };
        }
        const { db } = getLocalContext();
        return { ok: true, result: listSourcesByNotebook(db, notebookId) };
      }

      case "sources.get": {
        const { sourceId } = args as { sourceId?: string };
        if (!sourceId) {
          return { ok: false, error: { code: "bad_args", message: "sourceId is required" } };
        }
        const { db } = getLocalContext();
        const source = getSource(db, sourceId);
        if (!source) return { ok: false, error: { code: "not_found", message: "source not found" } };
        return { ok: true, result: source };
      }

      case "sources.chunks": {
        const { sourceId } = args as { sourceId?: string };
        if (!sourceId) {
          return { ok: false, error: { code: "bad_args", message: "sourceId is required" } };
        }
        const { db } = getLocalContext();
        return { ok: true, result: getChunksBySource(db, sourceId) };
      }

      case "sources.delete": {
        const { sourceId } = args as { sourceId?: string };
        if (!sourceId) {
          return { ok: false, error: { code: "bad_args", message: "sourceId is required" } };
        }
        const { db, store } = getLocalContext();
        await removeSource(db, store, sourceId);
        return { ok: true, result: {} };
      }

      case "sources.importFile": {
        // Desktop flow: Rust grants a file path (native dialog / drag&drop);
        // the engine copies it into the managed store and queues processing.
        const { path: filePath, notebookId, fileName, fileType } = args as {
          path?: string; notebookId?: string; fileName?: string; fileType?: string;
        };
        if (!filePath || !notebookId || !fileName) {
          return { ok: false, error: { code: "bad_args", message: "path, notebookId and fileName are required" } };
        }
        if (path.isAbsolute(filePath) !== true) {
          return { ok: false, error: { code: "bad_args", message: "path must be absolute" } };
        }
        let buffer: Buffer;
        try {
          buffer = await fs.promises.readFile(filePath);
        } catch {
          return { ok: false, error: { code: "bad_args", message: `file not readable: ${filePath}` } };
        }
        const { db, store } = getLocalContext();
        const profile = await getOrCreateProfile(db);
        const stored = await store.save(buffer, { fileName, contentType: fileType ?? "application/octet-stream" });
        try {
          const sourceId = await createSource(db, {
            ownerId: profile.id,
            notebookId,
            fileName,
            fileType: fileType ?? "application/octet-stream",
            fileSize: buffer.length,
            storageId: stored.id,
          });
          await enqueueProcessingJob(db, { ownerId: profile.id, sourceId, notebookId });
          return { ok: true, result: { sourceId } };
        } catch (err) {
          await store.delete(stored.id);
          throw err;
        }
      }

      case "messages.create": {
        const { notebookId, role, content } = args as {
          notebookId?: string; role?: "user" | "assistant"; content?: string;
        };
        if (!notebookId || !content || (role !== "user" && role !== "assistant")) {
          return { ok: false, error: { code: "bad_args", message: "notebookId, role and content are required" } };
        }
        const { db } = getLocalContext();
        const profile = await getOrCreateProfile(db);
        const id = await createMessage(db, { ownerId: profile.id, notebookId, role, content });
        return { ok: true, result: { id } };
      }

      case "messages.list": {
        const { notebookId } = args as { notebookId?: string };
        if (!notebookId) {
          return { ok: false, error: { code: "bad_args", message: "notebookId is required" } };
        }
        const { db } = getLocalContext();
        return { ok: true, result: await listMessagesByNotebook(db, notebookId) };
      }

      case "messages.clear": {
        const { notebookId } = args as { notebookId?: string };
        if (!notebookId) {
          return { ok: false, error: { code: "bad_args", message: "notebookId is required" } };
        }
        const { db } = getLocalContext();
        await clearMessagesByNotebook(db, notebookId);
        return { ok: true, result: {} };
      }

      case "materials.request": {
        const { notebookId, type } = args as { notebookId?: string; type?: string };
        const VALID_TYPES: MaterialType[] = [
          "summary", "flashcards", "quiz", "studyGuide", "keyInsights", "podcastSummary", "slides",
        ];
        if (!notebookId || !type || !VALID_TYPES.includes(type as MaterialType)) {
          return { ok: false, error: { code: "bad_args", message: "notebookId and a valid type are required" } };
        }
        const { db } = getLocalContext();
        const profile = await getOrCreateProfile(db);
        const id = await requestGeneration(db, {
          ownerId: profile.id, notebookId, type: type as MaterialType,
        });
        return { ok: true, result: { id } };
      }

      case "materials.list": {
        const { notebookId } = args as { notebookId?: string };
        if (!notebookId) {
          return { ok: false, error: { code: "bad_args", message: "notebookId is required" } };
        }
        const { db } = getLocalContext();
        return { ok: true, result: await listMaterialsByNotebook(db, notebookId) };
      }

      case "materials.delete": {
        const { materialId } = args as { materialId?: string };
        if (!materialId) {
          return { ok: false, error: { code: "bad_args", message: "materialId is required" } };
        }
        const { db, store } = getLocalContext();
        await removeMaterial(db, store, materialId);
        return { ok: true, result: {} };
      }

      case "imports.create": {
        const { notebookId, url } = args as { notebookId?: string; url?: string };
        if (!notebookId || !url) {
          return { ok: false, error: { code: "bad_args", message: "notebookId and url are required" } };
        }
        let classified;
        try {
          classified = classifyUrl(url);
        } catch (err) {
          return {
            ok: false,
            error: { code: "bad_url", message: err instanceof Error ? err.message : "invalid url" },
          };
        }
        const { db } = getLocalContext();
        const profile = await getOrCreateProfile(db);
        const outcome = createImportJob(db, {
          ownerId: profile.id,
          notebookId,
          url,
          provider: classified.provider,
          kind: classified.kind,
          resourceKey: classified.resourceKey,
          ...(classified.externalId && { externalId: classified.externalId }),
          ...(classified.canonicalUrl && { canonicalUrl: classified.canonicalUrl }),
        });
        return { ok: true, result: outcome };
      }

      case "imports.list": {
        const { notebookId } = args as { notebookId?: string };
        if (!notebookId) {
          return { ok: false, error: { code: "bad_args", message: "notebookId is required" } };
        }
        const { db } = getLocalContext();
        return { ok: true, result: await listImportJobsByNotebook(db, notebookId) };
      }

      case "imports.action": {
        const { jobId, action } = args as { jobId?: string; action?: "cancel" | "retry" };
        if (!jobId || (action !== "cancel" && action !== "retry")) {
          return { ok: false, error: { code: "bad_args", message: "jobId and action cancel|retry are required" } };
        }
        const { db } = getLocalContext();
        try {
          if (action === "cancel") cancelImportJob(db, jobId);
          else retryImportJob(db, jobId);
        } catch (err) {
          return {
            ok: false,
            error: { code: "conflict", message: err instanceof Error ? err.message : "action failed" },
          };
        }
        return { ok: true, result: {} };
      }

      case "retrieval.profile.activate": {
        const { provider, model, revision, dimension, pooling, queryPrefix, docPrefix } = args as {
          provider?: string; model?: string; revision?: string;
          dimension?: number; pooling?: string; queryPrefix?: string; docPrefix?: string;
        };
        if (!provider || !model || !revision || !dimension || !pooling) {
          return { ok: false, error: { code: "bad_args", message: "provider, model, revision, dimension and pooling are required" } };
        }
        const { db } = getLocalContext();
        const profile = await registerEmbeddingProfile(db, {
          provider, model, revision, dimension, pooling, queryPrefix, docPrefix,
        });
        await setSetting(db, ACTIVE_PROFILE_KEY, profile._id);
        return { ok: true, result: { profileId: profile._id } };
      }

      case "retrieval.profile.active": {
        const { db } = getLocalContext();
        const profileId = await getSetting<string>(db, ACTIVE_PROFILE_KEY);
        if (!profileId) return { ok: true, result: { profile: null } };
        const profile = await getEmbeddingProfile(db, profileId);
        return { ok: true, result: { profile } };
      }

      case "chat.send": {
        const { notebookId, message } = args as { notebookId?: string; message?: string };
        if (!notebookId || !message) {
          return { ok: false, error: { code: "bad_args", message: "notebookId and message are required" } };
        }
        const { db } = getLocalContext();
        const profile = await getOrCreateProfile(db);
        const caps = await resolveCapabilities();
        const embedQuery = await preEmbedQuery(message, caps.embed);
        try {
          const reply = await sendChatMessage(db, {
            notebookId,
            ownerId: profile.id,
            message,
            chat: caps.chat,
            embedQuery,
          });
          return {
            ok: true,
            result: {
              response: reply.response,
              citations: reply.citations,
              mode: reply.mode,
              vectorStatus: reply.vectorStatus,
              provider: caps.chatProvider,
            },
          };
        } catch (err) {
          return {
            ok: false,
            error: {
              code: err instanceof Error && /Kein KI-Anbieter/.test(err.message) ? "no_provider" : "chat_failed",
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }

      default:
        return {
          ok: false,
          error: { code: "unknown_op", message: `Unknown operation: ${op}` },
        };
    }
  } catch (err) {
    return {
      ok: false,
      error: { code: "internal", message: err instanceof Error ? err.message : String(err) },
    };
  }
}
