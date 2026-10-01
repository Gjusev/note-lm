#!/usr/bin/env node
/**
 * Desktop verification pipeline (issue #9): one command that builds, tests,
 * packages, silently installs and smoke-tests the INSTALLED app on a PATH
 * stripped of Node — simulating a clean machine — then uninstalls.
 *
 * Usage:  npm run verify:desktop
 *         node scripts/desktop-verify.mjs --only=silent install,recovery   (gate filter)
 * Steps are sequential; any failure exits non-zero with a summary.
 */
import { spawnSync, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Gate filter: `--only=substring[,substring]` runs only gates whose name
// contains one of the substrings (case-insensitive). No filter = all gates.
const ONLY = process.argv
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const steps = [];
const run = async (name, fn) => {
  if (ONLY && !ONLY.some((s) => name.toLowerCase().includes(s))) return;
  const t0 = Date.now();
  try {
    await fn();
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
await run("typecheck", () => sh("npx", ["tsc", "--noEmit"]));
await run("unit tests", () => sh("npx", ["vitest", "run"]));
await run("engine e2e", () => sh("npx", ["vitest", "run", "--config", "vitest.e2e.config.ts", "e2e/engine-stdio.e2e.test.ts"]));

// 2) binaries
await run("engine bundle (ABI-matched prebuild)", () => sh("npm", ["run", "build:engine"]));
await run("pinned Node runtime", () => sh("npm", ["run", "fetch:node"]));
await run("pinned FFmpeg", () => sh("npm", ["run", "fetch:ffmpeg"]));
await run("pinned llama.cpp", () => sh("npm", ["run", "fetch:llama"]));

// 3) dev build smoke on clean PATH
await run("cargo build (dev)", () => sh("cargo", ["build"], { cwd: path.join(repo, "src-tauri") }));
await run("dev smoke (clean PATH)", () => {
  const exe = path.join(repo, "src-tauri", "target", "debug", "notelm-spike.exe");
  const out = spawnSync(exe, ["--smoke"], {
    env: { ...process.env, NOTELM_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "notelm-dev-")), PATH: STRIPPED_PATH },
    encoding: "utf8",
  });
  console.log(out.stdout);
  if (out.status !== 0) throw new Error(`dev smoke exited ${out.status}: ${out.stderr}`);
});

// 4) installer
await run("desktop UI (vite)", () => sh("npm", ["run", "build:desktop"]));
await run("tauri build (NSIS installer)", () => sh("npx", ["tauri", "build"]));
const installer = fs
  .readdirSync(path.join(repo, "src-tauri/target/release/bundle/nsis"))
  .find((f) => f.endsWith("-setup.exe"));
if (!installer) throw new Error("installer not produced");

// 5) silent install + installed smoke + uninstall
const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-install-"));
await run("silent install", () => {
  // NSIS: /S silent, /D= install dir LAST, unquoted, backslashes
  execFileSync(path.join(repo, "src-tauri/target/release/bundle/nsis", installer), ["/S", `/D=${installDir}`], { stdio: "ignore" });
  // NSIS returns immediately; poll for the exe
  const exe = path.join(installDir, "notelm-spike.exe");
  for (let i = 0; i < 60 && !fs.existsSync(exe); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  if (!fs.existsSync(exe)) throw new Error(`installed exe not found at ${exe}`);
});

let installedDataDir;
await run("installed smoke (clean PATH)", () => {
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

// 6) interruption / recovery gates (desktop-workers-plan slice 5, "Matar un
// worker, matar el motor ... reabrir y comprobar recuperación" + "Pausar en
// cola ... persistencia tras reiniciar"): headless — the gates drive the
// INSTALLED engine binary directly over its NDJSON stdio protocol, no GUI.
await run("installed recovery (kill + restart)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-recovery-"));
  const { server, url } = await startSlowHtmlServer();
  let e1, e2;
  try {
    e1 = startInstalledEngine(dataDir);
    await e1.request("protocol.version", {});
    const nb = await e1.request("notebooks.create", { title: "Recovery" });
    const created = await e1.request("imports.create", {
      notebookId: nb.id,
      url,
    });
    const jobId = created.jobId;
    const partialDir = path.join(dataDir, "tmp", "jobs", jobId);

    // wait until the import is mid-download with bytes actually on disk, then
    // hard-kill the whole engine process tree — the same shape as a crash/
    // power loss. The phase row flips before the first byte lands, so killing
    // on the status alone would make the partial assertion racy.
    await waitFor("import downloading with a non-empty partial", async () => {
      const { jobs } = await e1.request("jobs.list", { notebookId: nb.id });
      return jobs.find((j) => j.id === jobId)?.status === "downloading" && partialHasBytes(partialDir);
    }, 25_000);
    killTree(e1.proc.pid);
    await e1.exited;
    // the crash must have left the resumable partial on disk
    if (!fs.existsSync(partialDir)) throw new Error("no tmp/jobs partial left behind by the crash");

    // the import lease runs 10 min (LEASE_MS in src/lib/services/import-jobs.ts):
    // a crashed job keeps its lease and the restarted engine correctly waits it
    // out — production recovery latency the gate cannot afford. Simulate the
    // expiry exactly like the vitest suites do via fastForwardForTests
    // (src/db/local/index.ts): zero the lease column on a second connection.
    expireImportLeases(dataDir);

    e2 = startInstalledEngine(dataDir); // boot runs the startup reconcile
    await waitFor("import completed after restart", async () => {
      const { jobs } = await e2.request("jobs.list", { notebookId: nb.id });
      return jobs.find((j) => j.id === jobId)?.status === "completed";
    }, 45_000);
    const sources = await e2.request("sources.list", { notebookId: nb.id });
    if (sources.length !== 1 || sources[0].status !== "completed") {
      throw new Error(`expected 1 completed source, got ${JSON.stringify(sources.map((s) => [s.id, s.status]))}`);
    }
    const chunks = await e2.request("sources.chunks", { sourceId: sources[0]._id });
    if (!chunks.length) throw new Error("recovered source has no chunks");
    // reconcile: the terminal job's partial is consumed/cleaned. The rm runs
    // AFTER the completed status is visible and is best-effort on Windows (a
    // fresh download can be file-locked for a moment) — wait for it instead
    // of asserting it in the same instant; a never-cleaned partial still
    // fails the gate.
    await waitFor("tmp/jobs partial cleaned after completion", () => !fs.existsSync(partialDir), 10_000);

    await e2.stop();
    assertNoInstalledEngineLeft();
  } finally {
    for (const e of [e1, e2]) if (e) killTree(e.proc.pid); // failure path: no orphans
    await closeServer(server);
    // best effort on Windows: the engine may still hold file handles briefly
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp cleaner */ }
  }
});

await run("installed pause survives restart", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-pause-"));
  const { server, url } = await startSlowHtmlServer();
  let e1, e2;
  try {
    e1 = startInstalledEngine(dataDir);
    await e1.request("protocol.version", {});
    const nb = await e1.request("notebooks.create", { title: "Pausiert" });
    const created = await e1.request("imports.create", { notebookId: nb.id, url });
    const jobId = created.jobId;

    // pause must win against the 3 s engine tick; a claim that lands before
    // the intent is persisted is released back to queued at its next phase
    // gate, so re-issuing jobs.pause until the queue agrees is deterministic
    await waitFor("import queued with pause intent", async () => {
      await e1.request("jobs.pause", { kind: "import", jobId });
      const { jobs } = await e1.request("jobs.list", { notebookId: nb.id });
      const job = jobs.find((j) => j.id === jobId);
      return job?.status === "queued" && job?.intent === "pause";
    }, 20_000);
    await e1.stop(); // restart the engine on the same data dir
    e2 = startInstalledEngine(dataDir);

    // the fresh instance must NOT claim the paused job across several ticks
    await new Promise((r) => setTimeout(r, 8_000));
    const pausedJobs = async () => {
      const { jobs } = await e2.request("jobs.list", { notebookId: nb.id });
      return jobs.find((j) => j.id === jobId);
    };
    let job = await pausedJobs();
    if (job?.status !== "queued" || job?.intent !== "pause") {
      throw new Error(`paused job moved after restart: ${JSON.stringify(job)}`);
    }
    await new Promise((r) => setTimeout(r, 3_000));
    job = await pausedJobs();
    if (job?.status !== "queued" || job?.intent !== "pause") {
      throw new Error(`paused job moved after restart (2nd check): ${JSON.stringify(job)}`);
    }

    await e2.request("jobs.resume", { kind: "import", jobId });
    await waitFor("import completed after resume", async () => {
      const { jobs } = await e2.request("jobs.list", { notebookId: nb.id });
      return jobs.find((j) => j.id === jobId)?.status === "completed";
    }, 45_000);
    const sources = await e2.request("sources.list", { notebookId: nb.id });
    if (sources.length !== 1 || sources[0].status !== "completed") {
      throw new Error(`expected 1 completed source, got ${JSON.stringify(sources.map((s) => [s.id, s.status]))}`);
    }
    const chunks = await e2.request("sources.chunks", { sourceId: sources[0]._id });
    if (!chunks.length) throw new Error("resumed source has no chunks");

    await e2.stop();
    assertNoInstalledEngineLeft();
  } finally {
    for (const e of [e1, e2]) if (e) killTree(e.proc.pid); // failure path: no orphans
    await closeServer(server);
    // best effort on Windows: the engine may still hold file handles briefly
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp cleaner */ }
  }
});

// 6c) installed walkthrough: the full user flow end to end against the
// INSTALLED engine — URL import → anchored claim → changed re-import of the
// SAME url (version appended + staleness proposal) → typed not_a_sheet over
// the page source plus a real CSV sum → crash mid-walkthrough and restart →
// export/import round trip into a fresh data dir → honest no_provider chat.
// SHUTDOWN-during-processing is NOT duplicated here; the recovery gates own
// that scenario — this gate only proves the whole flow survives a crash
// mid-walkthrough (engine killed during the v2 download, resumed on reboot).
await run("installed walkthrough", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-walkthrough-"));
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-walkthrough-export-"));
  const importDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-walkthrough-import-"));
  const { server, articleUrl, csvUrl, serveVersion2 } = await startWalkthroughServer();
  const QUOTE = "Der Zinssatz betraegt 3,5 Prozent seit dem Beschluss.";
  let e1, e2, e3;
  try {
    e1 = startInstalledEngine(dataDir);
    await e1.request("protocol.version", {});
    const nb = await e1.request("notebooks.create", { title: "Durchlauf" });

    // 1) URL import: page lands as a source with chunks + an immutable v1
    const created = await e1.request("imports.create", { notebookId: nb.id, url: articleUrl });
    await waitFor("v1 import completed", async () => {
      const { jobs } = await e1.request("jobs.list", { notebookId: nb.id });
      return jobs.find((j) => j.id === created.jobId)?.status === "completed";
    }, 30_000);
    const sources = await e1.request("sources.list", { notebookId: nb.id });
    if (sources.length !== 1 || sources[0].status !== "completed") {
      throw new Error(`expected 1 completed source, got ${JSON.stringify(sources.map((s) => [s.id, s.status]))}`);
    }
    const sourceId = sources[0]._id;
    if (!(await e1.request("sources.chunks", { sourceId })).length) {
      throw new Error("imported source has no chunks");
    }
    const versions1 = await e1.request("sources.listVersions", { sourceId });
    if (versions1.map((v) => v.version).join() !== "1") {
      throw new Error(`expected exactly version 1, got ${JSON.stringify(versions1.map((v) => v.version))}`);
    }

    // 2) an anchored claim quoting a stable v1 sentence (page unknown: null
    // page is honest — the scan derives the reference page from the sidecar)
    const claim = await e1.request("claims.create", {
      notebookId: nb.id,
      text: "Der Zinssatz betraegt 3,5 Prozent.",
      anchors: [{ sourceId, quote: QUOTE }],
    });
    if (claim.unresolved.length) throw new Error(`anchor unresolved: ${JSON.stringify(claim.unresolved)}`);
    const claims1 = await e1.request("claims.list", { notebookId: nb.id });
    if (claims1.length !== 1 || !claims1[0].anchors.length) {
      throw new Error(`expected 1 anchored claim, got ${JSON.stringify(claims1.map((c) => [c._id, c.anchors.length]))}`);
    }

    // 3) the SAME url is imported again after the server content changed:
    // URL dedupe reuses the SOURCE row and the changed bytes append v2. The
    // download is slow enough to hard-kill the engine mid-flow first — the
    // restarted engine resumes the partial and completes the same import.
    serveVersion2();
    const upd = await e1.request("imports.create", { notebookId: nb.id, url: articleUrl });
    await waitFor("v2 import downloading", async () => {
      const { jobs } = await e1.request("jobs.list", { notebookId: nb.id });
      return jobs.find((j) => j.id === upd.jobId)?.status === "downloading";
    }, 25_000);
    killTree(e1.proc.pid);
    await e1.exited;
    // crashed job keeps its 10-min lease: expire it exactly like the
    // recovery gate does (fastForwardForTests equivalent on a 2nd connection)
    expireImportLeases(dataDir);
    e2 = startInstalledEngine(dataDir);
    await e2.request("protocol.version", {});
    await waitFor("v2 import completed after restart", async () => {
      const { jobs } = await e2.request("jobs.list", { notebookId: nb.id });
      return jobs.find((j) => j.id === upd.jobId)?.status === "completed";
    }, 60_000);
    // completeImportJob flips the job to completed inside its transaction;
    // the version snapshot is recorded right after (non-fatal, async sidecar
    // write) - wait for that millisecond-window consistency instead of racing it.
    await waitFor("v2 version recorded", async () => {
      const vs = await e2.request("sources.listVersions", { sourceId });
      return vs.map((v) => v.version).join() === "1,2";
    }, 15_000);
    const versions2 = await e2.request("sources.listVersions", { sourceId });
    if (versions2.map((v) => v.version).join() !== "1,2") {
      const allSources = await e2.request("sources.list", { notebookId: nb.id });
      const allJobs = await e2.request("jobs.list", { notebookId: nb.id });
      throw new Error(
        `expected versions 1,2 after re-import, got ${JSON.stringify(versions2.map((v) => v.version))}` +
          ` | sources=${JSON.stringify(allSources.map((s) => [s._id, s.fileName, s.status]))}` +
          ` | jobs=${JSON.stringify((allJobs.jobs ?? []).map((j) => [j.id.slice(0, 8), j.kind, j.status]))}`
      );
    }
    const pending = await e2.request("review.list", { notebookId: nb.id });
    if (pending.length < 1 || pending[0].reason !== "quote_missing") {
      throw new Error(`expected >=1 quote_missing proposal, got ${JSON.stringify(pending.map((p) => p.reason))}`);
    }

    // 4a) calculations over the page source: typed not_a_sheet (honest error
    // path from the installer — no fabricated number)
    try {
      await e2.request("calculations.run", { notebookId: nb.id, sourceId, op: "sum", column: 0 });
      throw new Error("calculations.run over a page source unexpectedly succeeded");
    } catch (err) {
      if (!String(err.message).includes("not_a_sheet")) {
        if (String(err.message).includes("unexpectedly succeeded")) throw err;
        throw new Error(`expected not_a_sheet, got: ${err.message}`);
      }
    }

    // 4b) a CSV URL import (sheet sidecar) then a real sum
    const csvCreated = await e2.request("imports.create", { notebookId: nb.id, url: csvUrl });
    await waitFor("csv import completed", async () => {
      const { jobs } = await e2.request("jobs.list", { notebookId: nb.id });
      return jobs.find((j) => j.id === csvCreated.jobId)?.status === "completed";
    }, 30_000);
    const csvSource = (await e2.request("sources.list", { notebookId: nb.id }))
      .find((s) => String(s.fileType || "").startsWith("text/csv"));
    if (!csvSource) throw new Error("csv source not found after import");
    const sum = await e2.request("calculations.run", {
      notebookId: nb.id, sourceId: csvSource._id, op: "sum", column: "Menge",
    });
    if (sum.result !== "8") throw new Error(`expected sum 8, got ${JSON.stringify(sum)}`);

    // 5) export from the restarted engine, import into a SECOND engine on a
    // fresh data dir: claims/versions/proposals/calculation ride along
    await e2.request("notebook.export", { notebookId: nb.id, targetDir: exportDir });
    e3 = startInstalledEngine(importDataDir);
    await e3.request("protocol.version", {});
    const imported = await e3.request("notebook.import", { sourceDir: exportDir });
    const iClaims = await e3.request("claims.list", { notebookId: imported.notebookId });
    if (iClaims.length !== 1 || !iClaims[0].anchors.length) {
      throw new Error(`imported notebook lost the claim: ${JSON.stringify(iClaims.map((c) => [c._id, c.anchors.length]))}`);
    }
    const iSource = (await e3.request("sources.list", { notebookId: imported.notebookId }))
      .find((s) => String(s.fileType || "").startsWith("text/html"));
    if (!iSource) throw new Error("imported notebook lost the html source");
    if ((await e3.request("sources.listVersions", { sourceId: iSource._id })).length !== 2) {
      throw new Error("imported notebook lost the version history");
    }
    if ((await e3.request("review.list", { notebookId: imported.notebookId })).length !== 1) {
      throw new Error("imported notebook lost the pending review proposal");
    }
    const iCalcs = await e3.request("calculations.list", { notebookId: imported.notebookId });
    if (iCalcs.length !== 1 || iCalcs[0].result !== "8") {
      throw new Error(`imported notebook lost the calculation: ${JSON.stringify(iCalcs)}`);
    }

    // 6) chat.send without any configured provider: the typed no_provider
    // error, honest from the installer (a clean install has no models)
    try {
      await e3.request("chat.send", { notebookId: imported.notebookId, message: "Fasse den Beitrag zusammen" });
      throw new Error("chat.send without a provider unexpectedly succeeded");
    } catch (err) {
      if (!String(err.message).includes("no_provider")) {
        if (String(err.message).includes("unexpectedly succeeded")) throw err;
        throw new Error(`expected no_provider, got: ${err.message}`);
      }
    }

    await e2.stop();
    await e3.stop();
    assertNoInstalledEngineLeft();
  } finally {
    for (const e of [e1, e2, e3]) if (e) killTree(e.proc.pid); // failure path: no orphans
    await closeServer(server);
    // NOTELM_KEEP=1 keeps the gate's data dirs for post-mortem inspection
    if (process.env.NOTELM_KEEP) {
      console.log(`[walkthrough] dataDir kept: ${dataDir}`);
    } else {
      // best effort on Windows: the engine may still hold file handles briefly
      for (const dir of [dataDir, exportDir, importDataDir]) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp cleaner */ }
      }
    }
  }
});

// 6d) installed audio walkthrough: real speech through the INSTALLED engine
// — the bundled ~13 s SAPI sample (src-tauri/resources/samples/) is imported,
// transcribed by the LOCAL whisper capability (whisper.cpp v1.9.2 + ggml-tiny
// provided by the gate, mirroring how the app resolves the runtime), and the
// flow continues: media sidecar -> time-anchored claim -> export + restore
// into a second engine. Content quality is the WER harness's job (T2); this
// gate asserts mechanics only.
await run("installed audio walkthrough", async () => {
  const sample = path.join(installDir, "resources", "samples", "notelm-audio-de.wav");
  if (!fs.existsSync(sample)) throw new Error(`bundled sample missing: ${sample}`);
  // the gate provides what the capability resolution needs: whisper.cpp
  // runtime (.probe-downloads, npm run fetch:whisper) + ggml-tiny (catalog
  // sha, copied into the installed DATA dir layout the settings row resolves)
  const whisperBin = path.join(repo, ".probe-downloads", "whisper-bin");
  const whisperModel = path.join(repo, ".probe-downloads", "ggml-tiny.bin");
  for (const p of [whisperBin, path.join(whisperBin, "whisper-cli.exe"), whisperModel]) {
    if (!fs.existsSync(p)) throw new Error(`whisper runtime missing: ${p} (run npm run fetch:whisper + download ggml-tiny)`);
  }
  const TINY_SHA = "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21";

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-audio-"));
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-audio-export-"));
  const importDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-audio-import-"));
  let e1, e2;
  try {
    fs.mkdirSync(path.join(dataDir, "models"), { recursive: true });
    fs.copyFileSync(whisperModel, path.join(dataDir, "models", `${TINY_SHA}.bin`));

    e1 = startInstalledEngine(dataDir, {
      NOTELM_WHISPER_DIR: whisperBin, // capability resolves the whisper.cpp runtime here
      FFMPEG_PATH: path.join(installDir, "resources", "ffmpeg", "ffmpeg.exe"),
    });
    await e1.request("protocol.version", {});
    const nb = await e1.request("notebooks.create", { title: "Audio" });

    // the local transcribe capability: whisper-local connection + catalog
    // selection (the exact settings rows resolveCapabilities() reads)
    await e1.request("providers.save", {
      connection: { presetId: "whisper-local", label: "Auf diesem Computer (whisper.cpp)" },
      models: { transcribe: "ggml-tiny" },
    });
    await e1.request("models.selectTranscribe", { modelId: "ggml-tiny" });

    // import the bundled sample. The ".audio" extension is deliberate: a 13 s
    // wav sits far under the 24 MB direct-transcribe limit, which would
    // transcribe in ONE whisper call (no times knowable -> honest pages
    // fallback sidecar). An extension outside DIRECT_AUDIO_EXTS forces the
    // production SEGMENTING path (ffmpeg -> per-segment times -> media
    // sidecar) that long recordings take, keeping the gate at seconds instead
    // of bundling a 12.5-minute wav.
    const created = await e1.request("sources.importFile", {
      path: sample, notebookId: nb.id, fileName: "notelm-audio-de.audio", fileType: "audio/wav",
    });
    const sourceId = created.sourceId;
    // sources.importFile returns only {sourceId}; completion is observed on
    // the source row (the processing job's terminal state lands there)
    await waitFor("audio import completed", async () => {
      const sources = await e1.request("sources.list", { notebookId: nb.id });
      return sources.find((s) => s._id === sourceId)?.status === "completed";
    }, 90_000);

    // v1 with a media sidecar (per-segment times), asserted through the new
    // sources.open op and the sidecar file itself
    const [v1] = await e1.request("sources.listVersions", { sourceId });
    const opened = await e1.request("sources.open", { sourceId });
    if (opened.sidecarKind !== "media") {
      throw new Error(`expected media sidecar, got ${JSON.stringify(opened)}`);
    }
    if (!opened.absolutePath || !fs.existsSync(opened.absolutePath)) {
      throw new Error(`sources.open reported no existing original: ${opened.absolutePath}`);
    }
    const sidecar = JSON.parse(
      fs.readFileSync(path.join(dataDir, "files", "versions", `${v1.id}.json`), "utf8")
    );
    const segmentText = (sidecar.segments ?? []).map((s) => s.text ?? "").join(" ").trim();
    if (!segmentText) throw new Error("media sidecar has no non-empty segment text");
    if (!sidecar.segments[0] || sidecar.segments[0].startSec !== 0) {
      throw new Error(`first segment does not start at 0s: ${JSON.stringify(sidecar.segments[0])}`);
    }

    // a claim anchored with a real time locator (startSec 0)
    const claim = await e1.request("claims.create", {
      notebookId: nb.id,
      text: "Beispielzitat aus der Audioaufnahme.",
      anchors: [{ sourceId, locator: { startSec: 0, endSec: null } }],
    });
    if (claim.unresolved.length) throw new Error(`anchor unresolved: ${JSON.stringify(claim.unresolved)}`);
    const [claimRow] = await e1.request("claims.list", { notebookId: nb.id });
    if (!claimRow?.anchors?.length || claimRow.anchors[0].locator?.startSec !== 0) {
      throw new Error(`claim lost the time locator: ${JSON.stringify(claimRow)}`);
    }

    // export + restore into a SECOND engine: claim + media version ride along
    await e1.request("notebook.export", { notebookId: nb.id, targetDir: exportDir });
    e2 = startInstalledEngine(importDataDir, {
      NOTELM_WHISPER_DIR: whisperBin,
      FFMPEG_PATH: path.join(installDir, "resources", "ffmpeg", "ffmpeg.exe"),
      INGEST_ALLOW_PRIVATE: "1",
    });
    await e2.request("protocol.version", {});
    const imported = await e2.request("notebook.import", { sourceDir: exportDir });
    const [iClaim] = (await e2.request("claims.list", { notebookId: imported.notebookId }));
    if (!iClaim?.anchors?.length || iClaim.anchors[0].locator?.startSec !== 0) {
      throw new Error(`restored claim lost the time locator: ${JSON.stringify(iClaim)}`);
    }
    const iSource = (await e2.request("sources.list", { notebookId: imported.notebookId }))
      .find((s) => s.fileType === "audio/wav");
    if (!iSource) throw new Error("restored notebook lost the audio source");
    const iOpened = await e2.request("sources.open", { sourceId: iSource._id });
    if (iOpened.sidecarKind !== "media") {
      throw new Error(`restored source lost the media sidecar: ${JSON.stringify(iOpened)}`);
    }

    await e1.stop();
    await e2.stop();
    assertNoInstalledEngineLeft();
  } finally {
    for (const e of [e1, e2]) if (e) killTree(e.proc.pid); // failure path: no orphans
    for (const dir of [dataDir, exportDir, importDataDir]) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp cleaner */ }
    }
  }
});

// 6e) installed VOICE walkthrough (S5 engine half): the runtime AND the model
// come FROM THE APP on a FRESH data dir — no evaluator env, no repo paths, no
// gate-copied files, no extension renames. (1) runtimes.whisper install does
// a REAL download of the pinned whisper.cpp zip into the DATA dir, (2) the
// ggml-tiny catalog model downloads into the DATA dir and is selected, (3)
// whisper-local provider, (4) the bundled sample wav imported WITH its real
// .wav extension — the direct single-call path now preserves whisper's own
// segments, (5) media sidecar with whisper-true times, (6) time-anchored
// claim -> evidence.open locator, (7) transcript term over the source chunks,
// (8) interruption: ggml-base download killed mid-flight, restarted engine
// RESUMES from the on-disk partial (Range) and completes, (9) export +
// restore into a second engine.
await run("installed voice walkthrough", async () => {
  const sample = path.join(installDir, "resources", "samples", "notelm-audio-de.wav");
  if (!fs.existsSync(sample)) throw new Error(`bundled sample missing: ${sample}`);
  const FFMPEG = { FFMPEG_PATH: path.join(installDir, "resources", "ffmpeg", "ffmpeg.exe") };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-voice-"));
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-voice-export-"));
  const importDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-voice-import-"));
  let e1, e2;
  try {
    e1 = startInstalledEngine(dataDir, FFMPEG); // NOTELM_WHISPER_DIR stripped: app-managed only
    await e1.request("protocol.version", {});
    const nb = await e1.request("notebooks.create", { title: "Sprache" });

    // (1) runtime install: real network download of the pinned zip (~8 MB)
    // into <dataDir>/runtimes/whisper/v1.9.2, sha-verified before extraction
    const t0 = Date.now();
    const inst = await e1.request("runtimes.whisper", { action: "install" }, 300_000);
    const installSec = ((Date.now() - t0) / 1000).toFixed(1);
    if (!inst.installed || inst.version !== "v1.9.2" || !inst.path) {
      throw new Error(`runtime install unexpected: ${JSON.stringify(inst)}`);
    }
    const exe = path.join(inst.path, "whisper-cli.exe");
    if (!inst.path.startsWith(dataDir) || !fs.existsSync(exe)) {
      throw new Error(`runtime not under the DATA dir: ${exe}`);
    }
    const extractedBytes = (() => {
      let sum = 0;
      for (const f of fs.readdirSync(inst.path)) sum += fs.statSync(path.join(inst.path, f)).size;
      return sum;
    })();
    const st = await e1.request("runtimes.whisper", { action: "status" });
    if (!st.installed || st.path !== inst.path || st.partialBytes !== 0) {
      throw new Error(`status after install unexpected: ${JSON.stringify(st)}`);
    }
    console.log(`[voice] runtime installed in ${installSec}s, ${extractedBytes} bytes extracted under ${path.relative(dataDir, inst.path)}`);

    // (2) model from the catalog: real HF download into <dataDir>/models
    const { entries } = await e1.request("models.catalog", {});
    const tiny = entries.find((e) => e.id === "ggml-tiny");
    const t1 = Date.now();
    const dl = await e1.request("models.download", {
      url: tiny.url, fileName: "ggml-tiny.bin", capability: "transcriptions", sha256: tiny.sha256,
    }, 300_000);
    const tinySec = ((Date.now() - t1) / 1000).toFixed(1);
    if (dl.model.sha256 !== tiny.sha256) throw new Error(`tiny sha mismatch: ${JSON.stringify(dl.model)}`);
    const tinyFile = path.join(dataDir, "models", `${tiny.sha256}.bin`);
    if (!fs.existsSync(tinyFile)) throw new Error(`tiny not in data dir: ${tinyFile}`);
    await e1.request("models.selectTranscribe", { modelId: "ggml-tiny" });
    console.log(`[voice] ggml-tiny downloaded+selected in ${tinySec}s (${tiny.sizeBytes} bytes)`);

    // (3) the local transcribe capability, exactly as the UI saves it
    await e1.request("providers.save", {
      connection: { presetId: "whisper-local", label: "Auf diesem Computer (whisper.cpp)" },
      models: { transcribe: "ggml-tiny" },
    });

    // (4) import the bundled sample WITH its real .wav extension: 400 KB is
    // far under the 24 MB limit, so this exercises the DIRECT single-call
    // path — which must now carry whisper's own segments (S5 mandate C)
    const created = await e1.request("sources.importFile", {
      path: sample, notebookId: nb.id, fileName: "notelm-audio-de.wav", fileType: "audio/wav",
    });
    const sourceId = created.sourceId;
    await waitFor("audio import completed", async () => {
      const sources = await e1.request("sources.list", { notebookId: nb.id });
      return sources.find((s) => s._id === sourceId)?.status === "completed";
    }, 120_000);

    // (5) media sidecar with whisper-true times (startSec 0, endSec > 0)
    const [v1] = await e1.request("sources.listVersions", { sourceId });
    const opened = await e1.request("sources.open", { sourceId });
    if (opened.sidecarKind !== "media") {
      throw new Error(`expected media sidecar from the DIRECT path, got ${JSON.stringify(opened)}`);
    }
    const sidecar = JSON.parse(
      fs.readFileSync(path.join(dataDir, "files", "versions", `${v1.id}.json`), "utf8")
    );
    if (!Array.isArray(sidecar.segments) || sidecar.segments.length === 0) {
      throw new Error(`no whisper segments in sidecar: ${JSON.stringify(sidecar).slice(0, 200)}`);
    }
    if (sidecar.segments[0].startSec !== 0 || sidecar.segments[0].endSec <= 0) {
      throw new Error(`first segment not whisper-true: ${JSON.stringify(sidecar.segments[0])}`);
    }
    if (!(sidecar.segments.at(-1).endSec > 10)) {
      throw new Error(`last segment end suspiciously short: ${JSON.stringify(sidecar.segments.at(-1))}`);
    }
    console.log(`[voice] direct-path media sidecar: ${sidecar.segments.length} whisper segments, 0..${sidecar.segments.at(-1).endSec}s`);

    // (6) a claim anchored with a real time locator, resolved via evidence.open
    const claim = await e1.request("claims.create", {
      notebookId: nb.id,
      text: "Beispielzitat aus der Audioaufnahme.",
      anchors: [{ sourceId, locator: { startSec: 0, endSec: null } }],
    });
    if (claim.unresolved.length) throw new Error(`anchor unresolved: ${JSON.stringify(claim.unresolved)}`);
    const [claimRow] = await e1.request("claims.list", { notebookId: nb.id });
    const anchorId = claimRow.anchors[0].id;
    const evidence = await e1.request("evidence.open", { anchorId });
    if (evidence.locator?.startSec !== 0) {
      throw new Error(`evidence.open lost the locator: ${JSON.stringify(evidence)}`);
    }

    // (7) the transcript is retrievable content: the chunks carry the
    // transcript term (the rows searchHybrid's FTS reads — the engine has no
    // dedicated search op yet; deviation documented in the delivery report)
    const chunks = await e1.request("sources.chunks", { sourceId });
    const joined = chunks.map((c) => c.content).join(" ");
    if (!/Willkommen|Sprachaufnahme/.test(joined)) {
      throw new Error(`transcript term not found in chunks: ${joined.slice(0, 200)}`);
    }

    // (8) interruption: start ggml-base (~148 MB), kill the engine
    // mid-download, restart, download again -> RESUMES from the on-disk
    // partial (Range) and completes with the pinned sha
    const base = entries.find((e) => e.id === "ggml-base");
    const basePart = path.join(dataDir, "models", `${base.sha256}.bin.part`);
    const t2 = Date.now();
    e1.request("models.download", {
      url: base.url, fileName: "ggml-base.bin", capability: "transcriptions", sha256: base.sha256,
    }, 600_000).catch(() => {}); // will be killed; the restart retries
    await waitFor("base partial with bytes on disk", () => fs.existsSync(basePart) && fs.statSync(basePart).size > 1_000_000, 120_000);
    const resumedFrom = fs.statSync(basePart).size;
    killTree(e1.proc.pid);
    await e1.exited;
    console.log(`[voice] engine killed mid-download, partial on disk: ${resumedFrom} bytes`);
    e1 = startInstalledEngine(dataDir, FFMPEG);
    await e1.request("protocol.version", {});
    // proof of RESUME (not a from-scratch rewrite): poll the partial from
    // the instant the retry starts — an appending (206) download only ever
    // grows ABOVE resumedFrom, a rewriting (200) one drops back near 0
    const retry = e1.request("models.download", {
      url: base.url, fileName: "ggml-base.bin", capability: "transcriptions", sha256: base.sha256,
    }, 600_000);
    let minSeen = Infinity;
    const watchUntil = Date.now() + 3_000; // early window: a rewrite drops to ~0 fast
    while (Date.now() < watchUntil) {
      if (fs.existsSync(basePart)) minSeen = Math.min(minSeen, fs.statSync(basePart).size);
      await new Promise((r) => setTimeout(r, 100));
    }
    const baseOut = await retry;
    if (baseOut.model.sha256 !== base.sha256) throw new Error(`base sha mismatch after resume`);
    if (!fs.existsSync(path.join(dataDir, "models", `${base.sha256}.bin`))) {
      throw new Error("base model file missing after resumed download");
    }
    console.log(`[voice] resumed download completed in ${((Date.now() - t2) / 1000).toFixed(1)}s total; partial was >= ${minSeen} bytes right after retry (resumedFrom ${resumedFrom})`);
    if (minSeen < resumedFrom) {
      throw new Error(`download restarted from scratch instead of resuming: minSeen ${minSeen} < resumedFrom ${resumedFrom}`);
    }

    // (9) export + restore into a SECOND engine (fresh data dir, no whisper
    // anything): the media version + time-anchored claim ride along
    await e1.request("notebook.export", { notebookId: nb.id, targetDir: exportDir });
    e2 = startInstalledEngine(importDataDir, FFMPEG);
    await e2.request("protocol.version", {});
    const imported = await e2.request("notebook.import", { sourceDir: exportDir });
    const [iClaim] = await e2.request("claims.list", { notebookId: imported.notebookId });
    if (!iClaim?.anchors?.length || iClaim.anchors[0].locator?.startSec !== 0) {
      throw new Error(`restored claim lost the time locator: ${JSON.stringify(iClaim)}`);
    }
    const iSource = (await e2.request("sources.list", { notebookId: imported.notebookId }))
      .find((s) => s.fileType === "audio/wav");
    if (!iSource) throw new Error("restored notebook lost the audio source");
    const iOpened = await e2.request("sources.open", { sourceId: iSource._id });
    if (iOpened.sidecarKind !== "media") {
      throw new Error(`restored source lost the media sidecar: ${JSON.stringify(iOpened)}`);
    }

    await e1.stop();
    await e2.stop();
    assertNoInstalledEngineLeft();
  } finally {
    for (const e of [e1, e2]) if (e) killTree(e.proc.pid); // failure path: no orphans
    for (const dir of [dataDir, exportDir, importDataDir]) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp cleaner */ }
    }
  }
});

await run("uninstall + process teardown", () => {
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

// --- interruption/recovery gate helpers (slice 5) ---------------------------

/** Local HTTP server serving a large-ish HTML page as a slow drip (~5 s), so
 *  the gates can observe the "downloading" phase and kill the engine mid-run.
 *  Serves 206 partial content for Range requests so a crashed attempt resumes
 *  from its on-disk partial instead of restarting. */
async function startSlowHtmlServer() {
  const body = Buffer.from(
    `<html><head><title>Wiederherstellung</title></head><body><p>${"Inhalt fuer den Wiederherstellungstest. ".repeat(50_000)}</p></body></html>`
  );
  const etag = '"recovery-v1"';
  const server = http.createServer((req, res) => {
    const start = Number(/^bytes=(\d+)-$/.exec(req.headers.range ?? "")?.[1] ?? 0);
    const ranged = Number.isInteger(start) && start > 0 && start < body.length;
    const slice = ranged ? body.subarray(start) : body;
    res.writeHead(ranged ? 206 : 200, {
      "content-type": "text/html; charset=utf-8",
      etag,
      "accept-ranges": "bytes",
      "content-length": String(slice.length),
      ...(ranged && { "content-range": `bytes ${start}-${body.length - 1}/${body.length}` }),
    });
    let off = 0;
    const drip = () => {
      if (res.writableEnded || res.destroyed) return;
      if (off >= slice.length) {
        res.end();
        return;
      }
      res.write(slice.subarray(off, Math.min((off += 65536), slice.length)));
      setTimeout(drip, 150);
    };
    drip();
  });
  const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  return { server, url: `http://127.0.0.1:${port}/artikel` };
}

/** Local drip server for the walkthrough gate: one URL serves an HTML
 *  article whose content can be switched v1 -> v2 mid-gate (the SAME url
 *  re-imported must reuse the source row and append a version), a second
 *  serves a tiny CSV (content-type text/csv -> sheet sidecar). Range
 *  requests are answered so a killed download resumes from its partial. */
async function startWalkthroughServer() {
  const QUOTE = "Der Zinssatz betraegt 3,5 Prozent seit dem Beschluss.";
  let version = 1;
  const article = () =>
    version === 1
      ? Buffer.from(
          `<html><head><title>Beitrag</title></head><body><p>${QUOTE}</p><p>${"Erste Fassung mit Einleitung. ".repeat(120)}</p></body></html>`
        )
      : Buffer.from(
          `<html><head><title>Beitrag</title></head><body><p>Zweite Fassung ohne den alten Satz.</p><p>${"Zweite Fassung mit neuem Inhalt. ".repeat(50_000)}</p></body></html>`
        );
  const csv = Buffer.from("Produkt,Menge\nApfel,3\nBirne,5\n", "utf8");
  const send = (req, res, buf, contentType, etag) => {
    const start = Number(/^bytes=(\d+)-$/.exec(req.headers.range ?? "")?.[1] ?? 0);
    const ranged = Number.isInteger(start) && start > 0 && start < buf.length;
    const slice = ranged ? buf.subarray(start) : buf;
    res.writeHead(ranged ? 206 : 200, {
      "content-type": contentType,
      etag,
      "accept-ranges": "bytes",
      "content-length": String(slice.length),
      ...(ranged && { "content-range": `bytes ${start}-${buf.length - 1}/${buf.length}` }),
    });
    let off = 0;
    const drip = () => {
      if (res.writableEnded || res.destroyed) return;
      if (off >= slice.length) {
        res.end();
        return;
      }
      res.write(slice.subarray(off, Math.min((off += 65536), slice.length)));
      setTimeout(drip, 150);
    };
    drip();
  };
  const server = http.createServer((req, res) => {
    const p = req.url.split("?")[0];
    if (p.endsWith(".csv")) return send(req, res, csv, "text/csv", '"walkthrough-csv"');
    return send(req, res, article(), "text/html; charset=utf-8", version === 1 ? '"walkthrough-v1"' : '"walkthrough-v2"');
  });
  const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  return {
    server,
    articleUrl: `http://127.0.0.1:${port}/beitrag`,
    csvUrl: `http://127.0.0.1:${port}/zahlen.csv`,
    serveVersion2: () => { version = 2; },
  };
}

async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Spawn the INSTALLED engine (bundled node.exe + resources/engine/engine.cjs —
 * the same discovery the --smoke gate exercises through the app) on a temp
 * data dir and speak NDJSON over stdio (mirrors e2e/engine-stdio.e2e.test.ts).
 * extraEnv rides on top of the stripped clean-machine env (the audio
 * walkthrough uses it for NOTELM_WHISPER_DIR / FFMPEG_PATH, mirroring how the
 * Rust host points the engine at the bundled ffmpeg).
 */
function startInstalledEngine(dataDir, extraEnv = {}) {
  const nodeBin = path.join(installDir, "node.exe");
  const engineScript = path.join(installDir, "resources", "engine", "engine.cjs");
  for (const p of [nodeBin, engineScript]) {
    if (!fs.existsSync(p)) throw new Error(`installed engine missing: ${p}`);
  }
  const env = {
    ...process.env,
    PATH: STRIPPED_PATH, // the bundled runtime must not lean on the repo PATH
    NOTELM_DATA_DIR: dataDir,
    NODE_ENV: "production",
    INGEST_ALLOW_PRIVATE: "1", // the corpus URL server is on 127.0.0.1
  };
  // a clean install has no local-model env overrides: strip them so the
  // installed engine's capability resolution matches a fresh machine (the
  // walkthrough gate depends on chat.send honestly answering no_provider, the
  // voice walkthrough on the app-managed whisper runtime winning on its own)
  for (const k of ["NOTELM_LLAMA_DIR", "NOTELM_CHAT_MODEL", "NOTELM_EMBED_MODEL", "NOTELM_WHISPER_DIR"]) delete env[k];
  Object.assign(env, extraEnv);
  const proc = spawn(nodeBin, [engineScript], {
    stdio: ["pipe", "pipe", "inherit"],
    env,
  });
  let buffer = "";
  const pending = new Map();
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        entry.settle(msg);
      }
    }
  });
  const exited = exitedOf(proc);
  // a dead engine can never answer: settle everything pending so killed
  // mid-op requests (voice walkthrough interruption) don't hold timers alive
  proc.once("exit", () => {
    for (const [id, entry] of pending) {
      pending.delete(id);
      clearTimeout(entry.timer);
      entry.settle({ ok: false, error: { code: "engine_died", message: "engine process exited" } });
    }
  });
  let seq = 0;
  const request = (op, args, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      const id = `gate${++seq}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`engine op ${op} timed out`));
      }, timeoutMs);
      const settle = (msg) =>
        msg.ok ? resolve(msg.result) : reject(new Error(`engine op ${op} failed: ${msg.error?.code} ${msg.error?.message}`));
      pending.set(id, { settle, timer });
      proc.stdin.write(JSON.stringify({ id, op, args }) + "\n");
    });
  return { proc, request, exited, stop: () => stopEngine(proc) };
}

/** Graceful stop: stdin end (the engine's shutdown path), escalate hard after
 *  a grace period — the same escalation the Rust host does in engine.rs Drop. */
async function stopEngine(proc) {
  if (proc.exitCode === null && proc.signalCode === null) {
    proc.stdin.end();
    const won = await Promise.race([
      exitedOf(proc),
      new Promise((r) => setTimeout(() => r(false), 8_000)),
    ]);
    if (won === false) {
      try {
        execFileSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
      } catch { /* already gone */ }
      await exitedOf(proc);
    }
  } else {
    await exitedOf(proc);
  }
}
/** Resolves when the process is gone (or already is). Declared as a function
 *  (hoisted): the gates above run during module evaluation, before this line —
 *  a const arrow here would be a temporal-dead-zone ReferenceError. */
function exitedOf(proc) {
  return proc.exitCode !== null || proc.signalCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => proc.once("exit", () => resolve()));
}

/** Hard-kill the engine process tree, like a crash (taskkill /F). */
function killTree(pid) {
  try {
    execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
  } catch { /* process already gone — the exit wait below decides */ }
}

/** Poll until cond() returns true; throws with `what` on timeout. */
async function waitFor(what, cond, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** True when the job's partial dir exists and holds at least one file with
 *  bytes — the resumable-on-disk condition the recovery gate kills on. */
function partialHasBytes(partialDir) {
  try {
    return fs
      .readdirSync(partialDir)
      .some((f) => fs.statSync(path.join(partialDir, f)).size > 0);
  } catch {
    return false; // no dir yet
  }
}

/** Zero the lease column of in-flight import jobs on a second SQLite
 *  connection — the gate equivalent of fastForwardForTests (src/db/local/).
 *  Needed because a crashed import keeps its 10-minute lease, and the
 *  restarted engine must not have to wait it out for the gate to stay fast. */
function expireImportLeases(dataDir) {
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const db = new Database(path.join(dataDir, "notebook.sqlite"));
  try {
    db.prepare(
      `UPDATE import_jobs SET lease_expires_at = 0
       WHERE status IN ('inspecting','awaiting_selection','downloading','processing')`
    ).run();
  } finally {
    db.close();
  }
}

/** No installed-engine node.exe may survive the gates (scoped to our install
 *  dir so a concurrently running real app on this machine cannot false-fail). */
function assertNoInstalledEngineLeft() {
  const ps = execFileSync(
    "powershell",
    ["-Command", `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${installDir}*engine.cjs*' } | Measure-Object | Select-Object -ExpandProperty Count`],
    { encoding: "utf8" }
  ).trim();
  if (ps !== "0") throw new Error(`${ps} installed engine node.exe processes still running`);
}

function summary() {
  console.log("\n──── desktop verification ────");
  for (const [name, status, info] of steps) {
    console.log(`${status === "ok" ? " ✓" : " ✗"} ${name} — ${info}`);
  }
}
summary();
