/**
 * In-engine job loop: consumes processing_jobs (manual uploads: PDF/text/
 * audio extraction). URL import_jobs stay in the standalone worker for the
 * browser app — the engine will absorb them when the desktop UI grows the
 * URL import surface (see issue #10).
 */
import { claimProcessingJob } from "@/lib/services/processing-jobs";
import type { LocalContext } from "@/lib/storage/local";
import { runProcessingJob } from "./processing";

export function startProcessingLoop(ctx: LocalContext, pollMs = 3000): () => void {
  let stopped = false;
  let spinning = false;

  const tick = async () => {
    if (stopped || spinning) return;
    spinning = true;
    try {
      const job = claimProcessingJob(ctx.db);
      if (job) {
        console.log(`[PROCESS][${job.id.slice(0, 8)}] CLAIMED source ${job.sourceId}`);
        await runProcessingJob(ctx, job.id, job.leaseToken!, job.sourceId);
      }
    } catch (err) {
      console.error("[ENGINE] processing loop error:", err);
    } finally {
      spinning = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), pollMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
