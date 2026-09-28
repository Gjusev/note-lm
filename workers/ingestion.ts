/**
 * Ingestion worker: a Node process separate from Next.js. Claims jobs from
 * Convex, runs identify → inspect → resolve → download → process → store,
 * heartbeats its lease, and fails/retries transiently. Kill it any time —
 * the lease expires and another run picks the job up.
 *
 * Run: npm run worker  (needs CONVEX_URL/NEXT_PUBLIC_CONVEX_URL,
 * INTERNAL_API_KEY, WORKER_KEY; the same WORKER_KEY must be set in Convex env)
 */
import { classifyUrl, providerEnabled } from "../src/lib/ingestion/identify";
import { getAdapter } from "../src/lib/ingestion/registry";
import { downloadPlan, cleanupDownload, DownloadResult } from "../src/lib/ingestion/download";
import { processContent } from "../src/lib/ingestion/process";
import { processHtmlPage } from "../src/lib/ingestion/web";
import { chunkText } from "../src/lib/text-extraction";
import { IdentifiedResource, ImportErrorCode, ImportError, ProviderId } from "../src/lib/ingestion/types";

process.loadEnvFile?.();

const WORKER_KEY = process.env.WORKER_KEY;
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
const INTERNAL_KEY = process.env.INTERNAL_API_KEY;
const POLL_MS = 3000;
const HEARTBEAT_MS = 60_000;

if (!WORKER_KEY || !CONVEX_URL || !INTERNAL_KEY) {
  console.error("[IMPORT-WORKER] WORKER_KEY, CONVEX_URL und INTERNAL_API_KEY müssen gesetzt sein.");
  process.exit(1);
}

function log(jobId: string, step: string, extra?: string) {
  console.log(`[IMPORT][${jobId.slice(0, 8)}] ${step}${extra ? ` — ${extra}` : ""}`);
}

// job shape returned by importJobs:claim
interface JobDoc {
  _id: string;
  ownerId: string;
  notebookId: string;
  url: string;
  provider: string;
  resourceKey: string;
  externalId?: string;
  canonicalUrl?: string;
  leaseToken: string;
}

function resourceFromJob(job: JobDoc): IdentifiedResource {
  return {
    provider: job.provider as ProviderId,
    kind: job.provider === "youtube" ? "video" : job.provider === "direct-file" ? "document" : "page",
    resourceKey: job.resourceKey,
    originalUrl: job.url,
    canonicalUrl: job.canonicalUrl || job.url,
    externalId: job.externalId,
  };
}

async function call<T>(path: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY! },
    body: JSON.stringify({ path, args }),
  });
  return res.json() as Promise<T>;
}

async function runJob(job: JobDoc): Promise<void> {
  const jobId = job._id;
  const token = job.leaseToken;

  // The lease is extended while long phases (download/ffmpeg/transcription) run.
  // Stale or cancelled jobs are fenced at the next phase/complete write.
  const hb = setInterval(() => {
    call<boolean>("importJobs:heartbeat", { jobId, leaseToken: token, workerKey: WORKER_KEY })
      .catch(() => {});
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
      await call("importJobs:updatePhase", {
        jobId, leaseToken: token, workerKey: WORKER_KEY!, phase: "inspecting", ...(meta.title && { title: meta.title }),
      });

      const plan = await adapter.resolve(resource);
      const okPhase = await call<boolean>("importJobs:updatePhase", {
        jobId, leaseToken: token, workerKey: WORKER_KEY!, phase: "downloading",
      });
      if (!okPhase) { log(jobId, "ABORTED", "Lease verloren"); return; }

      download = await downloadPlan(plan);
      log(jobId, "DOWNLOADED", `${download.contentType} ${(download.bytes / 1024).toFixed(0)} KB`);

      // short-link re-dispatch: final URL may belong to a known provider
      const finalClassified = classifyUrl(download.finalUrl);
      if (finalClassified.provider !== resource.provider) {
        log(jobId, "REDISPATCH", `${resource.provider} → ${finalClassified.provider}`);
        await cleanupDownload(download);
        download = null;
        resource = finalClassified;
        if (!providerEnabled(resource.provider)) {
          throw new ImportError("unsupported", `Ziel-Provider '${resource.provider}' ist deaktiviert`);
        }
        continue;
      }

      const okProcessing = await call<boolean>("importJobs:updatePhase", {
        jobId, leaseToken: token, workerKey: WORKER_KEY!, phase: "processing",
      });
      if (!okProcessing) { log(jobId, "ABORTED", "Lease verloren"); return; }

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

      const chunks = chunkText(text).map((content, chunkIndex) => ({ content, chunkIndex }));
      const hostname = (() => { try { return new URL(resource.originalUrl).hostname; } catch { return resource.provider; } })();

      const res = await call<{ ok: boolean; sourceId?: string }>("importJobs:complete", {
        jobId,
        leaseToken: token,
        workerKey: WORKER_KEY!,
        source: {
          fileName: title || hostname,
          fileType: download.contentType,
          fileSize: download.contentType === "text/html" ? text.length : download.bytes,
          url: job.url, // provenance: original URL, never a signed temporary URL
          provider: resource.provider,
          canonicalUrl: resource.canonicalUrl,
          externalId: resource.externalId || resource.resourceKey,
          title: meta.title,
          author: meta.author,
        },
        chunks,
      });
      if (!res?.ok) {
        log(jobId, "COMPLETE REJECTED", "Lease verloren — Ergebnis verworfen");
      } else {
        log(jobId, "DONE", `${chunks.length} Chunks, Quelle ${res.sourceId}`);
      }
      return;
    }
    throw new ImportError("unsupported", "Ziel konnte keinem Provider zugeordnet werden");
  } catch (err) {
    const isImportError = err instanceof ImportError;
    const imp = isImportError
      ? err
      : new ImportError("internal", err instanceof Error ? err.message : String(err), { transient: true });
    log(jobId, "FAILED", `${imp.code}: ${imp.message}`);
    await call("importJobs:fail", {
      jobId,
      leaseToken: token,
      workerKey: WORKER_KEY!,
      errorCode: imp.code satisfies ImportErrorCode,
      errorMessage: imp.message,
      transient: imp.transient,
      ...(imp.retryAfterMs !== undefined && { retryAfterMs: imp.retryAfterMs }),
    }).catch((e) => console.error(`[IMPORT][${jobId.slice(0, 8)}] fail write error:`, e));
  } finally {
    clearInterval(hb);
    if (download) await cleanupDownload(download);
  }
}

async function main() {
  console.log(`[IMPORT-WORKER] Bereit. Poll alle ${POLL_MS}ms.`);
  for (;;) {
    let job: JobDoc | null = null;
    try {
      const res = await fetch(`${CONVEX_URL}/api/mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY! },
        body: JSON.stringify({ path: "importJobs:claim", args: { workerKey: WORKER_KEY } }),
      });
      job = ((await res.json()) as { value: JobDoc | null }).value ?? null;
    } catch (err) {
      console.error("[IMPORT-WORKER] claim error:", err);
    }
    if (job) {
      log(job._id, "CLAIMED", `${job.provider} ${job.url}`);
      await runJob(job);
    } else {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

main().catch((err) => {
  console.error("[IMPORT-WORKER] Fatal:", err);
  process.exit(1);
});
