#!/usr/bin/env node
/**
 * Bundle the local engine for packaging (issue #9 spike).
 *
 * esbuild bundles everything except native addons; better-sqlite3 stays
 * external and its package (with the prebuilt .node binding) is copied
 * beside the bundle. The packaged app runs this with the bundled Node
 * runtime — SEA/single-file is NOT viable here because native addons
 * cannot be embedded.
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const outDir = path.resolve("src-tauri/resources/engine");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: ["src/engine/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: path.join(outDir, "engine.cjs"),
  external: ["better-sqlite3"],
  sourcemap: false,
  logLevel: "info",
});

// Native addon + its runtime deps ship as real files next to the bundle.
const nodeModules = path.join(outDir, "node_modules");
fs.mkdirSync(nodeModules, { recursive: true });
for (const pkg of ["better-sqlite3", "bindings", "file-uri-to-path"]) {
  fs.cpSync(path.join("node_modules", pkg), path.join(nodeModules, pkg), {
    recursive: true,
    verbatimSymlinks: true,
  });
}

// The installed better_sqlite3.node targets THIS machine's Node ABI; the
// bundled runtime is pinned separately (v22 → ABI 127) and loading a
// mismatched addon fails at runtime. Fetch the matching prebuild so the
// bundle runs on the packaged Node without any build toolchain.
const NODE_ABI = process.env.NOTELM_NODE_ABI || "127"; // Node 22 LTS
const bsqVersion = JSON.parse(
  fs.readFileSync("node_modules/better-sqlite3/package.json", "utf8")
).version;
const prebuildUrl = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${bsqVersion}/better-sqlite3-v${bsqVersion}-node-v${NODE_ABI}-win32-x64.tar.gz`;
console.log(`fetching prebuild for bundled Node ABI ${NODE_ABI}: ${prebuildUrl}`);
const res = await fetch(prebuildUrl);
if (!res.ok) throw new Error(`prebuild download failed: ${res.status} ${prebuildUrl}`);
const tgz = path.join(outDir, "better-sqlite3-prebuild.tgz");
fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
// Windows bsdtar reads tgz and accepts absolute paths (GNU tar in Git Bash does not)
execFileSync("C:/Windows/System32/tar.exe", ["-xf", tgz, "-C", path.join(nodeModules, "better-sqlite3")]);
fs.rmSync(tgz);

console.log(`engine bundle → ${outDir}`);
console.log("note: package a pinned Node runtime binary (sidecar) for clean machines — see issue #9");
