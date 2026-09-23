import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

let ffmpegAvailable: boolean | null = null;

async function checkFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
  try {
    await execFileAsync(ffmpegPath, ["-version"], { timeout: 5000 });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
    console.warn(`[FFMPEG] Not found at "${ffmpegPath}". Video processing will fail.`);
  }
  return ffmpegAvailable;
}

export async function isFfmpegAvailable(): Promise<boolean> {
  return checkFfmpeg();
}

export async function extractAudioFromVideo(videoBuffer: Buffer): Promise<Buffer> {
  const available = await checkFfmpeg();
  if (!available) {
    throw new Error(
      "FFmpeg ist nicht installiert. Video-Verarbeitung wird nicht unterstützt. " +
      "Setze FFMPEG_PATH oder installiere FFmpeg auf dem Server."
    );
  }

  const ffmpeg = (await import("fluent-ffmpeg")).default;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ki-research-"));
  const inputPath = path.join(tmpDir, "input");
  const outputPath = path.join(tmpDir, "output.mp3");

  await fs.writeFile(inputPath, videoBuffer);

  const ffmpegPath = process.env.FFMPEG_PATH || undefined;

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath);
    if (ffmpegPath) cmd.setFfmpegPath(ffmpegPath);

    cmd
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .output(outputPath)
      .on("end", async () => {
        try {
          const audioBuffer = await fs.readFile(outputPath);
          await fs.rm(tmpDir, { recursive: true });
          resolve(audioBuffer);
        } catch (err) {
          reject(err);
        }
      })
      .on("error", async (err) => {
        await fs.rm(tmpDir, { recursive: true }).catch(() => {});
        reject(err);
      })
      .run();
  });
}
