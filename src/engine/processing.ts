/**
 * Upload processing pipeline, shared by the standalone worker and the
 * desktop engine (desktop-tauri-plan phase 1: workers/ingestion.ts becomes
 * an engine module). Extract → transcribe → chunk, lease-fenced.
 */
import fs from "node:fs";
import path from "node:path";
import { chunkText, extractTextFromFile } from "@/lib/text-extraction";
import { extractAudioFromVideo } from "@/lib/ffmpeg";
import { transcribeMedia, type MediaSegment } from "@/lib/ingestion/process";
import type { TranscribeFn } from "@/lib/ai/providers";
import { getSource, replaceChunks, updateSourceStatus } from "@/lib/services/sources";
import {
  completeProcessingJob,
  failProcessingJob,
  heartbeatProcessingJob,
} from "@/lib/services/processing-jobs";
import type { LocalContext } from "@/lib/storage/local";
import {
  deleteJobCheckpoints,
  emitJobEvent,
  getJobCheckpoints,
  observeJobIntent,
  setJobCheckpoint,
} from "@/lib/services/job-control";
import { recordVersion } from "@/lib/services/source-versions";

/** Upload pipeline stages the intent gate observes before. */
export type ProcessingStage = "extract" | "transcribe" | "commit";

export type ProcessingJobOutcome = "completed" | "paused" | "cancelled" | "failed" | "lost";

/** Errors no retry can fix (bad input) — everything else is transient. */
export class PermanentProcessingError extends Error {}

export function resolveFileType(fileType: string, fileName: string): string {
  if (fileType && fileType !== "application/octet-stream") return fileType;
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const EXT_MIME: Record<string, string> = {
    pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
    webm: "audio/webm", ogg: "audio/ogg", flac: "audio/flac",
    mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
  };
  return EXT_MIME[ext] || fileType;
}

/** Port of the former POST /api/process pipeline, queue-driven and fenced.
 *  slice 3a: stage-boundary intent gates — a pause releases the lease back to
 *  pending (attempt refunded), a cancel fails the job and errors the source.
 *  The outcome is returned so callers/tests can assert the gate behavior. */
export async function runProcessingJob(
  ctx: LocalContext,
  jobId: string,
  token: string,
  sourceId: string,
  opts?: { beforeStage?: (stage: ProcessingStage) => Promise<void>; transcribe?: TranscribeFn }
): Promise<ProcessingJobOutcome> {
  const log = (step: string, extra?: string) =>
    console.log(`[PROCESS][${sourceId.slice(0, 8)}] ${step}${extra ? ` — ${extra}` : ""}`);

  /**
   * Stage-boundary gate: observe a pending user intent before each fenced
   * stage (extract/transcribe/commit). Checked before and after beforeStage —
   * the hook itself may record an intent (that is how the engine loop and
   * tests pause/cancel mid-run). Returns null to proceed into the stage.
   */
  const gate = async (stage: ProcessingStage): Promise<ProcessingJobOutcome | null> => {
    const finish = (outcome: ProcessingJobOutcome): ProcessingJobOutcome | null => {
      if (outcome === "cancelled") {
        // the uploads UI reads the source row: an aborted transcription must
        // not leave it stuck in "processing" forever
        updateSourceStatus(ctx.db, sourceId, {
          status: "error",
          errorMessage: "Vom Benutzer abgebrochen",
        });
      }
      return outcome;
    };
    const observed = observeJobIntent(ctx.db, "processing", jobId, token);
    if (observed !== "run") return finish(observed);
    await opts?.beforeStage?.(stage);
    const gated = observeJobIntent(ctx.db, "processing", jobId, token);
    if (gated !== "run") return finish(gated);
    return null;
  };

  const hb = setInterval(() => {
    try {
      heartbeatProcessingJob(ctx.db, jobId, token);
    } catch (err) {
      console.error("[PROCESS] heartbeat error:", err);
    }
  }, 60_000);
  const t0 = Date.now();
  // slice 3c: media transcription segments live under tmp/jobs/<jobId>
  const segDir = path.join(ctx.dataDir, "tmp", "jobs", jobId);
  try {
    updateSourceStatus(ctx.db, sourceId, { status: "processing" });
    const source = await getSource(ctx.db, sourceId);
    if (!source) throw new PermanentProcessingError("Quelle nicht gefunden");

    const resolvedType = resolveFileType(source.fileType, source.fileName);
    log(`type=${resolvedType}`);

    // stage gate 1: before extraction (text extraction or ffmpeg audio pull)
    const extractGate = await gate("extract");
    if (extractGate) return extractGate;

    let text: string;
    // strategy 5A: per-segment timing when the media path segmented
    let mediaSegments: MediaSegment[] = [];
    let transcriptFileId: string | undefined;
    // versioned evidence: the original bytes whose hash the version snapshots
    let originalBuffer: Buffer | undefined;

    if (resolvedType.startsWith("audio/") || resolvedType.startsWith("video/")) {
      if (!source.storageId) throw new PermanentProcessingError("Originaldatei fehlt");
      const stored = await ctx.store.read(source.storageId);
      if (!stored) throw new PermanentProcessingError("Originaldatei fehlt auf der Platte");
      log("FILE", `${(stored.buffer.length / 1024 / 1024).toFixed(1)} MB`);
      originalBuffer = stored.buffer;

      let audioBuffer = stored.buffer;
      const ext = source.fileName.split(".").pop()?.toLowerCase() || "wav";
      const supported = ["mp3", "wav", "m4a", "mp4", "webm", "ogg", "flac"];
      if (resolvedType.startsWith("video/") || !supported.includes(ext)) {
        log("FFMPEG EXTRACT AUDIO");
        audioBuffer = await extractAudioFromVideo(stored.buffer);
      }

      // stage gate 2: before the transcription model call (the long stage —
      // this is the boundary a pause/cancel clicked mid-transcription lands on)
      const transcribeGate = await gate("transcribe");
      if (transcribeGate) return transcribeGate;

      // slice 3c: resumable transcription for uploads. Confirmed segments ride
      // the token-fenced "transcribing" checkpoint, seg files live under
      // tmp/jobs/<jobId> (the startup reconcile knows both job kinds' dirs).
      let resume: { resumeFrom: number; confirmedTexts: string[] } | undefined;
      const mediaCp = getJobCheckpoints(ctx.db, "processing", jobId).find((c) => c.stage === "transcribing");
      if (mediaCp?.cursor) {
        try {
          const cur = JSON.parse(mediaCp.cursor) as {
            segDir?: string; segments?: number; doneSegments?: number; texts?: string[];
          };
          if (cur.segDir === segDir && cur.segments && cur.doneSegments && cur.texts) {
            resume = { resumeFrom: cur.doneSegments, confirmedTexts: cur.texts };
          }
        } catch {
          /* corrupt cursor → transcribe from scratch */
        }
      }

      let stopObservation: ProcessingJobOutcome | null = null;
      // S3: the transcriber is injected (resolved from explicit config by the
      // job loop); a media upload without one fails typed instead of reaching
      // for a hardcoded provider.
      if (!opts?.transcribe) throw new PermanentProcessingError("Kein KI-Anbieter für die Transkription konfiguriert. Wähle in den Einstellungen einen Transkriptionsanbieter.");
      const transcription = await transcribeMedia(audioBuffer, source.fileName, opts.transcribe, {
        segDir,
        ...(resume && {
          resumeFrom: resume.resumeFrom,
          confirmedTexts: resume.confirmedTexts,
        }),
        onSegmentDone: (done, total, texts) => {
          setJobCheckpoint(ctx.db, "processing", jobId, token, "transcribing", JSON.stringify({
            segDir, segments: total, doneSegments: done, texts,
          }));
          emitJobEvent(ctx.db, "processing", jobId, "progress", { stage: "transcribing", done, total });
        },
        shouldStop: () => {
          const observed = observeJobIntent(ctx.db, "processing", jobId, token);
          if (observed === "run") return false;
          stopObservation = observed;
          return true;
        },
      });
      text = transcription.text;
      mediaSegments = transcription.segments;
      if (stopObservation) {
        // same terminal bookkeeping as the stage gates: cancel fails the job
        // and errors the source, pause released the lease back to pending
        if (stopObservation === "cancelled") {
          updateSourceStatus(ctx.db, sourceId, { status: "error", errorMessage: "Vom Benutzer abgebrochen" });
          await fs.promises.rm(segDir, { recursive: true, force: true }).catch(() => {});
          deleteJobCheckpoints(ctx.db, "processing", jobId);
        }
        return stopObservation;
      }

      const transcriptFile = await ctx.store.save(Buffer.from(text, "utf-8"), {
        fileName: `${source.fileName}.transcript.txt`,
        contentType: "text/plain",
      });
      transcriptFileId = transcriptFile.id;
    } else if (
      resolvedType === "application/pdf" ||
      resolvedType === "text/plain" ||
      resolvedType === "text/markdown" ||
      resolvedType === "application/markdown" ||
      resolvedType === "text/csv"
    ) {
      if (!source.storageId) throw new PermanentProcessingError("Originaldatei fehlt");
      const stored = await ctx.store.read(source.storageId);
      if (!stored) throw new PermanentProcessingError("Originaldatei fehlt auf der Platte");
      originalBuffer = stored.buffer;
      text = await extractTextFromFile(stored.buffer, resolvedType);
    } else {
      throw new PermanentProcessingError(`Nicht unterstützter Dateityp: ${resolvedType}`);
    }

    // stage gate 3: last intent check before the commit — a pause/cancel
    // clicked during the long extraction/transcription must not commit
    const commitGate = await gate("commit");
    if (commitGate) return commitGate;

    // Fencing: if our lease was reclaimed (worker crash + expiry), a newer
    // attempt owns this job now — our result must not clobber it.
    if (!heartbeatProcessingJob(ctx.db, jobId, token)) {
      log("ABORTED", "Lease verloren — Ergebnis verworfen");
      if (transcriptFileId) await ctx.store.delete(transcriptFileId);
      return "lost";
    }

    const previousTranscriptId = source.transcriptStorageId ?? undefined;
    // strategy 5A: one chunk per transcript segment - chunkIndex IS the
    // segment index, so citations resolve to a time range directly
    const chunks = mediaSegments.length ? mediaSegments.map((s) => s.text) : chunkText(text);
    replaceChunks(ctx.db, { ownerId: source.ownerId, sourceId, notebookId: source.notebookId }, chunks);
    updateSourceStatus(ctx.db, sourceId, {
      status: "completed",
      ...(transcriptFileId && { transcriptStorageId: transcriptFileId }),
    });
    const done = completeProcessingJob(ctx.db, jobId, token);
    if (!done) {
      log("COMPLETE REJECTED", "Lease verloren");
      return "lost"; // chunks were written, but a newer attempt will replace them
    }
    if (previousTranscriptId && previousTranscriptId !== transcriptFileId) {
      await ctx.store.delete(previousTranscriptId);
    }
    // slice 3c terminal bookkeeping: completed — discard media checkpoint + seg files
    await fs.promises.rm(segDir, { recursive: true, force: true }).catch(() => {});
    deleteJobCheckpoints(ctx.db, "processing", jobId);

    // versioned evidence (strategy 5A): snapshot the original bytes as an
    // immutable version; media versions carry the transcript as their page
    // text. Non-fatal — completion must never break on version bookkeeping.
    try {
      const isMedia = resolvedType.startsWith("audio/") || resolvedType.startsWith("video/");
      await recordVersion(ctx.db, ctx.store, {
        sourceId,
        ...(source.storageId ? { storageId: source.storageId } : {}),
        fileName: source.fileName,
        contentType: resolvedType,
        ...(originalBuffer ? { buffer: originalBuffer } : {}),
        ...(isMedia
          ? mediaSegments.length
            ? { mediaSegments } // real per-segment times from the segmenter
            : { pageTexts: [text] } // direct single-call transcription: no times knowable, honest page fallback
          : {}),
      });
    } catch (err) {
      console.error("[PROCESS] version not recorded:", err);
    }

    log("DONE", `${chunks.length} Chunks, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // embedding indexing moved to the engine loop's index lane (slice 3d):
    // the sweep in src/engine/jobs.ts picks completed chunks up.
    return "completed";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentProcessingError;
    log(permanent ? "REJECTED" : "FAILED", message);
    updateSourceStatus(ctx.db, sourceId, { status: "error", errorMessage: message });
    const ok = failProcessingJob(ctx.db, jobId, token, { errorMessage: message, transient: !permanent });
    // slice 3c: terminal failure discards media checkpoint + seg files, a
    // transient one keeps them for the retry (mirror of the import runner)
    if (ok && permanent) {
      await fs.promises.rm(segDir, { recursive: true, force: true }).catch(() => {});
      deleteJobCheckpoints(ctx.db, "processing", jobId);
    }
    return ok ? "failed" : "lost";
  } finally {
    clearInterval(hb);
  }
}
