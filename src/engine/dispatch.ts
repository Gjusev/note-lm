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
import { cancelPendingProcessingJob, enqueueProcessingJob } from "@/lib/services/processing-jobs";
import { createNote, listNotesByNotebook, removeNote, updateNote } from "@/lib/services/notes";
import {
  getChunksBySource,
  getSource,
  listSourcesByNotebook,
  removeSource,
} from "@/lib/services/sources";
import { clearMessagesByNotebook, createMessage, listMessagesByNotebook } from "@/lib/services/messages";
import { removeMaterial } from "@/lib/services/learning-materials";
import {
  cancelImportJob,
  createImportJob,
  getImportJob,
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
import { exportNotebook, importNotebook } from "@/lib/services/notebook-transfer";
import {
  generateMaterial,
  listMaterialsByNotebook,
  requestGeneration,
} from "@/lib/services/materials";
import {
  importModelFromFile,
  listModels,
  getModel,
  modelAbsolutePath,
} from "@/lib/services/models";
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

      case "diagnostics.capabilities": {
        const { db } = getLocalContext();
        const { vecExtensionAvailable } = await import("@/lib/services/vector-index");
        let vecVersion: string | null = null;
        if (vecExtensionAvailable(db)) {
          const { rawClient } = await import("@/db/local");
          vecVersion = String(
            (rawClient(db).prepare("SELECT vec_version() AS v").get() as { v: string }).v
          );
        }
        return {
          ok: true,
          result: {
            vecVersion,
            localChatConfigured: !!(process.env.NOTELM_LLAMA_DIR && process.env.NOTELM_CHAT_MODEL),
            localEmbedConfigured: !!(process.env.NOTELM_LLAMA_DIR && process.env.NOTELM_EMBED_MODEL),
          },
        };
      }

      case "models.list": {
        const { db } = getLocalContext();
        const rows = listModels(db);
        const [chatId, embedId] = await Promise.all([
          getSetting<string>(db, "ai.chatModelId"),
          getSetting<string>(db, "ai.embedModelId"),
        ]);
        return {
          ok: true,
          result: {
            models: rows,
            activeChatModelId: chatId ?? null,
            activeEmbedModelId: embedId ?? null,
          },
        };
      }

      case "models.importFile": {
        // Rust granted the path via the native dialog
        const { path: filePath, capability } = args as {
          path?: string; capability?: "chat" | "embeddings";
        };
        if (!filePath || (capability !== "chat" && capability !== "embeddings")) {
          return { ok: false, error: { code: "bad_args", message: "path and capability chat|embeddings are required" } };
        }
        if (path.isAbsolute(filePath) !== true) {
          return { ok: false, error: { code: "bad_args", message: "path must be absolute" } };
        }
        const { db, dataDir } = getLocalContext();
        try {
          const outcome = await importModelFromFile(db, dataDir, filePath, capability);
          return { ok: true, result: outcome };
        } catch (err) {
          return {
            ok: false,
            error: { code: "import_failed", message: err instanceof Error ? err.message : String(err) },
          };
        }
      }

      case "models.select": {
        const { modelId, capability } = args as {
          modelId?: string; capability?: "chat" | "embeddings";
        };
        if (!modelId || (capability !== "chat" && capability !== "embeddings")) {
          return { ok: false, error: { code: "bad_args", message: "modelId and capability chat|embeddings are required" } };
        }
        const { db } = getLocalContext();
        const model = getModel(db, modelId);
        if (!model || model.capability !== capability || model.status !== "available") {
          return { ok: false, error: { code: "not_found", message: "passendes verfügbares Modell nicht gefunden" } };
        }
        await setSetting(db, capability === "chat" ? "ai.chatModelId" : "ai.embedModelId", modelId);
        // a changed embeddings model invalidates the active profile's index:
        // deactivate so retrieval degrades visibly to textual until reindex
        if (capability === "embeddings") {
          await setSetting(db, "retrieval.activeProfile", null);
        }
        return { ok: true, result: {} };
      }

      case "models.download": {
        const { url, capability, fileName, sha256 } = args as {
          url?: string; capability?: "chat" | "embeddings"; fileName?: string; sha256?: string;
        };
        if (!url || !fileName || (capability !== "chat" && capability !== "embeddings")) {
          return { ok: false, error: { code: "bad_args", message: "url, fileName and capability are required" } };
        }
        const { db, dataDir } = getLocalContext();
        const { downloadModel } = await import("@/lib/services/models");
        try {
          const model = await downloadModel(db, dataDir, { url, capability, fileName, sha256 });
          return { ok: true, result: { model } };
        } catch (err) {
          return {
            ok: false,
            error: { code: "download_failed", message: err instanceof Error ? err.message : String(err) },
          };
        }
      }

      case "materials.list": {
        const { notebookId } = args as { notebookId?: string };
        if (!notebookId) {
          return { ok: false, error: { code: "bad_args", message: "notebookId is required" } };
        }
        const { db } = getLocalContext();
        return { ok: true, result: await listMaterialsByNotebook(db, notebookId) };
      }

      case "materials.request": {
        // queue generation; the engine job loop executes it with the
        // configured provider (local llama or remote)
        const { notebookId, type } = args as { notebookId?: string; type?: string };
        if (!notebookId || !type) {
          return { ok: false, error: { code: "bad_args", message: "notebookId and type are required" } };
        }
        const { db } = getLocalContext();
        const profile = await getOrCreateProfile(db);
        try {
          const materialId = await requestGeneration(db, {
            ownerId: profile.id,
            notebookId,
            type: type as "summary",
          });
          const { enqueueMaterialGeneration } = await import("./jobs");
          enqueueMaterialGeneration(materialId, notebookId, type as "summary");
          return { ok: true, result: { id: materialId } };
        } catch (err) {
          return {
            ok: false,
            error: { code: "bad_args", message: err instanceof Error ? err.message : String(err) },
          };
        }
      }

      case "jobs.list": {
        const { notebookId: nbFilter } = args as { notebookId?: string };
        const { db } = getLocalContext();
        const { listJobs } = await import("@/lib/services/job-control");
        // schedulerPaused rides along so the UI can show the paused state
        // without a second round trip (close/tray slice)
        const schedulerPaused = (await getSetting<boolean>(db, "scheduler.paused")) === true;
        return { ok: true, result: { jobs: listJobs(db, nbFilter), schedulerPaused } };
      }

      case "scheduler.pause":
      case "scheduler.resume": {
        // Global pause is a settings row the scheduler loop reads every claim
        // tick (see src/engine/jobs.ts) — persisting it here keeps the engine
        // the sole state writer, e.g. for "Pausieren und beenden".
        const { db } = getLocalContext();
        await setSetting(db, "scheduler.paused", op === "scheduler.pause");
        return { ok: true, result: { paused: op === "scheduler.pause" } };
      }

      case "jobs.pause":
      case "jobs.resume":
      case "jobs.cancel": {
        const { kind, jobId } = args as { kind?: string; jobId?: string };
        const VALID = ["processing", "import", "material"];
        if (!kind || !VALID.includes(kind) || !jobId) {
          return { ok: false, error: { code: "bad_args", message: "kind (processing|import|material) and jobId are required" } };
        }
        const intent = op === "jobs.pause" ? "pause" : op === "jobs.resume" ? "run" : "cancel";
        const { db } = getLocalContext();
        if (op === "jobs.cancel") {
          // A queued import / pending processing job is filtered out of the
          // claim by its intent (claim SQL) — intent alone would leave it
          // stuck "pending" forever. End it directly; the engine is the sole
          // writer, so the plain status update is safe for unclaimed rows.
          if (kind === "import" && getImportJob(db, jobId)?.status === "queued") {
            cancelImportJob(db, jobId);
          }
          if (kind === "processing") cancelPendingProcessingJob(db, jobId);
        }
        const { setJobIntent } = await import("@/lib/services/job-control");
        setJobIntent(db, kind as "processing", jobId, intent);
        return { ok: true, result: { intent } };
      }

      case "jobs.eventsSince": {
        const { cursor } = args as { cursor?: number };
        const { db } = getLocalContext();
        const { eventsSince, latestEventSeq } = await import("@/lib/services/job-control");
        const events = eventsSince(db, cursor ?? 0);
        // the max seq rides along: when the page is empty the caller is at the
        // head, otherwise it resumes after the last delivered event
        return {
          ok: true,
          result: {
            events,
            cursor: events.length ? events.at(-1)!.seq : latestEventSeq(db),
          },
        };
      }

      case "notebook.export": {
        // Rust granted the target directory via the native dialog
        const { notebookId: nbId, targetDir } = args as { notebookId?: string; targetDir?: string };
        if (!nbId || !targetDir || path.isAbsolute(targetDir) !== true) {
          return { ok: false, error: { code: "bad_args", message: "notebookId and absolute targetDir are required" } };
        }
        const { db, store } = getLocalContext();
        try {
          const outcome = await exportNotebook(db, store, nbId, targetDir);
          return { ok: true, result: outcome };
        } catch (err) {
          return {
            ok: false,
            error: { code: "export_failed", message: err instanceof Error ? err.message : String(err) },
          };
        }
      }

      case "notebook.import": {
        const { sourceDir } = args as { sourceDir?: string };
        if (!sourceDir || path.isAbsolute(sourceDir) !== true) {
          return { ok: false, error: { code: "bad_args", message: "absolute sourceDir is required" } };
        }
        const { db, store } = getLocalContext();
        try {
          const outcome = await importNotebook(db, store, sourceDir);
          return { ok: true, result: outcome };
        } catch (err) {
          return {
            ok: false,
            error: { code: "import_failed", message: err instanceof Error ? err.message : String(err) },
          };
        }
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
