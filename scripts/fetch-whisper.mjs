#!/usr/bin/env node
/**
 * Fetch the pinned whisper.cpp runtime for local transcription (win-x64 CPU
 * build). The pin (tag + URL + sha256, whisper.cpp MIT) lives in the shared
 * module src/lib/ai/whisper-pin.mjs — the app-managed download
 * (runtimes.whisper op) and this dev script fetch the exact same bytes.
 * Extracts to .probe-downloads/whisper-bin (whisper-cli.exe + ggml DLLs,
 * ~8 MB). Models come separately from the model catalog (ggml-tiny.bin /
 * ggml-base.bin via Hugging Face, HF-LFS-verified).
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  WHISPER_TAG as TAG,
  WHISPER_ASSET as ASSET,
  whisperZipUrl,
  WHISPER_ZIP_SHA256 as EXPECTED_SHA256,
} from "../src/lib/ai/whisper-pin.mjs";

const scratch = path.resolve(".probe-downloads");
const outDir = path.join(scratch, "whisper-bin");
const marker = path.join(outDir, ".complete");

fs.mkdirSync(scratch, { recursive: true });
if (fs.existsSync(marker) && fs.existsSync(path.join(outDir, "whisper-cli.exe"))) {
  console.log(`whisper ${TAG} already provisioned: ${outDir}`);
  process.exit(0);
}

const zipPath = path.join(scratch, ASSET);
if (!fs.existsSync(zipPath)) {
  console.log(`downloading ${whisperZipUrl()} (~8 MB) ...`);
  const res = await fetch(whisperZipUrl());
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await pipeline(res.body, fs.createWriteStream(zipPath));
}

// verify against the digest pinned at pin time (no upstream sums published)
const actual = createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
if (actual !== EXPECTED_SHA256) {
  throw new Error(`sha256 mismatch: ${actual} != ${EXPECTED_SHA256}`);
}
console.log("sha256 ok (pinned digest)");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync("C:/Windows/System32/tar.exe", ["-xf", zipPath, "-C", outDir]);
// the release zip nests everything under Release/ — flatten (llama pattern:
// the runtime dir holds the exe + DLLs directly)
const nested = path.join(outDir, "Release");
if (fs.existsSync(nested)) {
  for (const entry of fs.readdirSync(nested)) {
    fs.renameSync(path.join(nested, entry), path.join(outDir, entry));
  }
  fs.rmdirSync(nested);
}
fs.writeFileSync(marker, TAG);

// note the observed pin data (dir is gitignored; the script above is the
// checked-in record)
const note = [
  `# whisper.cpp runtime pin (observed ${new Date().toISOString()})`,
  `tag: ${TAG}`,
  `asset: ${ASSET}`,
  `sha256: ${actual}`,
  `models: ggml-tiny.bin be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21`,
  `models: ggml-base.bin 60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`,
  `model source: https://huggingface.co/ggerganov/whisper.cpp (HF LFS oids)`,
  "",
].join("\n");
fs.writeFileSync(path.join(scratch, "whisper-checksums.md"), note);

const version = execFileSync(
  path.join(outDir, "whisper-cli.exe"), ["--version"], { encoding: "utf8" }
).trim().split("\n").at(-1);
console.log(`ok: ${outDir} - ${version}`);
