#!/usr/bin/env node
/**
 * Fetch the pinned FFmpeg binary for the desktop bundle (issue #9).
 * BtbN win64-gpl build — chosen because it enables libmp3lame, which
 * src/lib/ffmpeg.ts requires. Only ffmpeg.exe ships (fully static, the
 * repo never calls ffprobe). GPL compliance for the binary itself is
 * tracked in issue #9.
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const TAG = "autobuild-2026-09-28-13-06";
const ASSET = "ffmpeg-n8.1.3-6-gff48edd8b2-win64-gpl-8.1.zip";
const SHA256 = "82bdeccfa0cd210dfbd2c5ff3312e608ebf1b61f60786561417f273d9b67a329";
const BASE = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${TAG}`;

const scratch = path.resolve(".probe-downloads");
const outDir = path.resolve("src-tauri/resources/ffmpeg");
const exePath = path.join(outDir, "ffmpeg.exe");

fs.mkdirSync(scratch, { recursive: true });
if (fs.existsSync(exePath)) {
  console.log(`ffmpeg already present: ${exePath}`);
  process.exit(0);
}

const zipPath = path.join(scratch, ASSET);
if (!fs.existsSync(zipPath)) {
  console.log(`downloading ${BASE}/${ASSET} (~184 MB) …`);
  const res = await fetch(`${BASE}/${ASSET}`);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await pipeline(res.body, fs.createWriteStream(zipPath));
}

const hash = createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
if (hash !== SHA256) throw new Error(`sha256 mismatch: ${hash}`);

console.log("sha256 ok — extracting ffmpeg.exe …");
fs.mkdirSync(outDir, { recursive: true });
// Windows ships bsdtar (C:/Windows/System32/tar.exe) which reads zip and
// accepts absolute Windows paths; the Git Bash GNU tar on PATH does neither
execFileSync(
  "C:/Windows/System32/tar.exe",
  ["-xf", zipPath, "--strip-components=2", "-C", outDir, `${ASSET.replace(/\.zip$/, "")}/bin/ffmpeg.exe`]
);

if (!fs.existsSync(exePath)) throw new Error("extraction did not produce ffmpeg.exe");
const version = execFileSync(exePath, ["-version"], { encoding: "utf8" }).split("\n")[0];
console.log(`ok: ${exePath} — ${version}`);
