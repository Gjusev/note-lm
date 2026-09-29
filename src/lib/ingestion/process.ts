import { promises as fs } from "fs";
import path from "path";
import { extractTextFromPDF } from "@/lib/text-extraction";
import type { TranscribeFn } from "@/lib/ai/providers";
import { mp3SegmentDurationsSec, toMp3Segments } from "./segments";
import { ImportError } from "./types";

// OpenAI audio upload limit is 25 MB per request.
const DIRECT_TRANSCRIBE_LIMIT = 24 * 1024 * 1024;
const DIRECT_AUDIO_EXTS = ["mp3", "wav", "m4a", "mp4", "webm", "ogg", "flac"];

export interface ProcessResult {
  text: string;
  processedAs: "document" | "audio" | "html";
  /** Per-segment timing (strategy 5A) for media: real times from the muxed
   * segments (long files) OR from the provider's own JSON (direct single
   * call, e.g. local whisper -oj); undefined when no time information is
   * knowable (documents, a provider reporting no times). chunkIndex ==
   * segment index downstream. */
  segments?: MediaSegment[];
}

/** One transcript segment with its REAL time range in the media file.
 * startSec of segment i is the sum of the previous segments' durations. */
export interface MediaSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface MediaTranscription {
  text: string;
  /** Empty when no per-segment times are knowable (a provider that reports
   * no times, e.g. remote APIs): no times are invented. */
  segments: MediaSegment[];
}

/**
 * Transcribe media with the caller-INJECTED transcriber (S3: the runner
 * resolves the provider from explicit config; this module never imports one).
 * Segments when the file exceeds the provider limit. The DIRECT path (single
 * call, <= limit) threads the provider's OWN temporal segments when it
 * reports them (local whisper -oj) — so both paths preserve whisper's real
 * times. Order is preserved.
 */
export async function transcribeMedia(
  buffer: Buffer,
  fileNameHint: string,
  transcribe: TranscribeFn,
  media?: MediaTranscribeOptions
): Promise<MediaTranscription> {
  const ext = fileNameHint.split(".").pop()?.toLowerCase() || "";
  if (buffer.length <= DIRECT_TRANSCRIBE_LIMIT && DIRECT_AUDIO_EXTS.includes(ext)) {
    const out = await transcribe(buffer, fileNameHint);
    // provider-reported times only (whisper's own offsets); empty-text
    // segments are dropped, no times are invented
    const segments = (out.segments ?? []).filter((s) => s.text.trim() !== "");
    return { text: out.text, segments };
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
    // strategy 5A: real per-segment seconds from the muxed CBR bytes -
    // startSec accumulates the true durations; no times are invented
    const durations = mp3SegmentDurationsSec(segments);
    let startSec = 0;
    const segmentsOut = segments.map((file, i) => {
      const seg = { startSec, endSec: startSec + durations[i], text: texts[i] ?? "" };
      startSec = seg.endSec;
      return seg;
    });
    return { text: texts.filter((t): t is string => !!t).join("\n"), segments: segmentsOut };
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
    const transcription = await transcribeMedia(buffer, fileNameHint, transcribe, media);
    return {
      text: transcription.text,
      processedAs: "audio",
      ...(transcription.segments.length > 0 && { segments: transcription.segments }),
    };
  }
  // audio/mp4 & video/mp4 share "mp4"; direct-file hints disambiguate, default to media path
  if (base === "application/octet-stream") {
    throw new ImportError("bad_content", `Inhaltstyp nicht erkannt: ${base}`);
  }
  throw new ImportError("unsupported", `Nicht unterstützter Inhaltstyp: ${base}`);
}
