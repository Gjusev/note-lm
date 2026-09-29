/**
 * App-managed whisper.cpp runtime (delivery increment 5, engine half): the
 * `runtimes.whisper` engine op downloads the PINNED zip (whisper-pin.mjs —
 * the same constants scripts/fetch-whisper.mjs uses) into
 * <dataDir>/runtimes/whisper/<tag>/, so the runtime comes FROM THE APP's own
 * data dir, never from an evaluator's checkout. Resumable download (Range,
 * downloadModel's pattern), sha256 verify BEFORE extraction, extraction via
 * C:/Windows/System32/tar.exe (bsdtar ships with Windows — spawn, no
 * dependency), atomic promote (tmp dir + rename).
 *
 * Progress reporting: deliberately NOT job-queue events — install() resolves
 * when done and the UI polls `runtimes.whisper status` (partialBytes grows).
 * Documented mandate choice; no new queue is built here.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WHISPER_TAG, WHISPER_ZIP_SHA256, whisperZipUrl } from "./whisper-pin.mjs";

const TAR = "C:/Windows/System32/tar.exe";

/** Install target: <dataDir>/runtimes/whisper/<tag> (exe + DLLs at top level). */
export function whisperRuntimeDir(dataDir: string): string {
  return path.join(dataDir, "runtimes", "whisper", WHISPER_TAG);
}

export interface WhisperRuntimeStatus {
  installed: boolean;
  version: string;
  /** Absolute runtime dir, only when installed. */
  path: string | null;
  /** Bytes of the resumable download partial already on disk (0 = none). */
  partialBytes: number;
}

export function whisperRuntimeStatus(dataDir: string): WhisperRuntimeStatus {
  const dir = whisperRuntimeDir(dataDir);
  const installed = fs.existsSync(path.join(dir, "whisper-cli.exe"));
  const part = path.join(dataDir, "runtimes", "whisper", `${WHISPER_TAG}.zip.part`);
  return {
    installed,
    version: WHISPER_TAG,
    path: installed ? dir : null,
    partialBytes: fs.existsSync(part) ? fs.statSync(part).size : 0,
  };
}

// ponytail: single-flight guard, not a queue — concurrent install calls share
// one download; per-install progress events would need the real job queue.
let inFlight: Promise<WhisperRuntimeStatus & { installed: true }> | null = null;

/** sha256 of a file, streamed (same shape as services/models hashFile). */
function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/**
 * Install (or confirm) the pinned whisper.cpp runtime under the data dir.
 * Idempotent: an existing whisper-cli.exe returns immediately. `opts` exists
 * for tests (local server + its own digest); the engine op always uses the
 * pinned URL + sha.
 */
export async function installWhisperRuntime(
  dataDir: string,
  opts?: { url?: string; sha256?: string }
): Promise<WhisperRuntimeStatus & { installed: true }> {
  if (whisperRuntimeStatus(dataDir).installed) {
    return { ...whisperRuntimeStatus(dataDir), installed: true };
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const root = path.join(dataDir, "runtimes", "whisper");
    fs.mkdirSync(root, { recursive: true });
    const zipPath = path.join(root, `${WHISPER_TAG}.zip`);
    const part = `${zipPath}.part`;
    if (!fs.existsSync(zipPath)) {
      // resumable download (downloadModel's Range pattern)
      let downloaded = fs.existsSync(part) ? fs.statSync(part).size : 0;
      const headers: Record<string, string> = {};
      if (downloaded > 0) headers["Range"] = `bytes=${downloaded}-`;
      const res = await fetch(opts?.url ?? whisperZipUrl(), { headers });
      if (!res.ok && res.status !== 206) {
        throw new Error(`Download fehlgeschlagen: ${res.status}`);
      }
      const stream = fs.createWriteStream(part, {
        flags: downloaded > 0 && res.status === 206 ? "a" : "w",
      });
      const reader = res.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        downloaded += value.byteLength;
        await new Promise<void>((resolve, reject) => {
          stream.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
        });
      }
      await new Promise<void>((resolve) => stream.end(resolve));
      // verify BEFORE extraction — a corrupt zip must never become a runtime
      const actual = await hashFile(part);
      if (actual !== (opts?.sha256 ?? WHISPER_ZIP_SHA256)) {
        await fs.promises.rm(part, { force: true });
        throw new Error(`SHA-256 stimmt nicht: ${actual}`);
      }
      // a verified zip on disk: a crash before extraction retries without
      // re-downloading
      await fs.promises.rename(part, zipPath);
    }
    // extract into a tmp dir, flatten the Release/ nesting, promote atomically
    const tmp = path.join(root, `.tmp-${WHISPER_TAG}`);
    await fs.promises.rm(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    // stdio ignore: after an undici fetch, piped child stdio can wedge in
    // test workers (observed Node 24/Windows); tar needs no output here, and
    // spawn (not execFile) is the typed way to control stdio
    await new Promise<void>((resolve, reject) => {
      const child = spawn(TAR, ["-xf", zipPath, "-C", tmp], {
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`tar -xf fehlgeschlagen (${code})`))
      );
    });
    const nested = path.join(tmp, "Release");
    if (fs.existsSync(nested)) {
      for (const entry of fs.readdirSync(nested)) {
        fs.renameSync(path.join(nested, entry), path.join(tmp, entry));
      }
      fs.rmdirSync(nested);
    }
    if (!fs.existsSync(path.join(tmp, "whisper-cli.exe"))) {
      throw new Error("whisper-cli.exe fehlt im entpackten Archiv");
    }
    await fs.promises.rm(whisperRuntimeDir(dataDir), { recursive: true, force: true });
    await fs.promises.rename(tmp, whisperRuntimeDir(dataDir));
    await fs.promises.rm(zipPath, { force: true }); // keep the data dir lean
    return { ...whisperRuntimeStatus(dataDir), installed: true };
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
