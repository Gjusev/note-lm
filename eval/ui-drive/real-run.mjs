#!/usr/bin/env node
/**
 * Surface A — REAL Tauri 2 run (smoke-level proof, no VM): launch the BUILT
 * desktop app (src-tauri/target/release/notelm-spike.exe — the same layout
 * the NSIS install produces: exe + node.exe + resources/{engine,ffmpeg,
 * llama,samples} side by side) with a FRESH data dir, then verify:
 *
 *   1. the process is alive and opened a real window,
 *   2. the engine child node process was spawned (Win32_Process cmdline),
 *   3. the window rendered — a screenshot via CopyFromScreen,
 *   4. clean close (WM_CLOSE) and teardown: no app process, no orphan
 *      engine node.exe scoped to our install path.
 *
 * Usage: node eval/ui-drive/real-run.mjs
 * Artifacts: eval/ui-drive/artifacts/real-run-evidence.json + screenshots.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exe = path.join(repo, "src-tauri", "target", "release", "notelm-spike.exe");
const here = path.dirname(fileURLToPath(import.meta.url));
const artifacts = path.join(here, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const evidence = { steps: [], engineChildren: [], screenshots: [] };
const log = (m) => console.log(`[real-run] ${m}`);
const run = (name, fn) => {
  let ok = true;
  try { fn(); } catch (err) { ok = false; evidence.steps.push([name, "FAIL", String(err.message)]); log(`FAIL ${name}: ${err.message}`); }
  if (ok) { evidence.steps.push([name, "ok", ""]); log(`ok   ${name}`); }
  return ok;
};

if (!fs.existsSync(exe)) {
  console.error(`built exe missing: ${exe} (run npx tauri build / cargo build --release)`);
  process.exit(1);
}

// The packaging bug this harness exposed is FIXED in main.rs: setup() now
// resolves resources through smoke_resource_dir(), so the GUI spawns the
// engine from <exe>/resources/engine like every real install. No junctions.
const releaseDir = path.join(repo, "src-tauri", "target", "release");
const ENGINE_MARKER = path.join(releaseDir, "resources", "engine", "engine.cjs");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-uirun-"));
evidence.exe = exe;
evidence.dataDir = dataDir;
log(`exe=${exe}`);
log(`dataDir=${dataDir}`);

/** node.exe children whose command line runs OUR engine bundle (install-path
 *  scoped, so a concurrently running real install cannot false-fail). */
const engineProcs = () => {
  const out = execFileSync("powershell", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${ENGINE_MARKER}*' } | Select-Object ProcessId | ConvertTo-Json -Compress`],
    { encoding: "utf8" }).trim();
  if (!out) return [];
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => {
  const stdout = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "shot-window.ps1"), "-OutFile", path.join(artifacts, name)], { encoding: "utf8" });
  evidence.screenshots.push({ file: name, detail: stdout.trim() });
  log(stdout.trim());
};

// --- launch ---------------------------------------------------------------------
const child = spawn(exe, [], {
  env: { ...process.env, NOTELM_DATA_DIR: dataDir },
  stdio: ["ignore", "ignore", "pipe"],
});
evidence.pid = child.pid;
const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (c) => { stderr += c; });

try {
  await wait(5000);
  run("process alive after 5 s", () => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`app exited early (${child.exitCode ?? child.signalCode}): ${stderr.slice(0, 400)}`);
  });
  run("engine child node process spawned", () => {
    const arr = engineProcs();
    if (arr.length < 1) throw new Error("no engine node.exe child found for our install path");
    evidence.engineChildren = arr.map((p) => p.ProcessId);
  });
  run("screenshot: library window", () => shot("real-run-1-library.png"));

  // NOTE: driving "Beispiel laden" INSIDE the native window was tried and
  // dropped on purpose: synthetic mouse/keyboard events on a live user
  // desktop fight the foreground lock (clicks only activate the window, and
  // real user keystrokes can leak into the focused form). The deep
  // interactive drive of the same UI runs in drive-ui.mjs (Playwright,
  // surface B); here we stay smoke-level per the mandate.

  // --- clean close (WM_CLOSE) + teardown ---------------------------------------
  log("closing the app window (WM_CLOSE)…");
  let closeResult = "closed";
  execFileSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${child.pid}).CloseMainWindow()`], { encoding: "utf8" });
  const gone = await Promise.race([exited, wait(10_000).then(() => false)]);
  if (gone === false) {
    closeResult = "force-killed after 10 s grace";
    try { execFileSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" }); } catch { /* already gone */ }
    await exited;
  }
  evidence.close = closeResult;
  log(`app exit: ${JSON.stringify(await exited)} (${closeResult})`);

  run("app process gone", () => {
    const still = execFileSync("powershell", ["-NoProfile", "-Command",
      `(Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue) -ne $null`], { encoding: "utf8" }).trim();
    if (still === "True") throw new Error("notelm-spike.exe still running after close");
  });
  run("no orphan engine node.exe (our install path)", () => {
    const left = engineProcs();
    if (left.length > 0) throw new Error(`${left.length} engine node.exe still running: ${left.map((p) => p.ProcessId)}`);
  });
} finally {
  // never leave the app behind, even on an unexpected mid-run throw
  if (child.exitCode === null && child.signalCode === null) {
    try { execFileSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" }); } catch { /* already gone */ }
    await exited;
  }
}

try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp cleaner */ }
fs.writeFileSync(path.join(artifacts, "real-run-evidence.json"), JSON.stringify(evidence, null, 2));
log(`evidence: ${path.join(artifacts, "real-run-evidence.json")}`);
const failed = evidence.steps.filter(([, s]) => s === "FAIL");
if (failed.length) { log(`${failed.length} FAILED step(s)`); process.exit(1); }
log("real run green");
