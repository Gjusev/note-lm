#!/usr/bin/env node
/**
 * Desktop verification pipeline (issue #9): one command that builds, tests,
 * packages, silently installs and smoke-tests the INSTALLED app on a PATH
 * stripped of Node — simulating a clean machine — then uninstalls.
 *
 * Usage:  npm run verify:desktop
 * Steps are sequential; any failure exits non-zero with a summary.
 */
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const steps = [];
const run = (name, fn) => {
  const t0 = Date.now();
  try {
    fn();
    steps.push([name, "ok", `${((Date.now() - t0) / 1000).toFixed(0)}s`]);
    console.log(`\n=== ${name}: ok (${((Date.now() - t0) / 1000).toFixed(0)}s) ===\n`);
  } catch (err) {
    steps.push([name, "FAIL", err.message.slice(0, 200)]);
    console.error(`\n=== ${name}: FAILED ===\n${err.message}`);
    summary();
    process.exit(1);
  }
};
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
};

// PATH without any Node: proves the app runs purely on the bundled runtime.
const STRIPPED_PATH = "C:\\Windows\\System32";

// 1) static + test gates
run("typecheck", () => sh("npx", ["tsc", "--noEmit"]));
run("unit tests", () => sh("npx", ["vitest", "run"]));
run("engine e2e", () => sh("npx", ["vitest", "run", "--config", "vitest.e2e.config.ts", "e2e/engine-stdio.e2e.test.ts"]));

// 2) binaries
run("engine bundle (ABI-matched prebuild)", () => sh("npm", ["run", "build:engine"]));
run("pinned Node runtime", () => sh("npm", ["run", "fetch:node"]));
run("pinned FFmpeg", () => sh("npm", ["run", "fetch:ffmpeg"]));
run("pinned llama.cpp", () => sh("npm", ["run", "fetch:llama"]));

// 3) dev build smoke on clean PATH
run("cargo build (dev)", () => sh("cargo", ["build"], { cwd: path.join(repo, "src-tauri") }));
run("dev smoke (clean PATH)", () => {
  const exe = path.join(repo, "src-tauri", "target", "debug", "notelm-spike.exe");
  const out = spawnSync(exe, ["--smoke"], {
    env: { ...process.env, NOTELM_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "notelm-dev-")), PATH: STRIPPED_PATH },
    encoding: "utf8",
  });
  console.log(out.stdout);
  if (out.status !== 0) throw new Error(`dev smoke exited ${out.status}: ${out.stderr}`);
});

// 4) installer
run("desktop UI (vite)", () => sh("npm", ["run", "build:desktop"]));
run("tauri build (NSIS installer)", () => sh("npx", ["tauri", "build"]));
const installer = fs
  .readdirSync(path.join(repo, "src-tauri/target/release/bundle/nsis"))
  .find((f) => f.endsWith("-setup.exe"));
if (!installer) throw new Error("installer not produced");

// 5) silent install + installed smoke + uninstall
const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-install-"));
run("silent install", () => {
  // NSIS: /S silent, /D= install dir LAST, unquoted, backslashes
  execFileSync(path.join(repo, "src-tauri/target/release/bundle/nsis", installer), ["/S", `/D=${installDir}`], { stdio: "ignore" });
  // NSIS returns immediately; poll for the exe
  const exe = path.join(installDir, "notelm-spike.exe");
  for (let i = 0; i < 60 && !fs.existsSync(exe); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  if (!fs.existsSync(exe)) throw new Error(`installed exe not found at ${exe}`);
});

let installedDataDir;
run("installed smoke (clean PATH)", () => {
  installedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-installed-"));
  // optional deep smoke: real local inference from the INSTALLED package
  // when models are provided via env (dev machines / .probe-downloads)
  const chatModel = process.env.NOTELM_SMOKE_CHAT_MODEL;
  const embedModel = process.env.NOTELM_SMOKE_EMBED_MODEL;
  const out = spawnSync(path.join(installDir, "notelm-spike.exe"), ["--smoke"], {
    env: {
      ...process.env,
      NOTELM_DATA_DIR: installedDataDir,
      PATH: STRIPPED_PATH,
      ...(chatModel && { NOTELM_CHAT_MODEL: chatModel }),
      ...(embedModel && { NOTELM_EMBED_MODEL: embedModel }),
    },
    encoding: "utf8",
  });
  console.log(out.stdout);
  if (out.status !== 0) throw new Error(`installed smoke exited ${out.status}: ${out.stderr}`);
});

run("uninstall + process teardown", () => {
  const uninstaller = path.join(installDir, "uninstall.exe");
  if (fs.existsSync(uninstaller)) execFileSync(uninstaller, ["/S"], { stdio: "ignore" });
  // no engine children of ours may survive
  const ps = execFileSync(
    "powershell",
    ["-Command", "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*engine.cjs*' } | Measure-Object | Select-Object -ExpandProperty Count"],
    { encoding: "utf8" }
  ).trim();
  if (ps !== "0") throw new Error(`${ps} engine node.exe processes still running after uninstall`);
});

fs.rmSync(installDir, { recursive: true, force: true });
if (installedDataDir) fs.rmSync(installedDataDir, { recursive: true, force: true });

function summary() {
  console.log("\n──── desktop verification ────");
  for (const [name, status, info] of steps) {
    console.log(`${status === "ok" ? " ✓" : " ✗"} ${name} — ${info}`);
  }
}
summary();
