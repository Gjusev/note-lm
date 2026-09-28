// FFmpeg packaging probe (issue #9, Tauri spike).
// Raw-ffmpeg path: sine WAV -> mp3 with the EXACT flags src/lib/ffmpeg.ts uses
// (fluent-ffmpeg .noVideo().audioCodec("libmp3lame").audioBitrate("128k") maps to
// "-vn -c:a libmp3lame -b:a 128k"), then ffprobe validation.
// Usage: node scripts/probes/ffmpeg/probe.mjs   (override bin dir with FFMPEG_BIN)
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const binDir = process.env.FFMPEG_BIN
  ? path.resolve(process.env.FFMPEG_BIN)
  : path.join(repo, ".probe-downloads", "ffmpeg-n8.1.3-6-gff48edd8b2-win64-gpl-8.1", "bin");
const ffmpeg = path.join(binDir, "ffmpeg.exe");
const ffprobe = path.join(binDir, "ffprobe.exe");
const outDir = path.join(repo, ".probe-downloads", "probe-out");
const wav = path.join(outDir, "sine.wav");
const mp3 = path.join(outDir, "sine.mp3");

function run(file, args, label) {
  const r = spawnSync(file, args, { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`FAIL ${label}: exit ${r.status}\n${r.stderr}`);
    process.exit(1);
  }
  return r;
}

function size(p) {
  return `${(statSync(p).size / 1024).toFixed(1)} KiB (${statSync(p).size} bytes)`;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const ver = run(ffmpeg, ["-version"], "ffmpeg -version");
console.log(ver.stdout.split("\n")[0]);

run(ffmpeg, ["-hide_banner", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", wav], "generate wav");
run(ffmpeg, ["-hide_banner", "-i", wav, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", mp3], "wav -> mp3");

console.log(`sine.wav (2s, 44.1kHz stereo pcm_s16le): ${size(wav)}`);
console.log(`sine.mp3 (-vn -c:a libmp3lame -b:a 128k): ${size(mp3)}`);

const probe = run(
  ffprobe,
  ["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels,bit_rate:format=duration,format_name", "-of", "default=noprint_wrappers=1", mp3],
  "ffprobe mp3",
);
console.log("--- ffprobe sine.mp3 ---");
console.log(probe.stdout.trim());
