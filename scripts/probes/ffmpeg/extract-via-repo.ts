// Repo-path verification (issue #9): proves src/lib/ffmpeg.ts works end-to-end
// when FFMPEG_PATH points at the downloaded bundled ffmpeg.exe.
// Usage: node_modules/.bin/tsx scripts/probes/ffmpeg/extract-via-repo.ts
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractAudioFromVideo } from "../../../../src/lib/ffmpeg";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
process.env.FFMPEG_PATH = path.join(
  repo, ".probe-downloads", "ffmpeg-n8.1.3-6-gff48edd8b2-win64-gpl-8.1", "bin", "ffmpeg.exe",
);

async function main() {
  const wav = await readFile(path.join(repo, ".probe-downloads", "probe-out", "sine.wav"));
  console.log(`input sine.wav: ${wav.length} bytes, FFMPEG_PATH=${process.env.FFMPEG_PATH}`);

  const mp3 = await extractAudioFromVideo(wav);
  const head = mp3.subarray(0, 3).toString("latin1");
  const out = path.join(repo, ".probe-downloads", "probe-out", "repo-path.mp3");
  await writeFile(out, mp3);
  console.log(`extractAudioFromVideo -> ${mp3.length} bytes, header "${head}" (expect ID3 or 0xFFEx), saved ${out}`);

  if (!head.startsWith("ID3") && mp3[0] !== 0xff) throw new Error("output is not mp3");
  const probe = spawnSync(path.join(repo, ".probe-downloads", "ffmpeg-n8.1.3-6-gff48edd8b2-win64-gpl-8.1", "bin", "ffprobe.exe"),
    ["-v", "error", "-show_entries", "stream=codec_name,bit_rate:format=duration", "-of", "default=noprint_wrappers=1", out],
    { encoding: "utf8" });
  if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr}`);
  console.log("--- ffprobe repo-path.mp3 ---");
  console.log(probe.stdout.trim());
}

main();
