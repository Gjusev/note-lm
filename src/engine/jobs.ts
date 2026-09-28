/**
 * In-engine job loop: consumes processing_jobs (manual uploads: PDF/text/
 * audio extraction). URL import_jobs stay in the standalone worker for the
 * browser app — the engine will absorb them when the desktop UI grows the
 * URL import surface (see issue #10).
 */
import { claimProcessingJob } from "@/lib/services/processing-jobs";
import type { LocalContext } from "@/lib/storage/local";
import { runProcessingJob } from "./processing";
import { generateMaterial, type MaterialType } from "@/lib/services/materials";
import { resolveCapabilities, stopLlamaHelpers } from "./capabilities";
import { getJobIntent, emitJobEvent } from "@/lib/services/job-control";

const materialQueue: Array<{ materialId: string; notebookId: string; type: MaterialType }> = [];

/** Queue a material generation; executed between processing jobs. */
export function enqueueMaterialGeneration(
  materialId: string,
  notebookId: string,
  type: MaterialType
): void {
  materialQueue.push({ materialId, notebookId, type });
}

async function runMaterialGeneration(ctx: LocalContext): Promise<void> {
  const job = materialQueue.shift();
  if (!job) return;
  console.log(`[MATERIAL][${job.materialId.slice(0, 8)}] GENERATE ${job.type}`);
  try {
    const caps = await resolveCapabilities();
    const tts = caps.chatProvider === "local" && caps.embed
      ? null // local TTS not wired yet (phase 6); podcasts get text only
      : null;
    const outcome = await generateMaterial(ctx.db, ctx.store, {
      materialId: job.materialId,
      notebookId: job.notebookId,
      type: job.type,
      chat: caps.chat,
      tts,
    });
    if (!outcome.ok) {
      console.error(`[MATERIAL] generation failed: ${outcome.error}`);
    }
  } catch (err) {
    console.error("[MATERIAL] generation error:", err);
  }
}

export function startProcessingLoop(ctx: LocalContext, pollMs = 3000): () => void {
  let stopped = false;
  let spinning = false;

  const tick = async () => {
    if (stopped || spinning) return;
    spinning = true;
    try {
      const job = claimProcessingJob(ctx.db);
      if (job) {
        const intent = getJobIntent(ctx.db, "processing", job.id);
        if (intent === "pause" || intent === "cancel") {
          // user intent gates execution: release the lease, skip this round.
          // cancel additionally completes the source as cancelled-work state.
          if (intent === "cancel") {
            const { failProcessingJob } = await import("@/lib/services/processing-jobs");
            failProcessingJob(ctx.db, job.id, job.leaseToken!, {
              errorMessage: "Vom Benutzer abgebrochen", transient: false,
            });
            emitJobEvent(ctx.db, "processing", job.id, "cancelled");
          } else {
            emitJobEvent(ctx.db, "processing", job.id, "paused");
          }
        } else {
          console.log(`[PROCESS][${job.id.slice(0, 8)}] CLAIMED source ${job.sourceId}`);
          emitJobEvent(ctx.db, "processing", job.id, "running");
          await runProcessingJob(ctx, job.id, job.leaseToken!, job.sourceId);
          emitJobEvent(ctx.db, "processing", job.id, "finished");
        }
      } else if (materialQueue.length > 0) {
        const next = materialQueue[0];
        const intent = getJobIntent(ctx.db, "material", next.materialId);
        if (intent === "pause" || intent === "cancel") {
          materialQueue.shift(); // drop from the in-memory queue; the row stays
          if (intent === "cancel") {
            const { updateMaterial } = await import("@/lib/services/learning-materials");
            await updateMaterial(ctx.db, next.materialId, { status: "error", errorMessage: "Abgebrochen" });
            emitJobEvent(ctx.db, "material", next.materialId, "cancelled");
          } else {
            emitJobEvent(ctx.db, "material", next.materialId, "paused");
          }
        } else {
          await runMaterialGeneration(ctx);
        }
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
