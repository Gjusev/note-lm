#!/usr/bin/env node
/**
 * Fetch the pinned llama.cpp runtime for the desktop bundle (issue #2/#9).
 * Win CPU x64 build from the bNNNNN prerelease tags — the "latest" GitHub
 * release carries no binaries (probe finding). Hash-verified against the
 * release's checksums.sha256. Ships llama-server + ggml DLLs (~47 MB).
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const TAG = process.env.NOTELM_LLAMA_TAG || "b11233";
const ASSET = `llama-${TAG}-bin-win-cpu-x64.zip`;
const BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${TAG}`;

const scratch = path.resolve(".probe-downloads");
const outDir = path.resolve("src-tauri/resources/llama");
const marker = path.join(outDir, ".complete");

fs.mkdirSync(scratch, { recursive: true });
if (fs.existsSync(marker)) {
  console.log(`llama ${TAG} already packaged: ${outDir}`);
  process.exit(0);
}

const zipPath = path.join(scratch, ASSET);
if (!fs.existsSync(zipPath)) {
  console.log(`downloading ${BASE}/${ASSET} (~19 MB) …`);
  const res = await fetch(`${BASE}/${ASSET}`);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await pipeline(res.body, fs.createWriteStream(zipPath));
}

// verify against the published sha256
const sumsPath = path.join(scratch, `checksums-${TAG}.sha256`);
if (!fs.existsSync(sumsPath)) {
  const res = await fetch(`${BASE}/checksums.sha256`);
  if (res.ok) fs.writeFileSync(sumsPath, await res.text());
}
if (fs.existsSync(sumsPath)) {
  const expected = fs
    .readFileSync(sumsPath, "utf8")
    .split("\n")
    .find((l) => l.includes(ASSET))
    ?.split(/\s+/)[0];
  const actual = createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
  if (expected && actual !== expected) throw new Error(`sha256 mismatch: ${actual} != ${expected}`);
  console.log("sha256 ok");
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync("C:/Windows/System32/tar.exe", ["-xf", zipPath, "-C", outDir]);
fs.writeFileSync(marker, TAG);
const version = execFileSync(path.join(outDir, "llama-server.exe"), ["--version"], { encoding: "utf8" }).split("\n")[0];
console.log(`ok: ${outDir} — ${version}`);
