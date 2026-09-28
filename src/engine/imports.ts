/**
 * In-engine URL import runner (desktop-workers-plan slice 2): the engine
 * absorbs the URL importer — worker and engine share this module, so the
 * standalone worker and the desktop app execute the identical inspect →
 * resolve → download → process → complete pipeline. Ported verbatim from
 * workers/ingestion.ts (runImportJob), plus phase-boundary checkpoints.
 *
 * Checkpoints: before each fenced phase write the runner observes the user
 * intent (job-control). "pause" releases the lease back to queued (the
 * attempt is refunded, the job stays resumable), "cancel" ends the job.
 * A lost lease always wins — a released job discards our result ("lost").
 */
import { classifyUrl, providerEnabled } from "@/lib/ingestion/identify";
import { getAdapter } from "@/lib/ingestion/registry";
import { cleanupDownload, downloadPlan, type DownloadResult } from "@/lib/ingestion/download";
import { processContent } from "@/lib/ingestion/process";
import { processHtmlPage } from "@/lib/ingestion/web";
import { chunkText } from "@/lib/text-extraction";
import { ImportError, type IdentifiedResource, type ImportErrorCode, type ProviderId } from "@/lib/ingestion/types";
import type { LocalContext } from "@/lib/storage/local";
import type { ImportJobDoc } from "@/lib/services/import-jobs";
import {
  completeImportJob,
  failImportJob,
  heartbeatImportJob,
  updateImportJobPhase,
} from "@/lib/services/import-jobs";
import { observeJobIntent } from "@/lib/services/job-control";

const HEARTBEAT_MS = 60_000;

export type ImportJobOutcome = "completed" | "paused" | "cancelled" | "failed" | "lost";

type ImportPhase = "inspecting" | "downloading" | "processing";

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

/** Port of the standalone worker's import pipeline, lease-fenced throughout. */
export async function runImportJob(
  ctx: LocalContext,
  job: ImportJobDoc,
  opts?: { beforePhase?: (phase: ImportPhase) => Promise<void> }
): Promise<ImportJobOutcome> {
  const jobId = job._id;
  const token = job.leaseToken!;
  const log = (step: string, extra?: string) =>
    console.error(`[IMPORT][${jobId.slice(0, 8)}] ${step}${extra ? ` — ${extra}` : ""}`);

  /**
   * Phase-boundary gate (see observeJobIntent): observe a pending user intent
   * and fence the phase write. Checked before and after beforePhase — the
   * hook itself may record an intent (that is how the engine loop pauses/
   * cancels mid-run). Returns null to proceed into the phase.
   */
  const enterPhase = async (phase: ImportPhase): Promise<ImportJobOutcome | null> => {
    const gate = observeJobIntent(ctx.db, "import", jobId, token);
    if (gate !== "run") return gate;
    await opts?.beforePhase?.(phase);
    const gated = observeJobIntent(ctx.db, "import", jobId, token);
    if (gated !== "run") return gated;
    return updateImportJobPhase(ctx.db, jobId, token, phase) ? null : "lost";
  };

  // The lease is extended while long phases (download/extraction) run.
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
      // show the title in the activity center already mid-run (fenced write;
      // a lost lease is handled by the next gate)
      updateImportJobPhase(ctx.db, jobId, token, "inspecting", meta.title);
      const inspectGate = await enterPhase("inspecting");
      if (inspectGate) return inspectGate;

      const plan = await adapter.resolve(resource);
      const downloadGate = await enterPhase("downloading");
      if (downloadGate) return downloadGate;

      download = await downloadPlan(plan);
      log("DOWNLOADED", `${download.contentType} ${(download.bytes / 1024).toFixed(0)} KB`);

      // short-link re-dispatch: final URL may belong to a known provider
      const finalClassified = classifyUrl(download.finalUrl);
      if (finalClassified.provider !== resource.provider) {
        log("REDISPATCH", `${resource.provider} → ${finalClassified.provider}`);
        await cleanupDownload(download);
        download = null;
        resource = finalClassified;
        if (!providerEnabled(resource.provider)) {
          throw new ImportError("unsupported", `Ziel-Provider '${resource.provider}' ist deaktiviert`);
        }
        continue;
      }

      const processGate = await enterPhase("processing");
      if (processGate) return processGate;

      let text: string;
      let title: string | undefined;
      if (download.contentType === "text/html" || download.contentType === "application/xhtml+xml") {
        const page = processHtmlPage(download.buffer.toString("utf-8"), resource.canonicalUrl);
        title = page.title;
        text = page.text;
      } else {
        const result = await processContent(download.buffer, download.contentType, plan.fileNameHint || "download");
        text = result.text;
        title = meta.title || plan.fileNameHint;
      }
      if (!text.trim()) {
        throw new ImportError("bad_content", "Kein Textinhalt extrahierbar");
      }

      // last intent gate before the commit: a cancel/pause clicked during the
      // long processContent phase (transcription) must not commit the source
      const preCommitGate = await enterPhase("processing");
      if (preCommitGate) return preCommitGate;

      const chunks = chunkText(text).map((content, chunkIndex) => ({ content, chunkIndex }));
      const hostname = (() => { try { return new URL(resource.originalUrl).hostname; } catch { return resource.provider; } })();
      const fileName = title || hostname;

      // original bytes are persisted so re-processing never needs the network
      let storageId: string | undefined;
      try {
        const file = await ctx.store.save(download.buffer, { fileName, contentType: download.contentType });
        storageId = file.id;
      } catch (err) {
        console.error("[IMPORT] original not persisted:", err); // chunks + provenance still complete
      }

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
        log("COMPLETE REJECTED", "Lease verloren — Ergebnis verworfen");
        // our original bytes are not referenced by anyone anymore
        if (storageId) await ctx.store.delete(storageId);
        return "lost";
      }
      for (const staleId of res.staleFileIds ?? []) {
        await ctx.store.delete(staleId);
      }
      log("DONE", `${chunks.length} Chunks, Quelle ${res.sourceId}`);
      return "completed";
    }
    throw new ImportError("unsupported", "Ziel konnte keinem Provider zugeordnet werden");
  } catch (err) {
    const imp = err instanceof ImportError
      ? err
      : new ImportError("internal", err instanceof Error ? err.message : String(err), { transient: true });
    log("FAILED", `${imp.code}: ${imp.message}`);
    // failed vs lost: only report "failed" when the failure was actually
    // recorded; a lost lease has no terminal event (the new claimant owns it)
    const ok = failImportJob(ctx.db, jobId, token, {
      errorCode: imp.code satisfies ImportErrorCode,
      errorMessage: imp.message,
      transient: imp.transient,
      ...(imp.retryAfterMs !== undefined && { retryAfterMs: imp.retryAfterMs }),
    });
    return ok ? "failed" : "lost";
  } finally {
    clearInterval(hb);
    if (download) await cleanupDownload(download);
  }
}
