// @vitest-environment node
/**
 * Local whisper.cpp transcription (managed runtime, delivery increment 1):
 * the curated catalog carries `transcribe` models, the `whisper-local`
 * preset resolves to a local TranscribeFn that never consults offline mode
 * and never falls back to a remote provider, and runWhisper speaks the REAL
 * whisper.cpp v1.9.2 JSON (transcription[].offsets ms) — probed against the
 * pinned binary. Remote mocking follows providers.test.ts: the OpenAI SDK is
 * the only mock; settings live in a real temp SQLite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/** sha256 of a Buffer (hex). */
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Payload served by the download test's local http server. */
const BODY = Buffer.from("fake whisper model body");

const execFileAsync = promisify(execFile);

// The network layer is mocked to prove the local path NEVER falls back remote.
const remote = vi.hoisted(() => ({ ctor: vi.fn() }));
vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(cfg: unknown) {
      remote.ctor(cfg);
    }
  },
}));

import { openLocalDb, closeLocalDb, type LocalDb } from "@/db/local";
import { getSetting, setSetting } from "@/lib/services/settings";
import { downloadModel, listModels } from "@/lib/services/models";
import { MODEL_CATALOG } from "@/lib/ai/model-catalog";
import { setOfflineMode } from "@/lib/ai/providers";
import { makeLocalTranscribe, parseWhisperJson, runWhisper } from "@/lib/ai/whisper";
import {
  installWhisperRuntime,
  whisperRuntimeDir,
  whisperRuntimeStatus,
} from "@/lib/ai/whisper-runtime";
import { WHISPER_TAG } from "@/lib/ai/whisper-pin.mjs";
import { resolveCapabilities, setCapabilitiesForTests } from "@/engine/capabilities";
import { getLocalContext } from "@/lib/storage/local";
import { createSource } from "@/lib/services/sources";
import { recordVersion, readVersionMediaSegments } from "@/lib/services/source-versions";
import { transcribeMedia } from "@/lib/ingestion/process";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const PROBE = path.join(REPO, ".probe-downloads");
const PINNED_FFMPEG = path.join(
  PROBE, "ffmpeg-n8.1.3-6-gff48edd8b2-win64-gpl-8.1", "bin", "ffmpeg.exe"
);
const REAL_WHISPER_DIR = path.join(PROBE, "whisper-bin");
const REAL_TINY_MODEL = path.join(PROBE, "ggml-tiny.bin");
const REAL_BASE_MODEL = path.join(PROBE, "ggml-base.bin");
// .NET Framework C# compiler — ships with Windows; used to build a native
// whisper-cli.exe fake (Node >= 18 refuses to spawn .cmd/.bat: EINVAL).
const CSC = "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe";

const realArtifacts = fs.existsSync(path.join(REAL_WHISPER_DIR, "whisper-cli.exe"))
  && fs.existsSync(REAL_TINY_MODEL)
  && fs.existsSync(PINNED_FFMPEG);
const fakeCompilerAvailable = process.platform === "win32" && fs.existsSync(CSC);

let dir: string;
let db: LocalDb;
const envSnapshot: Record<string, string | undefined> = {};
const setEnv = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeEach(async () => {
  for (const key of [
    "NOTELM_DATA_DIR", "NOTELM_ENGINE", "OPENAI_API_KEY",
    "NOTELM_LLAMA_DIR", "NOTELM_CHAT_MODEL", "NOTELM_EMBED_MODEL",
    "NOTELM_WHISPER_DIR", "FFMPEG_PATH", "FAKE_WHISPER_JSON", "FAKE_WHISPER_SLEEP_MS",
  ]) {
    envSnapshot[key] = process.env[key];
    delete process.env[key];
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-whisper-"));
  process.env.NOTELM_DATA_DIR = dir;
  process.env.FFMPEG_PATH = PINNED_FFMPEG;
  db = openLocalDb(dir);
  remote.ctor.mockClear();
  setCapabilitiesForTests(null);
});

afterEach(async () => {
  await setOfflineMode(db, false);
  setCapabilitiesForTests(null);
  const { closeLocalDb: closeCtx } = await import("@/db/local");
  closeCtx(getLocalContext().db);
  const g = globalThis as { __notelmCtx?: unknown };
  delete g.__notelmCtx;
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(envSnapshot)) setEnv(key, value);
});

/** Register a fake transcribe model: settings-tracked (like models.select)
 *  plus the sha-named file under <dataDir>/models. */
async function seedTranscribeModel(sha: string): Promise<void> {
  fs.mkdirSync(path.join(dir, "models"), { recursive: true });
  fs.writeFileSync(path.join(dir, "models", `${sha}.bin`), "fake model bytes");
  await setSetting(db, "ai.transcribeModel", {
    catalogId: "ggml-tiny", fileName: "ggml-tiny.bin", sha256: sha, sizeBytes: 77_691_713,
  });
}

/** whisper-local connection + per-capability selection, as the UI saves it. */
async function configureWhisperLocal(): Promise<void> {
  await setSetting(db, "ai.connections", [
    { id: "conn-whisper", presetId: "whisper-local", label: "Whisper lokal" },
  ]);
  await setSetting(db, "ai.capabilities", {
    transcribe: { connectionId: "conn-whisper", model: "ggml-tiny" },
  });
}

/**
 * Compile a native fake whisper-cli.exe (C# 5 — the .NET Framework compiler
 * understands nothing newer): verifies the `-f` input exists and starts with
 * a RIFF header (proves the ffmpeg wav conversion ran), sleeps when
 * FAKE_WHISPER_SLEEP_MS is set (abort teardown test) and copies the canned
 * JSON from FAKE_WHISPER_JSON next to the `-of` base.
 */
async function compileFakeWhisperCli(targetDir: string): Promise<void> {
  fs.mkdirSync(targetDir, { recursive: true });
  const source = path.join(targetDir, "fake.cs");
  await fs.promises.writeFile(source, `
using System;
using System.IO;
using System.Text;
using System.Threading;

class P {
  static int Main(string[] a) {
    string wav = null, jsonBase = null;
    for (int i = 0; i + 1 < a.Length; i++) {
      if (a[i] == "-f") wav = a[i + 1];
      if (a[i] == "-of") jsonBase = a[i + 1];
    }
    if (wav == null || !File.Exists(wav)) return 2;
    var hdr = new byte[4];
    using (var f = File.OpenRead(wav)) { if (f.Read(hdr, 0, 4) != 4) return 3; }
    if (Encoding.ASCII.GetString(hdr) != "RIFF") return 3;
    var sleepMs = Environment.GetEnvironmentVariable("FAKE_WHISPER_SLEEP_MS");
    if (sleepMs != null) Thread.Sleep(int.Parse(sleepMs));
    var canned = Environment.GetEnvironmentVariable("FAKE_WHISPER_JSON");
    if (canned == null) return 4;
    File.WriteAllText(jsonBase + ".json", File.ReadAllText(canned), new UTF8Encoding(false));
    return 0;
  }
}
`);
  await execFileAsync(CSC, ["-nologo", "-out:whisper-cli.exe", "fake.cs"], { cwd: targetDir });
}

/** 0.5 s 440 Hz sine as mp3 (pinned ffmpeg, like the media pipeline). */
async function makeToneMp3(outPath: string): Promise<Buffer> {
  await execFileAsync(PINNED_FFMPEG, [
    "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
    "-ar", "16000", "-ac", "1", "-b:a", "96k", outPath,
  ], { timeout: 30_000 });
  return fs.promises.readFile(outPath);
}

const CANNED = JSON.stringify({
  transcription: [{ offsets: { from: 0, to: 500 }, text: " Fake-Antwort." }],
  result: { language: "de" },
});

describe("whisper model catalog", () => {
  it("carries tiny + base transcribe models with verified HF hashes", () => {
    const tiny = MODEL_CATALOG.find((m) => m.id === "ggml-tiny");
    const base = MODEL_CATALOG.find((m) => m.id === "ggml-base");
    expect(tiny).toMatchObject({
      capability: "transcribe",
      sizeBytes: 77_691_713,
      license: "MIT",
      url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
      sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
    });
    expect(base).toMatchObject({
      capability: "transcribe",
      sizeBytes: 147_951_465,
      license: "MIT",
      url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
      sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    });
    expect(tiny!.notes).toContain("tiny");
    expect(base!.notes).toContain("base");
  });

  it("downloadModel(transcriptions) stores the file + settings, no models-table row", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-length": BODY.length });
      res.end(BODY);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ggml-tiny.bin`;
    try {
      const { dataDir } = getLocalContext();
      const model = await downloadModel(db, dataDir, {
        url,
        capability: "transcriptions",
        fileName: "ggml-tiny.bin",
        sha256: sha256(BODY),
      });
      expect(model.capability).toBe("transcriptions");
      expect(fs.existsSync(path.join(dir, "models", `${sha256(BODY)}.bin`))).toBe(true);
      const saved = await getSetting<{ sha256: string }>(db, "ai.transcribeModel");
      expect(saved?.sha256).toBe(sha256(BODY));
      // the models table (CHECK covers chat/embeddings) stays untouched
      expect(listModels(db)).toHaveLength(0);
    } finally {
      server.close();
    }
  });
});

describe("whisper-local resolution", () => {
  it("resolves an explicit whisper-local config to a local transcriber with a German label", async () => {
    await compileFakeWhisperCli(path.join(dir, "whisper"));
    process.env.NOTELM_WHISPER_DIR = path.join(dir, "whisper");
    await seedTranscribeModel("a".repeat(64));
    await configureWhisperLocal();

    const caps = await resolveCapabilities(db);
    expect(caps.transcribe).toBeTypeOf("function");
    expect(caps.transcribeProvider).toEqual({
      kind: "local", label: "Auf diesem Computer · whisper ggml-tiny",
    });
    expect(caps.transcribeReason).toBeUndefined();
  });

  it("offline mode does NOT block the local transcriber and there is no remote fallback", async () => {
    await compileFakeWhisperCli(path.join(dir, "whisper"));
    process.env.NOTELM_WHISPER_DIR = path.join(dir, "whisper");
    await seedTranscribeModel("a".repeat(64));
    await configureWhisperLocal();
    process.env.FAKE_WHISPER_JSON = path.join(dir, "canned.json");
    fs.writeFileSync(process.env.FAKE_WHISPER_JSON, CANNED);

    const mp3 = await makeToneMp3(path.join(dir, "tone.mp3"));
    await setOfflineMode(db, true);
    const caps = await resolveCapabilities(db);
    const out = await caps.transcribe!(mp3, "seg000.mp3");
    expect(out.text).toBe("Fake-Antwort.");
    // no remote fallback: the mocked SDK was never constructed
    expect(remote.ctor).not.toHaveBeenCalled();
  });

  it("reports a typed German reason when the whisper runtime is missing", async () => {
    await seedTranscribeModel("a".repeat(64));
    await configureWhisperLocal();
    const caps = await resolveCapabilities(db);
    expect(caps.transcribe).toBeNull();
    expect(caps.transcribeReason).toMatch(/Whisper-Programm/);
  });

  it("reports a typed German reason when the model file was not downloaded", async () => {
    await compileFakeWhisperCli(path.join(dir, "whisper"));
    process.env.NOTELM_WHISPER_DIR = path.join(dir, "whisper");
    await configureWhisperLocal(); // no ai.transcribeModel selection yet
    const caps = await resolveCapabilities(db);
    expect(caps.transcribe).toBeNull();
    expect(caps.transcribeReason).toMatch(/heruntergeladen/);
  });

  it("resolves the app-managed runtime dir first — env is only a dev fallback", async () => {
    // managed runtime under the DATA dir (as runtimes.whisper install lays it
    // out); NOTELM_WHISPER_DIR points nowhere — the managed dir must win
    const managed = whisperRuntimeDir(dir);
    fs.mkdirSync(managed, { recursive: true });
    fs.writeFileSync(path.join(managed, "whisper-cli.exe"), "MZ");
    process.env.NOTELM_WHISPER_DIR = path.join(dir, "does-not-exist");
    await seedTranscribeModel("a".repeat(64));
    await configureWhisperLocal();

    const caps = await resolveCapabilities(db);
    expect(caps.transcribe).toBeTypeOf("function");
    expect(caps.transcribeReason).toBeUndefined();
  });
});

describe("whisper runtime install (app-managed, S5)", () => {
  /** Real zip (bsdtar) nested under Release/ like the release asset. */
  async function makeRuntimeZip(outPath: string): Promise<Buffer> {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), "nolm-zip-"));
    try {
      fs.mkdirSync(path.join(stage, "Release"), { recursive: true });
      fs.writeFileSync(path.join(stage, "Release", "whisper-cli.exe"), "MZ fake exe");
      fs.writeFileSync(path.join(stage, "Release", "ggml.dll"), "fake dll bytes");
      await execFileAsync("C:/Windows/System32/tar.exe", ["-a", "-cf", outPath, "Release"], {
        cwd: stage,
      });
      return fs.promises.readFile(outPath);
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }

  /** Local server serving the zip (counts hits; no Range needed for units). */
  function serveZip(body: Buffer) {
    const hits = { n: 0 };
    const server = http.createServer((req, res) => {
      hits.n += 1;
      res.writeHead(200, { "content-length": body.length });
      res.end(body);
    });
    return {
      hits,
      start: () => new Promise<void>((r) => server.listen(0, "127.0.0.1", r)),
      url: () => `http://127.0.0.1:${(server.address() as AddressInfo).port}/whisper-bin-x64.zip`,
      // closeAllConnections first: undici's keep-alive socket would keep a
      // plain close() pending past the test timeout
      close: () => {
        server.closeAllConnections();
        return new Promise<void>((r) => server.close(() => r()));
      },
    };
  }

  it("status: not installed on a fresh data dir, version from the pin", () => {
    const st = whisperRuntimeStatus(dir);
    expect(st).toEqual({ installed: false, version: WHISPER_TAG, path: null, partialBytes: 0 });
    expect(WHISPER_TAG).toBe("v1.9.2");
  });

  it("install: downloads, sha-verifies BEFORE extraction, flattens Release/, promotes atomically", async () => {
    const zip = path.join(dir, "runtime.zip");
    const body = await makeRuntimeZip(zip);
    const srv = serveZip(body);
    await srv.start();
    try {
      const out = await installWhisperRuntime(dir, { url: srv.url(), sha256: sha256(body) });
      expect(out.installed).toBe(true);
      expect(out.version).toBe(WHISPER_TAG);
      const target = whisperRuntimeDir(dir);
      expect(out.path).toBe(target);
      // exe + DLL at TOP level (Release/ flattened, fetch-whisper pattern)
      expect(fs.existsSync(path.join(target, "whisper-cli.exe"))).toBe(true);
      expect(fs.existsSync(path.join(target, "ggml.dll"))).toBe(true);
      expect(fs.existsSync(path.join(target, "Release"))).toBe(false);
      // the data dir stays lean: zip + partial + tmp are gone
      expect(fs.readdirSync(path.join(dir, "runtimes", "whisper")).sort()).toEqual([WHISPER_TAG]);
      // status agrees
      expect(whisperRuntimeStatus(dir)).toMatchObject({ installed: true, path: target });
      // idempotent: a second install does not hit the server again
      const again = await installWhisperRuntime(dir, { url: srv.url(), sha256: sha256(body) });
      expect(again.installed).toBe(true);
      expect(srv.hits.n).toBe(1);
    } finally {
      await srv.close();
    }
  });

  it("install: a sha mismatch deletes the partial and installs nothing", async () => {
    const srv = serveZip(Buffer.from("corrupt bytes"));
    await srv.start();
    try {
      await expect(
        installWhisperRuntime(dir, { url: srv.url(), sha256: "0".repeat(64) })
      ).rejects.toThrow(/SHA-256/);
      const st = whisperRuntimeStatus(dir);
      expect(st.installed).toBe(false);
      expect(st.partialBytes).toBe(0); // bad partial removed
      expect(fs.existsSync(whisperRuntimeDir(dir))).toBe(false);
    } finally {
      await srv.close();
    }
  });

  it("runtimes.whisper op: status + install + typed bad_args", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const bad = await handleEngineRequest("runtimes.whisper", {});
    expect(bad).toEqual({ ok: false, error: { code: "bad_args", message: expect.any(String) } });

    const zip = path.join(dir, "runtime.zip");
    const body = await makeRuntimeZip(zip);
    const srv = serveZip(body);
    await srv.start();
    try {
      const st = await handleEngineRequest("runtimes.whisper", { action: "status" });
      expect(st).toEqual({
        ok: true,
        result: { installed: false, version: WHISPER_TAG, path: null, partialBytes: 0 },
      });
    } finally {
      await srv.close();
    }
    // the op's install path always uses the PINNED url+sha — proven end to end
    // against the real release server by the installed voice walkthrough gate
    // (scripts/desktop-verify.mjs), not re-mocked here.
  });
});

describe("runWhisper", () => {
  it("parses the real v1.9.2 JSON shape (fixture from a real tiny-model run)", () => {
    const raw = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "whisper-jfk-v1.9.2.json"), "utf8");
    const out = parseWhisperJson(raw);
    expect(out.language).toBe("en");
    expect(out.segments).toEqual([{
      startSec: 0,
      endSec: 10.5,
      text: "And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country.",
    }]);
    expect(out.text).toBe("And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country.");
  });

  it("maps empty output (silence) to empty text with an empty segment list", () => {
    const out = parseWhisperJson(JSON.stringify({ result: { language: "en" }, transcription: [] }));
    expect(out).toEqual({ text: "", segments: [], language: "en" });
  });

  it("rejects with the stderr tail when the cli exits non-zero", async () => {
    await compileFakeWhisperCli(path.join(dir, "whisper"));
    const wav = path.join(dir, "missing.wav");
    await expect(runWhisper({
      whisperDir: path.join(dir, "whisper"),
      modelPath: path.join(dir, "no-model.bin"),
      wavPath: wav,
    })).rejects.toThrow(/whisper/i);
  });

  it("aborts a hung run and tears the process tree down", async () => {
    await compileFakeWhisperCli(path.join(dir, "whisper"));
    process.env.FAKE_WHISPER_SLEEP_MS = "10000";
    const wav = path.join(dir, "tone.wav");
    // RIFF header so the fake passes its own input check before sleeping
    fs.writeFileSync(wav, Buffer.concat([Buffer.from("RIFF....WAVE"), Buffer.alloc(64)]));
    const ac = new AbortController();
    const t0 = Date.now();
    const run = runWhisper({
      whisperDir: path.join(dir, "whisper"),
      modelPath: path.join(dir, "m.bin"),
      wavPath: wav,
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 150);
    await expect(run).rejects.toThrow(/abgebrochen|abort/i);
    expect(Date.now() - t0).toBeLessThan(5000);
    // the tree-kill lands asynchronously on Windows: try to remove the fake
    // exe dir now so afterEach's rmSync does not race a lingering lock
    // (bounded, never hangs)
    for (let i = 0; i < 50; i++) {
      try {
        fs.rmSync(path.join(dir, "whisper"), { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });
});

describe("makeLocalTranscribe (factory over real ffmpeg + fake cli)", () => {
  it("converts the mp3 segment to a 16k wav, runs whisper and records the run", async () => {
    await compileFakeWhisperCli(path.join(dir, "whisper"));
    process.env.NOTELM_WHISPER_DIR = path.join(dir, "whisper");
    process.env.FAKE_WHISPER_JSON = path.join(dir, "canned.json");
    fs.writeFileSync(process.env.FAKE_WHISPER_JSON, CANNED);
    const mp3 = await makeToneMp3(path.join(dir, "tone.mp3"));

    const transcribe = makeLocalTranscribe(db, {
      whisperDir: path.join(dir, "whisper"),
      modelPath: path.join(dir, "ggml-tiny.bin"),
      model: "ggml-tiny",
    });
    const out = await transcribe(mp3, "seg000.mp3");
    expect(out.text).toBe("Fake-Antwort.");

    const { providerRuns } = await import("@/db/local/schema");
    const rows = db.select().from(providerRuns).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      capability: "transcribe", provider: "whisper-local", model: "ggml-tiny", ok: 1,
    });
    expect(rows[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("records a failed run (ok=0) when ffmpeg cannot decode the input", async () => {
    await compileFakeWhisperCli(path.join(dir, "whisper"));
    const transcribe = makeLocalTranscribe(db, {
      whisperDir: path.join(dir, "whisper"),
      modelPath: path.join(dir, "ggml-tiny.bin"),
      model: "ggml-tiny",
    });
    await expect(transcribe(Buffer.from("not audio at all"), "seg000.mp3")).rejects.toThrow();
    const { providerRuns } = await import("@/db/local/schema");
    const rows = db.select().from(providerRuns).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ capability: "transcribe", provider: "whisper-local", ok: 0 });
  });
});

describe("direct-path media segments (real binary + real wav, artifact-gated)", () => {
  // fixture: 25 s German SAPI sample copied from eval/audio-proto/samples
  // (probed with the pinned tiny model: 4 segments, first offset 0, last end
  // 24.72 s, language de)
  const FIXTURE = path.join(import.meta.dirname, "fixtures", "de-zahlen.wav");
  const fixtureReady = realArtifacts && fs.existsSync(FIXTURE);

  it.skipIf(!fixtureReady)(
    "a small wav goes through the DIRECT single call and still yields whisper-true segments + a media sidecar",
    async () => {
      const { db, store } = getLocalContext();
      const audio = fs.readFileSync(FIXTURE);
      expect(audio.length).toBeLessThanOrEqual(24 * 1024 * 1024); // direct path

      // the exact factory the whisper-local capability resolves
      const transcribe = makeLocalTranscribe(db, {
        whisperDir: REAL_WHISPER_DIR,
        modelPath: REAL_TINY_MODEL,
        model: "ggml-tiny",
      });
      // fileName carries the REAL .wav extension — the direct branch must take it
      const out = await transcribeMedia(audio, "de-zahlen.wav", transcribe);
      expect(out.text).toContain("Prozent");
      expect(out.segments.length).toBeGreaterThanOrEqual(3);
      expect(out.segments[0].startSec).toBe(0); // whisper's own first offset
      expect(out.segments.at(-1)!.endSec).toBeGreaterThan(20);
      for (const s of out.segments) expect(s.endSec).toBeGreaterThan(s.startSec);

      // the sidecar becomes {kind:'media'} — no pages fallback
      const { createNotebook } = await import("@/lib/services/notebooks");
      const notebookId = await createNotebook(db, { ownerId: "local", title: "Direkt" });
      const sourceId = await createSource(db, {
        ownerId: "local", notebookId, fileName: "de-zahlen.wav",
        fileType: "audio/wav", fileSize: audio.length,
      });
      const version = await recordVersion(db, store, { sourceId, mediaSegments: out.segments });
      const sidecar = await readVersionMediaSegments(store, version.id);
      expect(sidecar).toEqual(out.segments);
    }
  );
});

describe("whisper.cpp real binary (artifact-gated)", () => {
  it.skipIf(!realArtifacts)(
    "transcribes with the pinned v1.9.2 build + ggml-tiny (silence → parseable empty output)",
    async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nolm-whisper-smoke-"));
      try {
        const wav = path.join(tmp, "tone.wav");
        await execFileAsync(PINNED_FFMPEG, [
          "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
          "-ar", "16000", "-ac", "1", wav,
        ], { timeout: 30_000 });
        const out = await runWhisper({
          whisperDir: REAL_WHISPER_DIR,
          modelPath: REAL_TINY_MODEL,
          wavPath: wav,
          timeoutMs: 120_000,
        });
        // shape correct, process ran, JSON parsed — silence yields no segments
        expect(Array.isArray(out.segments)).toBe(true);
        expect(out.text).toBe("");
        expect(typeof out.language).toBe("string");
        expect(out.language!.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(!realArtifacts || !fs.existsSync(REAL_BASE_MODEL))(
    "ggml-base also loads and runs (hash-recorded artifact check)",
    async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nolm-whisper-smoke2-"));
      try {
        const wav = path.join(tmp, "tone.wav");
        await execFileAsync(PINNED_FFMPEG, [
          "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
          "-ar", "16000", "-ac", "1", wav,
        ], { timeout: 30_000 });
        const out = await runWhisper({
          whisperDir: REAL_WHISPER_DIR,
          modelPath: REAL_BASE_MODEL,
          wavPath: wav,
          timeoutMs: 120_000,
        });
        expect(typeof out.language).toBe("string");
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
  );
});
