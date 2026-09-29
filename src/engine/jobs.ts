/**
 * In-engine job pool (desktop-workers-plan slice 3d): the scheduler runs four
 * lanes with caps over three queues - uploads (processing_jobs, cap 2), URL
 * imports (import_jobs, cap 1), materials (in-memory FIFO, cap 1) - plus a
 * background embedding-index sweep (cap 1).
 *
 * Priority = claim order within each tick: upload -> import -> material ->
 * index. The index lane only starts when a full tick found no claimable
 * upload/import/material work AND no upload is mid-run: mass indexing must
 * never delay a user-waiting job. It re-checks every tick, so it catches up
 * the moment the lanes drain.
 *
 * Shared ffmpeg/transcription slot: at most ONE extraction/transcription
 * across the upload and import lanes at a time. Media uploads are excluded
 * from the claim while the slot is taken (claimProcessingJob excludeMedia);
 * media imports (kind video/audio) occupy the slot for their whole run.
 * ponytail: file_type-prefix + kind heuristics - a media file uploaded with a
 * generic octet-stream MIME slips the claim filter and is caught by the loop's
 * resolveFileType check after the claim instead.
 *
 * Global pause: the `scheduler.paused` settings row (default off) stops all
 * claims while the timer keeps running; being a settings row it survives
 * engine restarts. The import worker was absorbed in slice 2, see issue #10.
 */
import { claimProcessingJob, failProcessingJob } from "@/lib/services/processing-jobs";
import { claimImportJob, releaseImportJob } from "@/lib/services/import-jobs";
import { rawClient, type LocalDb } from "@/db/local";
import type { LocalContext } from "@/lib/storage/local";
import { getSetting } from "@/lib/services/settings";
import { getEmbeddingProfile } from "@/lib/services/embedding-profiles";
import { indexNotebookChunks } from "@/lib/services/vector-index";
import { runProcessingJob, resolveFileType, type ProcessingStage } from "./processing";
import { runImportJob } from "./imports";
import { generateMaterial, type MaterialType } from "@/lib/services/materials";
import { resolveCapabilities } from "./capabilities";
import { getJobIntent, emitJobEvent } from "@/lib/services/job-control";

/** Lane caps (desktop-workers-plan slice 3d). */
const UPLOAD_CAP = 2;
const IMPORT_CAP = 1;
const MATERIAL_CAP = 1;
const INDEX_CAP = 1;
/** One ffmpeg extraction/transcription across the upload+import lanes. */
const MEDIA_CAP = 1;
/** Index sweep budget: batch per notebook and max wall time per sweep. */
const INDEX_BATCH = 16;
const INDEX_SWEEP_MS = 3000;

/** Global scheduler pause - a settings row, default off (no row = running). */
const SCHEDULER_PAUSED_KEY = "scheduler.paused";

/** Test seams for the upload lane (slice 3d): inject runProcessingJob opts
 *  (the beforeStage stage gate) or replace the upload runner entirely. */
export interface ProcessingLoopHooks {
  processingOpts?: (
    jobId: string
  ) => { beforeStage?: (stage: ProcessingStage) => Promise<void> } | undefined;
  processingRunner?: (
    ctx: LocalContext,
    job: { id: string; leaseToken: string | null; sourceId: string }
  ) => Promise<unknown>;
}

const materialQueue: Array<{ materialId: string; notebookId: string; type: MaterialType }> = [];

/**
 * Lane counters are module-level on purpose (mirrors the slice 2 import lane):
 * stop() leaves in-flight work running - the leases protect it - and a NEW
 * loop instance must see the occupied lanes instead of double-claiming.
 */
let uploadRunning = 0;
let mediaRunning = 0;
let importRunning = 0;
let materialRunning = 0;
let indexRunning = 0;

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
    if (!caps.chat) {
      console.error("[MATERIAL] generation skipped: no chat capability configured");
      return;
    }
    const tts = caps.chatProviderKind === "local" && caps.embed
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

/** Media lookalike for the shared ffmpeg/transcription slot (resolveFileType
 *  approximation, extension fallback included). */
function isMediaSource(db: LocalDb, sourceId: string): boolean {
  const s = rawClient(db)
    .prepare(`SELECT file_type AS fileType, file_name AS fileName FROM sources WHERE id = ?`)
    .get(sourceId) as { fileType: string; fileName: string } | undefined;
  if (!s) return false;
  const t = resolveFileType(s.fileType, s.fileName);
  return t.startsWith("audio/") || t.startsWith("video/");
}

/** Notebooks with chunks that still lack an indexed embedding for a profile,
 *  ordered by their oldest unindexed chunk (mass indexing order). */
function sweepTargets(db: LocalDb, profileId: string): string[] {
  const rows = rawClient(db)
    .prepare(
      `SELECT c.notebook_id AS notebookId FROM chunks c
       WHERE NOT EXISTS (
         SELECT 1 FROM chunk_embeddings ce
         WHERE ce.chunk_id = c.id AND ce.profile_id = ? AND ce.status = 'indexed'
       )
       GROUP BY c.notebook_id
       ORDER BY MIN(c.created_at) ASC`
    )
    .all(profileId) as Array<{ notebookId: string }>;
  return rows.map((r) => r.notebookId);
}

/** The index lane body: batches through the sweep targets until the wall-time
 *  budget is spent; leftovers are picked up by the next sweep (resumable). */
async function runIndexSweep(ctx: LocalContext, profileId: string): Promise<void> {
  const profile = await getEmbeddingProfile(ctx.db, profileId);
  if (!profile) return;
  const caps = await resolveCapabilities();
  if (!caps.embed) return; // no embedder configured -> textual only
  const t0 = Date.now();
  for (const notebookId of sweepTargets(ctx.db, profile._id)) {
    try {
      const run = await indexNotebookChunks(ctx.db, {
        profileId: profile._id,
        dimension: profile.dimension,
        notebookId,
        batchSize: INDEX_BATCH,
        embed: caps.embed,
      });
      if (run.indexed > 0) {
        console.log(`[INDEX][${notebookId.slice(0, 8)}] +${run.indexed} Chunks (Profil ${profile._id.slice(0, 8)})`);
      }
    } catch (err) {
      console.error(`[INDEX] sweep failed for notebook ${notebookId.slice(0, 8)}:`,
        err instanceof Error ? err.message : err);
    }
    if (Date.now() - t0 > INDEX_SWEEP_MS) break;
  }
}

export function startProcessingLoop(
  ctx: LocalContext,
  pollMs = 3000,
  hooks?: ProcessingLoopHooks
): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      // global pause: the tick stays scheduled but claims nothing
      if (await getSetting<boolean>(ctx.db, SCHEDULER_PAUSED_KEY)) return;

      let foundWork = false;

      // upload lane (cap 2): the shared ffmpeg/transcription slot excludes
      // media uploads from the claim while the slot is taken
      while (uploadRunning < UPLOAD_CAP) {
        const job = claimProcessingJob(ctx.db, { excludeMedia: mediaRunning >= MEDIA_CAP });
        if (!job) break;
        foundWork = true;
        const media = isMediaSource(ctx.db, job.sourceId);
        if (media) mediaRunning += 1;
        uploadRunning += 1;
        void (async () => {
          const intent = getJobIntent(ctx.db, "processing", job.id);
          if (intent === "pause" || intent === "cancel") {
            // belt-and-braces: the claim SQL already filters paused/cancelled
            // rows; cancel additionally completes the source as cancelled-work
            if (intent === "cancel") {
              failProcessingJob(ctx.db, job.id, job.leaseToken!, {
                errorMessage: "Vom Benutzer abgebrochen", transient: false,
              });
              emitJobEvent(ctx.db, "processing", job.id, "cancelled");
            } else {
              emitJobEvent(ctx.db, "processing", job.id, "paused");
            }
            return;
          }
          console.log(`[PROCESS][${job.id.slice(0, 8)}] CLAIMED source ${job.sourceId}`);
          emitJobEvent(ctx.db, "processing", job.id, "running");
          if (hooks?.processingRunner) {
            await hooks.processingRunner(ctx, job);
          } else {
            await runProcessingJob(ctx, job.id, job.leaseToken!, job.sourceId,
              hooks?.processingOpts?.(job.id));
          }
          emitJobEvent(ctx.db, "processing", job.id, "finished");
        })()
          .catch((err) =>
            console.error(`[PROCESS][${job.id.slice(0, 8)}] lane error:`, err)
          )
          .finally(() => {
            uploadRunning -= 1;
            if (media) mediaRunning -= 1;
          });
      }

      // import lane (cap 1): unchanged slice 2 semantics, now a detached lane
      if (importRunning < IMPORT_CAP) {
        const importJob = claimImportJob(ctx.db);
        if (importJob) {
          foundWork = true;
          const intent = getJobIntent(ctx.db, "import", importJob._id);
          if (intent === "pause" || intent === "cancel") {
            // F1 filters paused/cancelled intents in the claim SQL already;
            // this is belt-and-braces and only confirms a fenced release.
            const released = releaseImportJob(
              ctx.db,
              importJob._id,
              importJob.leaseToken!,
              intent === "cancel" ? "cancelled" : "queued"
            );
            if (released) {
              emitJobEvent(ctx.db, "import", importJob._id, intent === "cancel" ? "cancelled" : "paused");
            }
          } else {
            console.log(`[IMPORT][${importJob._id.slice(0, 8)}] CLAIMED ${importJob.provider} ${importJob.url}`);
            emitJobEvent(ctx.db, "import", importJob._id, "running");
            importRunning += 1;
            const media = /video|audio/.test(importJob.kind ?? "");
            if (media) mediaRunning += 1;
            void runImportJob(ctx, importJob)
              .then((outcome) => {
                if (outcome === "completed") {
                  emitJobEvent(ctx.db, "import", importJob._id, "finished");
                } else if (outcome === "failed") {
                  emitJobEvent(ctx.db, "import", importJob._id, "failed");
                }
              })
              // lanes are detached: a late continuation (e.g. its durable-event
              // write racing a host-initiated close) or a genuine runner failure
              // must not surface as an unhandled rejection — in Node that kills
              // the whole engine process. Mirrors the upload lane's catch.
              .catch((err) =>
                console.error(`[IMPORT][${importJob._id.slice(0, 8)}] lane error:`, err)
              )
              .finally(() => {
                importRunning -= 1;
                if (media) mediaRunning -= 1;
              });
          }
        }
      }

      // material lane (cap 1): the in-memory FIFO, one at a time
      if (materialRunning < MATERIAL_CAP && materialQueue.length > 0) {
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
          materialRunning += 1;
          foundWork = true;
          void runMaterialGeneration(ctx).finally(() => {
            materialRunning -= 1;
          });
        }
      }

      // index lane: only when this full tick found nothing claimable in the
      // user-waiting lanes AND no upload is mid-run (see header comment)
      if (!foundWork && uploadRunning === 0 && indexRunning < INDEX_CAP) {
        const profileId = await getSetting<string>(ctx.db, "retrieval.activeProfile");
        if (profileId) {
          const targets = sweepTargets(ctx.db, profileId);
          if (targets.length > 0) {
            indexRunning += 1;
            void runIndexSweep(ctx, profileId)
              .catch((err) => console.error("[INDEX] sweep error:", err))
              .finally(() => {
                indexRunning -= 1;
              });
          }
        }
      }
    } catch (err) {
      console.error("[ENGINE] processing loop error:", err);
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), pollMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
