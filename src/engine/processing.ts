/**
 * Upload processing pipeline, shared by the standalone worker and the
 * desktop engine (desktop-tauri-plan phase 1: workers/ingestion.ts becomes
 * an engine module). Extract → transcribe → chunk, lease-fenced.
 */
import { chunkText, extractTextFromFile } from "@/lib/text-extraction";
import { extractAudioFromVideo } from "@/lib/ffmpeg";
import { transcribeAudio } from "@/lib/openai";
import { getSource, replaceChunks, updateSourceStatus } from "@/lib/services/sources";
import {
  completeProcessingJob,
  failProcessingJob,
  heartbeatProcessingJob,
} from "@/lib/services/processing-jobs";
import type { LocalContext } from "@/lib/storage/local";
import { getSetting } from "@/lib/services/settings";
import { getEmbeddingProfile } from "@/lib/services/embedding-profiles";
import { indexNotebookChunks } from "@/lib/services/vector-index";

async function maybeIndexNotebook(ctx: LocalContext, notebookId: string): Promise<void> {
  const profileId = await getSetting<string>(ctx.db, "retrieval.activeProfile");
  if (!profileId) return;
  const profile = await getEmbeddingProfile(ctx.db, profileId);
  if (!profile) return;
  const { resolveCapabilities } = await import("./capabilities");
  const caps = await resolveCapabilities();
  if (!caps.embed) return; // no embedder configured → textual only
  const run = await indexNotebookChunks(ctx.db, {
    profileId: profile._id,
    dimension: profile.dimension,
    notebookId,
    batchSize: 16,
    embed: caps.embed,
  });
  if (run.indexed > 0) console.log(`[PROCESS] auto-indexed ${run.indexed} chunks for profile ${profile._id.slice(0, 8)}`);
}

/** Errors no retry can fix (bad input) — everything else is transient. */
export class PermanentProcessingError extends Error {}

export function resolveFileType(fileType: string, fileName: string): string {
  if (fileType && fileType !== "application/octet-stream") return fileType;
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const EXT_MIME: Record<string, string> = {
    pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
    webm: "audio/webm", ogg: "audio/ogg", flac: "audio/flac",
    mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
  };
  return EXT_MIME[ext] || fileType;
}

/** Port of the former POST /api/process pipeline, queue-driven and fenced. */
export async function runProcessingJob(
  ctx: LocalContext,
  jobId: string,
  token: string,
  sourceId: string
): Promise<void> {
  const log = (step: string, extra?: string) =>
    console.log(`[PROCESS][${sourceId.slice(0, 8)}] ${step}${extra ? ` — ${extra}` : ""}`);

  const hb = setInterval(() => {
    try {
      heartbeatProcessingJob(ctx.db, jobId, token);
    } catch (err) {
      console.error("[PROCESS] heartbeat error:", err);
    }
  }, 60_000);
  const t0 = Date.now();
  try {
    updateSourceStatus(ctx.db, sourceId, { status: "processing" });
    const source = await getSource(ctx.db, sourceId);
    if (!source) throw new PermanentProcessingError("Quelle nicht gefunden");

    const resolvedType = resolveFileType(source.fileType, source.fileName);
    log(`type=${resolvedType}`);

    let text: string;
    let transcriptFileId: string | undefined;

    if (resolvedType.startsWith("audio/") || resolvedType.startsWith("video/")) {
      if (!source.storageId) throw new PermanentProcessingError("Originaldatei fehlt");
      const stored = await ctx.store.read(source.storageId);
      if (!stored) throw new PermanentProcessingError("Originaldatei fehlt auf der Platte");
      log("FILE", `${(stored.buffer.length / 1024 / 1024).toFixed(1)} MB`);

      let audioBuffer = stored.buffer;
      const ext = source.fileName.split(".").pop()?.toLowerCase() || "wav";
      const supported = ["mp3", "wav", "m4a", "mp4", "webm", "ogg", "flac"];
      if (resolvedType.startsWith("video/") || !supported.includes(ext)) {
        log("FFMPEG EXTRACT AUDIO");
        audioBuffer = await extractAudioFromVideo(stored.buffer);
      }
      text = await transcribeAudio(audioBuffer, "audio.mp3");

      const transcriptFile = await ctx.store.save(Buffer.from(text, "utf-8"), {
        fileName: `${source.fileName}.transcript.txt`,
        contentType: "text/plain",
      });
      transcriptFileId = transcriptFile.id;
    } else if (
      resolvedType === "application/pdf" ||
      resolvedType === "text/plain" ||
      resolvedType === "text/markdown" ||
      resolvedType === "application/markdown"
    ) {
      if (!source.storageId) throw new PermanentProcessingError("Originaldatei fehlt");
      const stored = await ctx.store.read(source.storageId);
      if (!stored) throw new PermanentProcessingError("Originaldatei fehlt auf der Platte");
      text = await extractTextFromFile(stored.buffer, resolvedType);
    } else {
      throw new PermanentProcessingError(`Nicht unterstützter Dateityp: ${resolvedType}`);
    }

    // Fencing: if our lease was reclaimed (worker crash + expiry), a newer
    // attempt owns this job now — our result must not clobber it.
    if (!heartbeatProcessingJob(ctx.db, jobId, token)) {
      log("ABORTED", "Lease verloren — Ergebnis verworfen");
      if (transcriptFileId) await ctx.store.delete(transcriptFileId);
      return;
    }

    const previousTranscriptId = source.transcriptStorageId ?? undefined;
    const chunks = chunkText(text);
    replaceChunks(ctx.db, { ownerId: source.ownerId, sourceId, notebookId: source.notebookId }, chunks);
    updateSourceStatus(ctx.db, sourceId, {
      status: "completed",
      ...(transcriptFileId && { transcriptStorageId: transcriptFileId }),
    });
    const done = completeProcessingJob(ctx.db, jobId, token);
    if (!done) {
      log("COMPLETE REJECTED", "Lease verloren");
      return; // chunks were written, but a newer attempt will replace them
    }
    if (previousTranscriptId && previousTranscriptId !== transcriptFileId) {
      await ctx.store.delete(previousTranscriptId);
    }
    log("DONE", `${chunks.length} Chunks, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // chain: completed source → embedding index when a profile is active
    // (phase 2). Failures never fail the processing job — indexing retries
    // on the next run/demand.
    void maybeIndexNotebook(ctx, source.notebookId).catch((err) =>
      console.error(`[PROCESS] auto-index failed: ${err instanceof Error ? err.message : err}`)
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentProcessingError;
    log(permanent ? "REJECTED" : "FAILED", message);
    updateSourceStatus(ctx.db, sourceId, { status: "error", errorMessage: message });
    failProcessingJob(ctx.db, jobId, token, { errorMessage: message, transient: !permanent });
  } finally {
    clearInterval(hb);
  }
}
