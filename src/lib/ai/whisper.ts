/**
 * Local whisper.cpp transcription (managed runtime, delivery increment 1):
 * runWhisper spawns whisper-cli.exe (dir resolution mirrors the llama
 * runtime) over a 16 kHz mono wav and reads the `-oj` JSON (v1.9.2 shape:
 * transcription[].offsets in MILLISECONDS - probed against the real binary).
 * Teardown kills the whole process tree (taskkill /T /F), same contract as
 * llama-supervisor.
 *
 * makeLocalTranscribe is the TranscribeFn factory used by
 * engine/capabilities.ts for the "whisper-local" preset. It is NEVER gated by
 * offline mode (local calls are never blocked) and never falls back remote;
 * one honest provider_runs row per transcription.
 */
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { LocalDb } from "@/db/local";
import type { TranscribeFn } from "@/lib/ai/providers";
import { recordProviderRun } from "@/lib/services/provider-runs";
import { stopTree } from "@/lib/ai/llama-supervisor";

const execFileAsync = promisify(execFile);

/** Default wall clock per transcription (whisper tiny on CPU: ~realtime). */
const DEFAULT_TIMEOUT_MS = 300_000;

/** One transcript segment (whisper.cpp offsets are milliseconds). */
export interface WhisperSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface WhisperResult {
  text: string;
  segments: WhisperSegment[];
  /** Detected language when whisper reported one (null otherwise). */
  language: string | null;
}

/** Parse the whisper.cpp `-oj` JSON into our normalized shape. */
export function parseWhisperJson(raw: string): WhisperResult {
  const data = JSON.parse(raw) as {
    transcription?: Array<{ offsets?: { from?: number; to?: number }; text?: string }>;
    result?: { language?: string };
  };
  const segments: WhisperSegment[] = (data.transcription ?? []).map((s) => ({
    startSec: (s.offsets?.from ?? 0) / 1000,
    endSec: (s.offsets?.to ?? 0) / 1000,
    text: (s.text ?? "").trim(),
  }));
  const text = segments.map((s) => s.text).filter(Boolean).join("\n");
  return { text, segments, language: data.result?.language ?? null };
}

/**
 * Spawn the pinned whisper-cli.exe over a wav. Resolves with the parsed
 * transcription; rejects on non-zero exit, missing JSON output, timeout or
 * abort. cwd is the whisper dir so the ggml DLLs resolve (llama pattern).
 */
export async function runWhisper(opts: {
  whisperDir: string;
  modelPath: string;
  wavPath: string;
  /** ISO code or "auto" (default), passed as -l to whisper-cli. */
  language?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<WhisperResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const jsonBase = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "nolm-whisper-")),
    "out"
  );
  const jsonPath = `${jsonBase}.json`;
  const child = spawn(
    path.join(opts.whisperDir, "whisper-cli.exe"),
    [
      "-m", opts.modelPath,
      "-f", opts.wavPath,
      "-oj", "-of", jsonBase,
      "-l", opts.language ?? "auto",
    ],
    { cwd: opts.whisperDir, stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
  );
  let stderr = "";
  child.stderr?.on("data", (c: Buffer) => {
    stderr += c.toString();
    if (stderr.length > 400) stderr = stderr.slice(-400);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        stopTree(child);
        reject(new Error(`whisper timeout after ${timeoutMs} ms`));
      }, timeoutMs);
      const onAbort = () => {
        stopTree(child);
        reject(new Error("whisper abgebrochen (abort signal)"));
      };
      if (opts.signal?.aborted) {
        clearTimeout(deadline);
        return reject(new Error("whisper abgebrochen (abort signal)"));
      }
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      child.on("error", (err) => {
        clearTimeout(deadline);
        reject(err);
      });
      child.on("exit", (code) => {
        clearTimeout(deadline);
        opts.signal?.removeEventListener("abort", onAbort);
        if (code !== 0) {
          reject(new Error(`whisper-cli failed (${code}): ${stderr.trim().slice(-400) || "no stderr"}`));
        } else if (!fs.existsSync(jsonPath)) {
          reject(new Error("whisper-cli produced no JSON output (-oj wrote nothing) " + stderr.trim().slice(-200)));
        } else {
          resolve();
        }
      });
    });
    return parseWhisperJson(fs.readFileSync(jsonPath, "utf8"));
  } finally {
    fs.rmSync(path.dirname(jsonPath), { recursive: true, force: true });
  }
}

/**
 * Re-encode any audio buffer into a 16 kHz mono wav via the pinned ffmpeg
 * (path from FFMPEG_PATH, mirroring src/lib/ffmpeg.ts). Returns the wav path
 * plus the temp dir owning it - the CALLER removes the dir.
 */
export async function toWav16kMono(
  audio: Buffer,
  extHint: string,
  ffmpegPath: string | undefined
): Promise<{ wavPath: string; dir: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nolm-whisper-wav-"));
  // distinct input/output names: ffmpeg refuses in-place edits, which the
  // old `extHint === "wav"` shortcut hit (same path for both) the first time
  // a REAL .wav took the direct path
  const inputPath = path.join(tmpDir, `input.${extHint || "mp3"}`);
  const wavPath = path.join(tmpDir, "16k.wav");
  await fs.promises.writeFile(inputPath, audio);
  try {
    await execFileAsync(
      ffmpegPath || "ffmpeg",
      ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", wavPath],
      { timeout: 60_000, windowsHide: true }
    );
    return { wavPath, dir: tmpDir };
  } catch (err) {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`FFmpeg-Fehler bei der Whisper-Vorbereitung: ${detail}`);
  }
}

/** Fire-and-forget telemetry write (mirrors providers.recordQuietly). */
function recordQuietly(db: LocalDb, run: {
  capability: "transcribe";
  provider: string;
  model?: string | null;
  latencyMs: number;
  ok: boolean;
  errorCode?: string | null;
}): void {
  try {
    recordProviderRun(db, run);
  } catch (err) {
    console.error("[whisper] provider_runs write failed:", err);
  }
}

/**
 * Local TranscribeFn factory for the whisper-local preset: audio to 16k wav
 * (ffmpeg) to runWhisper to {text, segments} — whisper's OWN temporal
 * segments ride along so a direct single-call transcription (<=24 MB) also
 * preserves real times, not just the segmented path. One provider_runs row
 * per call, fire-and-forget (a failing telemetry write never breaks the
 * transcription).
 */
export function makeLocalTranscribe(
  db: LocalDb,
  cfg: { whisperDir: string; modelPath: string; model: string }
): TranscribeFn {
  return async (audio, fileName) => {
    const t0 = Date.now();
    let wav: { wavPath: string; dir: string } | null = null;
    try {
      const ext = fileName.split(".").pop()?.toLowerCase() || "mp3";
      wav = await toWav16kMono(audio, ext, process.env.FFMPEG_PATH);
      const result = await runWhisper({
        whisperDir: cfg.whisperDir,
        modelPath: cfg.modelPath,
        wavPath: wav.wavPath,
      });
      recordQuietly(db, {
        capability: "transcribe", provider: "whisper-local", model: cfg.model,
        latencyMs: Date.now() - t0, ok: true,
      });
      return { text: result.text, segments: result.segments };
    } catch (err) {
      recordQuietly(db, {
        capability: "transcribe", provider: "whisper-local", model: cfg.model,
        latencyMs: Date.now() - t0, ok: false, errorCode: "local_error",
      });
      throw err;
    } finally {
      if (wav) await fs.promises.rm(wav.dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}
