import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { extractTextFromPDF } from "@/lib/text-extraction";
import { isFfmpegAvailable } from "@/lib/ffmpeg";
import { transcribeAudio } from "@/lib/openai";
import { ImportError } from "./types";

// OpenAI audio upload limit is 25 MB per request.
const DIRECT_TRANSCRIBE_LIMIT = 24 * 1024 * 1024;
const DIRECT_AUDIO_EXTS = ["mp3", "wav", "m4a", "mp4", "webm", "ogg", "flac"];
const SEGMENT_SECONDS = 600;

export interface ProcessResult {
  text: string;
  processedAs: "document" | "audio" | "html";
}

/** Convert any media buffer into ordered MP3 segment files (ffmpeg segment muxer). */
async function toMp3Segments(buffer: Buffer): Promise<string[]> {
  if (!(await isFfmpegAvailable())) {
    throw new ImportError(
      "internal",
      "FFmpeg ist nicht installiert — Audio/Video-Verarbeitung nicht möglich"
    );
  }
  const ffmpeg = (await import("fluent-ffmpeg")).default;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nolm-audio-"));
  const inputPath = path.join(tmpDir, "input.bin");
  await fs.writeFile(inputPath, buffer);

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath);
    const ffmpegPath = process.env.FFMPEG_PATH;
    if (ffmpegPath) cmd.setFfmpegPath(ffmpegPath);

    cmd
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate("96k")
      .audioChannels(1)
      .outputOptions([`-f segment`, `-segment_time ${SEGMENT_SECONDS}`, "-reset_timestamps 1"])
      .output(path.join(tmpDir, "seg%03d.mp3"))
      .on("end", async () => {
        try {
          const files = (await fs.readdir(tmpDir)).filter((f) => f.startsWith("seg") && f.endsWith(".mp3")).sort();
          resolve(files.map((f) => path.join(tmpDir, f)));
        } catch (err) {
          reject(err);
        }
      })
      .on("error", async (err) => {
        await fs.rm(tmpDir, { recursive: true }).catch(() => {});
        reject(new ImportError("internal", `FFmpeg-Fehler: ${err.message}`));
      })
      .run();
  });
}

/** Transcribe media, segmenting when the file exceeds the provider limit. Order is preserved. */
async function transcribeMedia(buffer: Buffer, fileNameHint: string): Promise<string> {
  const ext = fileNameHint.split(".").pop()?.toLowerCase() || "";
  if (buffer.length <= DIRECT_TRANSCRIBE_LIMIT && DIRECT_AUDIO_EXTS.includes(ext)) {
    return transcribeAudio(buffer, fileNameHint);
  }
  const segments = await toMp3Segments(buffer);
  try {
    let text = "";
    for (const seg of segments) {
      const segBuffer = await fs.readFile(seg);
      const part = await transcribeAudio(segBuffer, path.basename(seg));
      text += (text && part ? "\n" : "") + part;
    }
    return text;
  } finally {
    await fs.rm(path.dirname(segments[0]), { recursive: true }).catch(() => {});
  }
}

/** Shared ingestion processing: buffer with verified content type → text. */
export async function processContent(buffer: Buffer, contentType: string, fileNameHint = "download"): Promise<ProcessResult> {
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
    return { text: await transcribeMedia(buffer, fileNameHint), processedAs: "audio" };
  }
  // audio/mp4 & video/mp4 share "mp4"; direct-file hints disambiguate, default to media path
  if (base === "application/octet-stream") {
    throw new ImportError("bad_content", `Inhaltstyp nicht erkannt: ${base}`);
  }
  throw new ImportError("unsupported", `Nicht unterstützter Inhaltstyp: ${base}`);
}
