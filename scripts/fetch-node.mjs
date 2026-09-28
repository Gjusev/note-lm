#!/usr/bin/env node
/**
 * Fetch the pinned Node runtime for the desktop bundle (issue #9).
 * Tauri externalBin expects target-triple names; the suffix is stripped
 * when installed, so the app resolves `node.exe` next to its own exe.
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";

const NODE_VERSION = process.env.NOTELM_NODE_VERSION || "22.14.0";
const TRIPLE = "x86_64-pc-windows-msvc";
const outDir = path.resolve("src-tauri/binaries");
const outPath = path.join(outDir, `node-${TRIPLE}.exe`);

fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(outPath)) {
  console.log(`node ${NODE_VERSION} already present: ${outPath}`);
  process.exit(0);
}

const url = `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`;
console.log(`downloading ${url} …`);
const res = await fetch(url);
if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
await pipeline(res.body, fs.createWriteStream(outPath));

// sanity: the binary must run
const version = execFileSync(outPath, ["--version"], { encoding: "utf8" }).trim();
console.log(`ok: ${outPath} (${version})`);
