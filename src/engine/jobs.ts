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
        console.log(`[PROCESS][${job.id.slice(0, 8)}] CLAIMED source ${job.sourceId}`);
        await runProcessingJob(ctx, job.id, job.leaseToken!, job.sourceId);
      } else if (materialQueue.length > 0) {
        await runMaterialGeneration(ctx);
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
