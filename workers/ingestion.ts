/**
 * Local ingestion worker: a Node process separate from Next.js, sharing the
 * SQLite database in the data dir. Consumes two queues:
 *
 *  1. processing_jobs — manual uploads: extract/transcribe → chunk → complete
 *  2. import_jobs     — URL imports: identify → inspect → resolve → download
 *                       → process → store (lease/fenced, crash-recoverable)
 *
 * Kill it any time — leases expire and the next run picks the job up. No
 * credentials needed to start; AI paths (transcription) only run when a key
 * is configured.
 *
 * Run: npm run worker   (env: NOTELM_DATA_DIR optional, INGEST_* optional)
 */
import { openLocalDb, resolveDataDir } from "../src/db/local";
import { LocalStore } from "../src/lib/storage/local";
import { classifyUrl, providerEnabled } from "../src/lib/ingestion/identify";
import { getAdapter } from "../src/lib/ingestion/registry";
import { downloadPlan, cleanupDownload, type DownloadResult } from "../src/lib/ingestion/download";
import { processContent } from "../src/lib/ingestion/process";
import { processHtmlPage } from "../src/lib/ingestion/web";
import { chunkText, extractTextFromFile } from "../src/lib/text-extraction";
import { extractAudioFromVideo } from "../src/lib/ffmpeg";
import { transcribeAudio } from "../src/lib/openai";
import { IdentifiedResource, ImportErrorCode, ImportError, ProviderId } from "../src/lib/ingestion/types";
import type { LocalContext } from "../src/lib/storage/local";
import { getSource, updateSourceStatus, replaceChunks } from "../src/lib/services/sources";
import type { ImportJobDoc } from "../src/lib/services/import-jobs";
import {
  claimImportJob,
  completeImportJob,
  failImportJob,
  heartbeatImportJob,
  updateImportJobPhase,
} from "../src/lib/services/import-jobs";
import {
  claimProcessingJob,
  completeProcessingJob,
  failProcessingJob,
  heartbeatProcessingJob,
} from "../src/lib/services/processing-jobs";

try {
  process.loadEnvFile?.();
} catch {
  /* no .env file — env comes from the process environment */
}

const POLL_MS = parseInt(process.env.INGEST_POLL_MS || "3000");
const HEARTBEAT_MS = 60_000;

let ctx: LocalContext;

function log(scope: string, id: string, step: string, extra?: string) {
  console.log(`[${scope}][${id.slice(0, 8)}] ${step}${extra ? ` — ${extra}` : ""}`);
}

function resourceFromJob(job: ImportJobDoc): IdentifiedResource {
  return {
    provider: job.provider as ProviderId,
    kind: job.kind as IdentifiedResource["kind"],
    resourceKey: job.resourceKey,
    originalUrl: job.url,
    canonicalUrl: job.canonicalUrl || job.url,
    externalId: job.externalId ?? undefined,
  };
}

/** Persist the original bytes so re-processing never needs the network. */
async function persistOriginal(
  store: LocalStore,
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string | undefined> {
  try {
    const file = await store.save(buffer, { fileName, contentType });
    return file.id;
  } catch (err) {
    console.error("[IMPORT] original not persisted:", err);
    return undefined; // provenance + chunks still complete without the blob
  }
}

async function runImportJob(job: ImportJobDoc): Promise<void> {
  const jobId = job._id;
  const token = job.leaseToken!;

  // The lease is extended while long phases (download/ffmpeg/transcription) run.
  // Stale or cancelled jobs are fenced at the next phase/complete write.
  const hb = setInterval(() => {
    try {
      heartbeatImportJob(ctx.db, jobId, token);
    } catch (err) {
      console.error("[IMPORT] heartbeat error:", err);
    }
  }, HEARTBEAT_MS);

  let download: DownloadResult | null = null;
  try {
    let resource = resourceFromJob(job);
    if (!providerEnabled(resource.provider)) {
      throw new ImportError("unsupported", `Provider '${resource.provider}' ist deaktiviert`);
    }

    // max 2 dispatch hops: a generic short link may land on a known provider
    for (let hop = 0; hop < 2; hop++) {
      const adapter = getAdapter(resource.provider);
      const meta = await adapter.inspect(resource);
      updateImportJobPhase(ctx.db, jobId, token, "inspecting", meta.title);

      const plan = await adapter.resolve(resource);
      const okPhase = updateImportJobPhase(ctx.db, jobId, token, "downloading");
      if (!okPhase) { log("IMPORT", jobId, "ABORTED", "Lease verloren"); return; }

      download = await downloadPlan(plan);
      log("IMPORT", jobId, "DOWNLOADED", `${download.contentType} ${(download.bytes / 1024).toFixed(0)} KB`);

      // short-link re-dispatch: final URL may belong to a known provider
      const finalClassified = classifyUrl(download.finalUrl);
      if (finalClassified.provider !== resource.provider) {
        log("IMPORT", jobId, "REDISPATCH", `${resource.provider} → ${finalClassified.provider}`);
        await cleanupDownload(download);
        download = null;
        resource = finalClassified;
        if (!providerEnabled(resource.provider)) {
          throw new ImportError("unsupported", `Ziel-Provider '${resource.provider}' ist deaktiviert`);
        }
        continue;
      }

      const okProcessing = updateImportJobPhase(ctx.db, jobId, token, "processing");
      if (!okProcessing) { log("IMPORT", jobId, "ABORTED", "Lease verloren"); return; }

      let text: string;
      let title: string | undefined;
      let originalBuffer: Buffer | null = null;
      if (download.contentType === "text/html" || download.contentType === "application/xhtml+xml") {
        originalBuffer = download.buffer;
        const page = processHtmlPage(download.buffer.toString("utf-8"), resource.canonicalUrl);
        title = page.title;
        text = page.text;
      } else {
        originalBuffer = download.buffer;
        const result = await processContent(download.buffer, download.contentType, plan.fileNameHint || "download");
        text = result.text;
        title = meta.title || plan.fileNameHint;
      }
      if (!text.trim()) {
        throw new ImportError("bad_content", "Kein Textinhalt extrahierbar");
      }

      const chunks = chunkText(text).map((content, chunkIndex) => ({ content, chunkIndex }));
      const hostname = (() => { try { return new URL(resource.originalUrl).hostname; } catch { return resource.provider; } })();
      const fileName = title || hostname;

      const storageId = originalBuffer
        ? await persistOriginal(ctx.store, originalBuffer, fileName, download.contentType)
        : undefined;

      const res = completeImportJob(
        ctx.db,
        jobId,
        token,
        {
          fileName,
          fileType: download.contentType,
          fileSize: download.contentType === "text/html" ? text.length : download.bytes,
          url: job.url, // provenance: original URL, never a signed temporary URL
          provider: resource.provider,
          ...(storageId !== undefined && { storageId }),
          canonicalUrl: resource.canonicalUrl,
          externalId: resource.externalId || resource.resourceKey,
          title: meta.title,
          author: meta.author,
        },
        chunks
      );
      if (!res?.ok) {
        log("IMPORT", jobId, "COMPLETE REJECTED", "Lease verloren — Ergebnis verworfen");
        // our original bytes are not referenced by anyone anymore
        if (storageId) await ctx.store.delete(storageId);
      } else {
        for (const staleId of res.staleFileIds ?? []) {
          await ctx.store.delete(staleId);
        }
        log("IMPORT", jobId, "DONE", `${chunks.length} Chunks, Quelle ${res.sourceId}`);
      }
      return;
    }
    throw new ImportError("unsupported", "Ziel konnte keinem Provider zugeordnet werden");
  } catch (err) {
    const isImportError = err instanceof ImportError;
    const imp = isImportError
      ? err
      : new ImportError("internal", err instanceof Error ? err.message : String(err), { transient: true });
    log("IMPORT", jobId, "FAILED", `${imp.code}: ${imp.message}`);
    failImportJob(ctx.db, jobId, token, {
      errorCode: imp.code satisfies ImportErrorCode,
      errorMessage: imp.message,
      transient: imp.transient,
      ...(imp.retryAfterMs !== undefined && { retryAfterMs: imp.retryAfterMs }),
    });
  } finally {
    clearInterval(hb);
    if (download) await cleanupDownload(download);
  }
}

/** Errors that no retry can fix (bad input) — everything else is transient. */
class PermanentProcessingError extends Error {}

/** Port of the former POST /api/process pipeline, now queue-driven. */
async function runProcessingJob(jobId: string, token: string, sourceId: string): Promise<void> {
  const hb = setInterval(() => {
    try {
      heartbeatProcessingJob(ctx.db, jobId, token);
    } catch (err) {
      console.error("[PROCESS] heartbeat error:", err);
    }
  }, HEARTBEAT_MS);
  const t0 = Date.now();
  try {
    updateSourceStatus(ctx.db, sourceId, { status: "processing" });
    const source = await getSource(ctx.db, sourceId);
    if (!source) throw new PermanentProcessingError("Quelle nicht gefunden");

    const resolvedType = resolveFileType(source.fileType, source.fileName);
    log("PROCESS", sourceId, `type=${resolvedType}`);

    let text: string;
    let transcriptFileId: string | undefined;

    if (resolvedType.startsWith("audio/") || resolvedType.startsWith("video/")) {
      if (!source.storageId) throw new PermanentProcessingError("Originaldatei fehlt");
      const stored = await ctx.store.read(source.storageId);
      if (!stored) throw new PermanentProcessingError("Originaldatei fehlt auf der Platte");
      log("PROCESS", sourceId, "FILE", `${(stored.buffer.length / 1024 / 1024).toFixed(1)} MB`);

      let audioBuffer = stored.buffer;
      const ext = source.fileName.split(".").pop()?.toLowerCase() || "wav";
      const supported = ["mp3", "wav", "m4a", "mp4", "webm", "ogg", "flac"];
      if (resolvedType.startsWith("video/") || !supported.includes(ext)) {
        log("PROCESS", sourceId, "FFMPEG EXTRACT AUDIO");
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
      log("PROCESS", sourceId, "ABORTED", "Lease verloren — Ergebnis verworfen");
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
      log("PROCESS", sourceId, "COMPLETE REJECTED", "Lease verloren");
      return; // chunks were written, but a newer attempt will replace them
    }
    if (previousTranscriptId && previousTranscriptId !== transcriptFileId) {
      await ctx.store.delete(previousTranscriptId);
    }
    log("PROCESS", sourceId, "DONE", `${chunks.length} Chunks, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentProcessingError;
    log("PROCESS", sourceId, permanent ? "REJECTED" : "FAILED", message);
    updateSourceStatus(ctx.db, sourceId, { status: "error", errorMessage: message });
    failProcessingJob(ctx.db, jobId, token, { errorMessage: message, transient: !permanent });
  } finally {
    clearInterval(hb);
  }
}

function resolveFileType(fileType: string, fileName: string): string {
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

let stopped = false;

async function main() {
  const dataDir = resolveDataDir();
  const db = openLocalDb(dataDir);
  ctx = { db, store: new LocalStore(db, dataDir), dataDir };
  console.log(`[WORKER] Bereit. Datenverzeichnis: ${ctx.dataDir}. Poll alle ${POLL_MS}ms.`);

  const shutdown = (signal: string) => {
    if (stopped) return;
    stopped = true;
    console.log(`[WORKER] ${signal} empfangen — beende nach laufendem Job.`);
    // In-flight jobs are lease-protected: on the next start they are reclaimed.
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  for (;;) {
    if (stopped) { console.log("[WORKER] Stopp."); process.exit(0); }
    try {
      // uploads first: a user is actively waiting on them
      const processing = claimProcessingJob(ctx.db);
      if (processing) {
        log("PROCESS", processing.id, "CLAIMED", `source ${processing.sourceId}`);
        await runProcessingJob(processing.id, processing.leaseToken!, processing.sourceId);
        continue;
      }

      const job = claimImportJob(ctx.db);
      if (job) {
        log("IMPORT", job._id, "CLAIMED", `${job.provider} ${job.url}`);
        await runImportJob(job);
        continue;
      }
    } catch (err) {
      console.error("[WORKER] loop error:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error("[WORKER] Fatal:", err);
  process.exit(1);
});
