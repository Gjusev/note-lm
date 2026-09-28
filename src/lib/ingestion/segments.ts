/**
 * FFmpeg segment muxer (desktop-workers-plan slice 3c): converts a media
 * buffer into ordered MP3 segment files. Extracted from process.ts so the
 * engine can place segments in the job's resume dir and tests can fake the
 * seam the same way they fake the transcriber.
 */
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { isFfmpegAvailable } from "@/lib/ffmpeg";
import { ImportError } from "./types";

const SEGMENT_SECONDS = 600;

/** Convert any media buffer into ordered MP3 segment files (ffmpeg segment muxer). */
export async function toMp3Segments(buffer: Buffer, outDir?: string): Promise<string[]> {
  if (!(await isFfmpegAvailable())) {
    throw new ImportError(
      "internal",
      "FFmpeg ist nicht installiert — Audio/Video-Verarbeitung nicht möglich"
    );
  }
  const ffmpeg = (await import("fluent-ffmpeg")).default;
  const tmpDir = outDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "nolm-audio-")));
  await fs.mkdir(tmpDir, { recursive: true });
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
        if (!outDir) await fs.rm(tmpDir, { recursive: true }).catch(() => {});
        reject(new ImportError("internal", `FFmpeg-Fehler: ${err.message}`));
      })
      .run();
  });
}
