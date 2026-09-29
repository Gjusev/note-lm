import { promises as fs } from "fs";
import path from "path";
import { extractTextFromPDF } from "@/lib/text-extraction";
import type { TranscribeFn } from "@/lib/ai/providers";
import { toMp3Segments } from "./segments";
import { ImportError } from "./types";

// OpenAI audio upload limit is 25 MB per request.
const DIRECT_TRANSCRIBE_LIMIT = 24 * 1024 * 1024;
const DIRECT_AUDIO_EXTS = ["mp3", "wav", "m4a", "mp4", "webm", "ogg", "flac"];

export interface ProcessResult {
  text: string;
  processedAs: "document" | "audio" | "html";
}

/**
 * Transcribe media with the caller-INJECTED transcriber (S3: the runner
 * resolves the provider from explicit config; this module never imports one).
 * Segments when the file exceeds the provider limit. Order is preserved.
 */
export async function transcribeMedia(
  buffer: Buffer,
  fileNameHint: string,
  transcribe: TranscribeFn,
  media?: MediaTranscribeOptions
): Promise<string> {
  const ext = fileNameHint.split(".").pop()?.toLowerCase() || "";
  if (buffer.length <= DIRECT_TRANSCRIBE_LIMIT && DIRECT_AUDIO_EXTS.includes(ext)) {
    return (await transcribe(buffer, fileNameHint)).text;
  }
  // Without a caller-owned segDir the mux dir is private and removed with the
  // transcription; the engine passes <dataDir>/tmp/jobs/<jobId> so segments
  // survive pause/transient failure and the mux may simply re-run on resume.
  const ownedDir = !media?.segDir;
  const segments = await toMp3Segments(buffer, media?.segDir);
  try {
    // # ponytail: confirmed per-segment texts ride inside the checkpoint
    // cursor — ~60 segments × a few KB for a 10 h recording. Move them to a
    // per-segment file artifact if cursors ever grow unwieldy.
    const texts: (string | undefined)[] = new Array(segments.length);
    let from = 0;
    if (
      media?.resumeFrom &&
      media.resumeFrom > 0 &&
      media.resumeFrom <= segments.length &&
      media.confirmedTexts?.length === media.resumeFrom
    ) {
      from = media.resumeFrom;
      media.confirmedTexts.forEach((t, i) => {
        texts[i] = t;
      });
    }
    for (let i = from; i < segments.length; i++) {
      if (media?.shouldStop?.()) break; // stop BEFORE the next segment; confirmed work is already checkpointed
      const segBuffer = await fs.readFile(segments[i]);
      const part = await transcribe(segBuffer, path.basename(segments[i]));
      texts[i] = part.text;
      media?.onSegmentDone?.(i + 1, segments.length, texts.filter((t): t is string => !!t));
    }
    return texts.filter((t): t is string => !!t).join("\n");
  } finally {
    if (ownedDir) await fs.rm(path.dirname(segments[0]), { recursive: true }).catch(() => {});
  }
}

/**
 * Resumable media transcription (slice 3c): segment-level hooks for the
 * lease-fenced runners. All fields optional — without them the transcription
 * behaves exactly as before (single-shot, self-cleaning).
 */
export interface MediaTranscribeOptions {
  /** Segment output dir. Without it a private os.tmpdir dir is used and removed afterwards. */
  segDir?: string;
  /** First segment still to transcribe; earlier texts come from confirmedTexts. */
  resumeFrom?: number;
  /** Confirmed transcripts of segments [0, resumeFrom) — from the checkpoint cursor. */
  confirmedTexts?: string[];
  /** Fires after segment `done` of `total` confirmed, with all confirmed texts so far. */
  onSegmentDone?: (done: number, total: number, texts: string[]) => void;
  /** Checked before each segment; true stops before it — the runner then decides pause/cancel per observed intent. */
  shouldStop?: () => boolean;
}

/** Shared ingestion processing: buffer with verified content type → text.
 *  The transcriber is injected (S3); without one the audio path fails typed. */
export async function processContent(
  buffer: Buffer,
  contentType: string,
  fileNameHint = "download",
  media?: MediaTranscribeOptions,
  transcribe?: TranscribeFn
): Promise<ProcessResult> {
  const base = contentType.split(";")[0].trim().toLowerCase();

  if (base === "text/html" || base === "application/xhtml+xml") {
    throw new ImportError("bad_content", "HTML-Inhalt gehört zur Seitenverarbeitung, nicht zur Dateiverarbeitung");
  }
  if (base === "application/pdf") {
    return { text: await extractTextFromPDF(buffer), processedAs: "document" };
  }
  if (base.startsWith("text/")) {
    return { text: buffer.toString("utf-8"), processedAs: "document" };
  }
  if (base.startsWith("audio/") || base.startsWith("video/")) {
    if (!transcribe) {
      throw new ImportError("bad_content", "Kein KI-Anbieter für die Transkription konfiguriert. Wähle in den Einstellungen einen Transkriptionsanbieter.");
    }
    return { text: await transcribeMedia(buffer, fileNameHint, transcribe, media), processedAs: "audio" };
  }
  // audio/mp4 & video/mp4 share "mp4"; direct-file hints disambiguate, default to media path
  if (base === "application/octet-stream") {
    throw new ImportError("bad_content", `Inhaltstyp nicht erkannt: ${base}`);
  }
  throw new ImportError("unsupported", `Nicht unterstützter Inhaltstyp: ${base}`);
}
