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
for (const pkg of ["better-sqlite3", "bindings"]) {
  fs.cpSync(path.join("node_modules", pkg), path.join(nodeModules, pkg), {
    recursive: true,
    verbatimSymlinks: true,
  });
}

console.log(`engine bundle → ${outDir}`);
console.log("note: package a pinned Node runtime binary (sidecar) for clean machines — see issue #9");
