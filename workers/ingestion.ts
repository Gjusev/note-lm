/**
 * Local ingestion worker: a Node process separate from Next.js, sharing the
 * SQLite database in the data dir. The engine now consumes both queues
 * in-process (src/engine/jobs.ts); this CLI remains only as the browser-dev
 * fallback and delegates to the same runner modules.
 *
 * Consumes two queues:
 *  1. processing_jobs — manual uploads: extract/transcribe → chunk → complete
 *  2. import_jobs     — URL imports (delegates to src/engine/imports)
 *
 * Kill it any time — leases expire and the next run picks the job up. No
 * credentials needed to start; AI paths (transcription) only run when a key
 * is configured.
 *
 * Run: npm run worker   (env: NOTELM_DATA_DIR optional, INGEST_* optional)
 */
import { openLocalDb, resolveDataDir } from "../src/db/local";
import { LocalStore } from "../src/lib/storage/local";
import type { LocalContext } from "../src/lib/storage/local";
import { runProcessingJob } from "../src/engine/processing";
import { runImportJob } from "../src/engine/imports";
import { claimImportJob } from "../src/lib/services/import-jobs";
import { claimProcessingJob } from "../src/lib/services/processing-jobs";
import { reconcileStartupArtifacts } from "../src/lib/services/job-control";

try {
  process.loadEnvFile?.();
} catch {
  /* no .env file — env comes from the process environment */
}

const POLL_MS = parseInt(process.env.INGEST_POLL_MS || "3000");

let ctx: LocalContext;

function log(scope: string, id: string, step: string, extra?: string) {
  console.log(`[${scope}][${id.slice(0, 8)}] ${step}${extra ? ` — ${extra}` : ""}`);
}

let stopped = false;

async function main() {
  const dataDir = resolveDataDir();
  const db = openLocalDb(dataDir);
  ctx = { db, store: new LocalStore(db, dataDir), dataDir };
  // slice 3b: same single reconcile pass as the engine (orphan partials out,
  // live partials survive)
  reconcileStartupArtifacts(ctx.db, ctx.dataDir);
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
        await runProcessingJob(ctx, processing.id, processing.leaseToken!, processing.sourceId);
        continue;
      }

      const job = claimImportJob(ctx.db);
      if (job) {
        log("IMPORT", job._id, "CLAIMED", `${job.provider} ${job.url}`);
        const outcome = await runImportJob(ctx, job);
        log("IMPORT", job._id, outcome.toUpperCase());
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
