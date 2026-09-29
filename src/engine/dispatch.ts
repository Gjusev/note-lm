/**
 * Engine operation dispatch (issue #10): the seam where engine ops meet the
 * local services, with no HTTP or Next transport involved.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
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
  updateSourceStorage,
} from "@/lib/services/sources";
import { getLatestVersion } from "@/lib/services/source-versions";
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
  createClaim,
  saveClaimFromMessage,
  listClaims,
  resolveReview,
} from "@/lib/services/claims";
import { listPendingReviews } from "@/lib/services/change-review";
import {
  CalculationError,
  runCalculation,
  listCalculations,
  type CalcOp,
} from "@/lib/services/calculations";
import { evidenceAnchors, sourceVersions, sources as sourcesTable } from "@/db/local/schema";
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
import { MODEL_CATALOG } from "@/lib/ai/model-catalog";
import { resolveCapabilities } from "./capabilities";
import {
  getPreset,
  PRESETS,
  isDesktopEngine,
  setOfflineMode,
  SecretUnavailableError,
  type ProviderConnection,
} from "@/lib/ai/providers";
import { probeConnection, ProbeError, type ProbeArgs } from "@/lib/ai/provider-probe";

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

      case "sources.reimportVersion": {
        // Re-import as version (strategy §9): a changed local file appends a
        // new immutable version of the EXISTING source — never a second
        // source row. Identical bytes are a no-op; changed bytes re-run the
        // same processing pipeline, whose recordVersion hook lands the
        // version and fires the staleness scan against anchored claims.
        const { sourceId, path: filePath, fileName } = args as {
          sourceId?: string; path?: string; fileName?: string;
        };
        if (!sourceId || !filePath) {
          return { ok: false, error: { code: "bad_args", message: "sourceId and path are required" } };
        }
        if (path.isAbsolute(filePath) !== true) {
          return { ok: false, error: { code: "bad_args", message: "path must be absolute" } };
        }
        const { db, store } = getLocalContext();
        const source = getSource(db, sourceId);
        if (!source) return { ok: false, error: { code: "not_found", message: "Quelle nicht gefunden." } };
        let buffer: Buffer;
        try {
          buffer = await fs.promises.readFile(filePath);
        } catch {
          return { ok: false, error: { code: "bad_args", message: `file not readable: ${filePath}` } };
        }
        // identical bytes as the latest version: nothing new to remember
        const hash = createHash("sha256").update(buffer).digest("hex");
        const latest = getLatestVersion(db, sourceId);
        if (latest?.fileHash && latest.fileHash === hash) {
          return { ok: true, result: { unchanged: true } };
        }
        const profile = await getOrCreateProfile(db);
        const stored = await store.save(buffer, {
          fileName: fileName ?? source.fileName,
          contentType: source.fileType,
        });
        // the pipeline reads the original bytes through the source row's
        // storageId — point it at the re-imported file first (the old bytes
        // stay referenced by version 1's storageId and are never deleted)
        await updateSourceStorage(db, sourceId, {
          storageId: stored.id,
          fileSize: buffer.length,
          ...(fileName ? { fileName } : {}),
        });
        const jobId = enqueueProcessingJob(db, { ownerId: profile.id, sourceId, notebookId: source.notebookId });
        return { ok: true, result: { jobId, unchanged: false } };
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

      case "models.catalog": {
        // curated download catalog (I0): static data, no DB involved
        return { ok: true, result: { entries: MODEL_CATALOG } };
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
        const embedQuery = await preEmbedQuery(message, caps.embed ?? null);
        if (!caps.chat) {
          return {
            ok: false,
            error: { code: "no_provider", message: caps.chatReason ?? "Kein KI-Anbieter konfiguriert." },
          };
        }
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
              code: err instanceof SecretUnavailableError
                ? "secret_unavailable"
                : err instanceof Error && /Kein KI-Anbieter/.test(err.message)
                  ? "no_provider"
                  : "chat_failed",
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }

      case "claims.create": {
        const { notebookId, text, anchors } = args as {
          notebookId?: string; text?: string;
          anchors?: { sourceId?: string; page?: number; quote?: string }[];
        };
        if (!notebookId || !text) {
          return { ok: false, error: { code: "bad_args", message: "notebookId and text are required" } };
        }
        const { db } = getLocalContext();
        const profile = await getOrCreateProfile(db);
        // optional anchors: bind the claim to a source's latest version
        // without a chat model (same input the claims service accepts)
        const validAnchors = (Array.isArray(anchors) ? anchors : []).filter(
          (a): a is { sourceId: string; page?: number; quote?: string } => typeof a?.sourceId === "string"
        );
        const outcome = await createClaim(db, {
          notebookId,
          ownerId: profile.id,
          text,
          origin: "user",
          ...(validAnchors.length > 0 && { anchors: validAnchors }),
        });
        return { ok: true, result: outcome };
      }

      case "claims.createFromMessage": {
        const { notebookId, messageId, text } = args as {
          notebookId?: string; messageId?: string; text?: string;
        };
        if (!notebookId || !messageId || !text) {
          return { ok: false, error: { code: "bad_args", message: "notebookId, messageId and text are required" } };
        }
        const { db } = getLocalContext();
        const outcome = await saveClaimFromMessage(db, { notebookId, messageId, text });
        return { ok: true, result: outcome };
      }

      case "claims.list": {
        const { notebookId } = args as { notebookId?: string };
        if (!notebookId) {
          return { ok: false, error: { code: "bad_args", message: "notebookId is required" } };
        }
        const { db } = getLocalContext();
        return { ok: true, result: listClaims(db, notebookId) };
      }

      case "review.list": {
        const { notebookId } = args as { notebookId?: string };
        if (!notebookId) {
          return { ok: false, error: { code: "bad_args", message: "notebookId is required" } };
        }
        const { db } = getLocalContext();
        return { ok: true, result: listPendingReviews(db, notebookId) };
      }

      case "review.resolve": {
        const { proposalId, decision, note } = args as {
          proposalId?: string; decision?: string; note?: string;
        };
        if (!proposalId || (decision !== "accepted" && decision !== "rejected")) {
          return { ok: false, error: { code: "bad_args", message: "proposalId and decision accepted|rejected are required" } };
        }
        const { db, store } = getLocalContext();
        try {
          await resolveReview(db, store, {
            proposalId,
            decision,
            ...(note !== undefined && { note }),
          });
        } catch (err) {
          return {
            ok: false,
            error: { code: "not_found", message: err instanceof Error ? err.message : String(err) },
          };
        }
        return { ok: true, result: {} };
      }

      case "evidence.open": {
        const { anchorId } = args as { anchorId?: string };
        if (!anchorId) {
          return { ok: false, error: { code: "bad_args", message: "anchorId is required" } };
        }
        const { db, store, dataDir } = getLocalContext();
        const anchor = db.select().from(evidenceAnchors).where(eq(evidenceAnchors.id, anchorId)).get();
        if (!anchor) return { ok: false, error: { code: "not_found", message: "Anker nicht gefunden." } };
        const version = db.select().from(sourceVersions).where(eq(sourceVersions.id, anchor.sourceVersionId)).get();
        if (!version) return { ok: false, error: { code: "not_found", message: "Version des Ankers nicht gefunden." } };
        const source = db.select({ fileName: sourcesTable.fileName }).from(sourcesTable).where(eq(sourcesTable.id, version.sourceId)).get();
        let absolutePath: string | null = null;
        if (version.storageId) {
          // resolved through the files row (the extension lives in the stored
          // path); only an existing file is reported - never a fabricated path
          const stored = await store.get(version.storageId);
          const candidate = stored
            ? path.join(dataDir, stored.path)
            : path.join(dataDir, "files", version.storageId);
          absolutePath = fs.existsSync(candidate) ? candidate : null;
        }
        return {
          ok: true,
          result: {
            fileName: source?.fileName ?? null,
            page: anchor.page,
            quote: anchor.quote,
            storageId: version.storageId,
            absolutePath,
          },
        };
      }

      case "calculations.run": {
        const { notebookId, sourceId, sourceVersionId, op, column, filter } = args as {
          notebookId?: string; sourceId?: string; sourceVersionId?: string;
          op?: string; column?: string | number;
          filter?: { column: string | number; equals: string };
        };
        if (!notebookId || !op || column === undefined || column === null) {
          return { ok: false, error: { code: "bad_args", message: "notebookId, op and column are required" } };
        }
        if (!sourceId && !sourceVersionId) {
          return { ok: false, error: { code: "bad_args", message: "sourceId or sourceVersionId is required" } };
        }
        const CALC_OPS: CalcOp[] = ["sum", "avg", "min", "max", "count"];
        if (!CALC_OPS.includes(op as CalcOp)) {
          return { ok: false, error: { code: "bad_args", message: `op must be one of ${CALC_OPS.join("|")}` } };
        }
        const { db, store } = getLocalContext();
        const profile = await getOrCreateProfile(db);
        try {
          const doc = await runCalculation(db, store, {
            ownerId: profile.id,
            notebookId,
            ...(sourceId ? { sourceId } : {}),
            ...(sourceVersionId ? { sourceVersionId } : {}),
            op: op as CalcOp,
            column,
            ...(filter ? { filter } : {}),
          });
          return { ok: true, result: doc };
        } catch (err) {
          if (err instanceof CalculationError) {
            return { ok: false, error: { code: err.code, message: err.message } };
          }
          throw err;
        }
      }

      case "calculations.list": {
        const { notebookId } = args as { notebookId?: string };
        if (!notebookId) {
          return { ok: false, error: { code: "bad_args", message: "notebookId is required" } };
        }
        const { db } = getLocalContext();
        return { ok: true, result: listCalculations(db, notebookId) };
      }

      case "providers.list": {
        const { db } = getLocalContext();
        const [connections, capabilities, offline] = await Promise.all([
          getSetting<ProviderConnection[]>(db, "ai.connections"),
          getSetting<Record<string, { connectionId: string; model: string }>>(db, "ai.capabilities"),
          getSetting<string>(db, "ai.offline"),
        ]);
        return {
          ok: true,
          result: {
            presets: PRESETS.map(({ id, label, baseUrl, capabilities: caps, experimental }) => ({
              id,
              label,
              baseUrl,
              capabilities: caps,
              ...(experimental ? { experimental: true } : {}),
            })),
            connections: connections ?? [],
            capabilities: capabilities ?? {},
            offline: offline === "1",
          },
        };
      }


      case "providers.save": {
        const { connection, models } = args as {
          connection?: { id?: string; presetId?: string; label?: string; baseUrl?: string };
          models?: Record<string, string>;
        };
        const preset = connection?.presetId ? getPreset(connection.presetId) : undefined;
        if (!connection?.presetId || !preset || !connection.label) {
          return { ok: false, error: { code: "bad_args", message: "connection with known presetId and label are required" } };
        }
        if (connection.baseUrl && !/^https?:\/\//.test(connection.baseUrl)) {
          return { ok: false, error: { code: "bad_args", message: "baseUrl must be an http(s) URL" } };
        }
        const { db } = getLocalContext();
        const connections = (await getSetting<ProviderConnection[]>(db, "ai.connections")) ?? [];
        const id = connection.id ?? crypto.randomUUID();
        const next = connections.filter((c) => c.id !== id);
        next.push({
          id,
          presetId: connection.presetId,
          label: connection.label,
          ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
        });
        await setSetting(db, "ai.connections", next);
        // capability model selections ride on the same save (form is one unit)
        const caps = (await getSetting<Record<string, { connectionId: string; model: string }>>(db, "ai.capabilities")) ?? {};
        for (const capability of ["chat", "embed", "transcribe", "tts"] as const) {
          const model = models?.[capability];
          if (typeof model === "string" && model.trim()) {
            caps[capability] = { connectionId: id, model: model.trim() };
          }
        }
        await setSetting(db, "ai.capabilities", caps);
        return { ok: true, result: { id } };
      }

      case "providers.delete": {
        const { connectionId } = args as { connectionId?: string };
        if (!connectionId) {
          return { ok: false, error: { code: "bad_args", message: "connectionId is required" } };
        }
        const { db } = getLocalContext();
        const connections = (await getSetting<ProviderConnection[]>(db, "ai.connections")) ?? [];
        await setSetting(db, "ai.connections", connections.filter((c) => c.id !== connectionId));
        const caps = (await getSetting<Record<string, { connectionId: string; model: string }>>(db, "ai.capabilities")) ?? {};
        for (const key of Object.keys(caps)) {
          if (caps[key].connectionId === connectionId) delete caps[key];
        }
        await setSetting(db, "ai.capabilities", caps);
        return { ok: true, result: {} };
      }

      case "providers.test": {
        const { capability, connection, secret } = (args ?? {}) as ProbeArgs & { secret?: string };
        if (!capability || !["chat", "embed", "transcribe", "tts"].includes(capability as string)) {
          return { ok: false, error: { code: "bad_args", message: "capability chat|embed|transcribe|tts is required" } };
        }
        if (!connection?.presetId) {
          return { ok: false, error: { code: "bad_args", message: "connection.presetId is required" } };
        }
        const { db } = getLocalContext();
        try {
          const result = await probeConnection(db, { capability, connection, secret });
          return { ok: true, result };
        } catch (err) {
          if (err instanceof ProbeError) {
            return { ok: false, error: { code: err.code, message: err.message } };
          }
          return { ok: false, error: { code: "internal", message: err instanceof Error ? err.message : String(err) } };
        }
      }

      case "providers.setSecret": {
        // Dev/browser convenience only: in the desktop app secrets go through
        // the Rust keyring command, never into the settings table.
        if (isDesktopEngine()) {
          return { ok: false, error: { code: "not_available", message: "Zugangsdaten werden im Desktop-Modus nur über den Betriebssystem-Schlüsselbund gespeichert." } };
        }
        const { connectionId, secret } = args as { connectionId?: string; secret?: string };
        if (!connectionId || typeof secret !== "string") {
          return { ok: false, error: { code: "bad_args", message: "connectionId and secret are required" } };
        }
        const { db } = getLocalContext();
        const secrets = (await getSetting<Record<string, string>>(db, "ai.secrets")) ?? {};
        if (secret === "") delete secrets[connectionId];
        else secrets[connectionId] = secret;
        await setSetting(db, "ai.secrets", secrets);
        return { ok: true, result: {} };
      }

      case "settings.offline": {
        const { on } = args as { on?: boolean };
        if (typeof on !== "boolean") {
          return { ok: false, error: { code: "bad_args", message: "on (boolean) is required" } };
        }
        const { db } = getLocalContext();
        await setOfflineMode(db, on);
        return { ok: true, result: { offline: on } };
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
