import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { policyFetch } from "./network-policy";
import { DownloadPlan, ImportError } from "./types";

export const MAX_BYTES: Record<string, number> = {
  html: (parseInt(process.env.INGEST_MAX_HTML_MB || "5")) * 1024 * 1024,
  document: (parseInt(process.env.INGEST_MAX_DOC_MB || "25")) * 1024 * 1024,
  audio: (parseInt(process.env.INGEST_MAX_AUDIO_MB || "150")) * 1024 * 1024,
  video: (parseInt(process.env.INGEST_MAX_VIDEO_MB || "250")) * 1024 * 1024,
};

export interface DownloadResult {
  buffer: Buffer;
  /** null in resume mode: the engine owns the .part file lifecycle */
  tempPath: string | null;
  contentType: string;
  finalUrl: string;
  bytes: number;
  /** true when a stale partial was discarded (validators changed / no Range support) and the download restarted from zero */
  restarted: boolean;
  /** Response validators, persisted with the checkpoint so a later resume can detect a changed file. */
  etag: string | null;
  lastModified: string | null;
}

/**
 * Resume state for a partially downloaded file (desktop-workers-plan 3b).
 * The partial lives under <dataDir>/tmp/jobs/<jobId>/ — never os.tmpdir —
 * so it survives an app restart.
 */
export interface DownloadResume {
  /** Absolute path of the .part file to (re)write. */
  partPath: string;
  /** Bytes already present on disk; sent as the Range start (0 = fresh). */
  bytesDone: number;
  /** Validators recorded with the checkpoint; a 206 must match them. */
  etag?: string | null;
  lastModified?: string | null;
}

/** Progress of the raw byte stream, called per flushed chunk (batch boundaries are the caller's concern). */
export interface DownloadProgress {
  (bytes: number, validators: { etag: string | null; lastModified: string | null }): void;
}

/** Content sniffing: type comes from magic bytes, not from the extension or headers alone. */
export function sniffMime(buffer: Buffer): string | null {
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "%PDF") return "application/pdf";
  if (buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return "audio/mpeg";
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfb) return "audio/mpeg";
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "fLaC") return "audio/flac";
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "OggS") return "audio/ogg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE")
    return "audio/wav";
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3)
    return "video/webm"; // EBML (webm/mkv)
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") return "video/mp4"; // mp4/m4a/mov
  return null;
}

export function looksLikeHtml(buffer: Buffer): boolean {
  const head = buffer.toString("ascii", 0, Math.min(buffer.length, 512)).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head");
}

function resolveMime(plan: DownloadPlan, buffer: Buffer, contentType: string): string {
  if (looksLikeHtml(buffer)) {
    if (plan.expect !== "html") {
      throw new ImportError(
        "bad_content",
        "HTML-Seite erhalten statt der erwarteten Datei — Quelle wird nicht als Transkript gespeichert"
      );
    }
    return "text/html";
  }
  const sniffed = sniffMime(buffer);
  if (sniffed) return sniffed;
  const base = contentType.split(";")[0].trim().toLowerCase();
  if (base && base !== "application/octet-stream") return base;
  throw new ImportError("bad_content", `Unbekannter Inhaltstyp: ${contentType || "leer"}`);
}

/**
 * Stream a plan to disk (bounded), then read it back. Byte limit, timeout and
 * redirects are enforced end-to-end. With a `resume` state the bytes go into
 * the given .part file: `bytesDone > 0` sends `Range: bytes=N-` and appends
 * the 206 remainder (only when the checkpoint validators still match —
 * otherwise the stale partial is deleted and the download restarts from zero,
 * reported as `restarted: true`). Without resume it uses a throwaway temp dir
 * the caller removes via cleanup(). The part file itself is owned by the
 * caller (engine keeps it across pause/restart, deletes it on terminal states).
 */
export async function downloadPlan(
  plan: DownloadPlan,
  opts: { timeoutMs?: number; resume?: DownloadResume; onProgress?: DownloadProgress } = {}
): Promise<DownloadResult> {
  const maxBytes = MAX_BYTES[plan.expect];
  const resume = opts.resume;
  const headers: Record<string, string> = { ...plan.headers };
  if (resume && resume.bytesDone > 0) headers.Range = `bytes=${resume.bytesDone}-`;

  const { response, finalUrl } = await policyFetch(plan.url, {
    timeoutMs: opts.timeoutMs ?? 120_000,
    headers,
  });

  if (!response.ok) {
    if (response.status === 429) {
      const ra = response.headers.get("retry-after");
      const retryAfterMs = ra && /^\d+$/.test(ra) ? Number(ra) * 1000 : undefined;
      throw new ImportError("rate_limited", `HTTP 429 von der Quelle`, { transient: true, retryAfterMs });
    }
    if (response.status === 404 || response.status === 410) {
      throw new ImportError("unavailable", `Ressource nicht verfügbar (HTTP ${response.status})`);
    }
    throw new ImportError("network", `HTTP ${response.status} von der Quelle`, { transient: response.status >= 500 });
  }

  // Resume negotiation: only append when the server confirmed the range (206)
  // AND the validators recorded with the checkpoint still match. A plain 200
  // means the server ignored Range — the only safe move is restarting.
  // bytesDone === 0 is a fresh download, not a resume attempt.
  let startBytes = 0;
  let restarted = false;
  if (resume && resume.bytesDone > 0) {
    const etagOk = resume.etag == null || response.headers.get("etag") === resume.etag;
    const lmOk = resume.lastModified == null || response.headers.get("last-modified") === resume.lastModified;
    if (response.status === 206 && etagOk && lmOk) {
      startBytes = resume.bytesDone;
    } else {
      await fs.rm(resume.partPath, { force: true }).catch(() => {});
      restarted = true;
    }
  }

  const declared = Number(response.headers.get("content-length") || 0);
  if (declared && startBytes + declared > maxBytes) {
    throw new ImportError("too_large", `Datei zu groß (${(declared / 1024 / 1024).toFixed(0)} MB > Limit)`);
  }

  const validators = { etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };

  let tmpDir: string | null = null;
  let targetPath: string;
  let bytes = startBytes;
  try {
    const body = response.body;
    if (!body) throw new ImportError("bad_content", "Leere Antwort");
    let handle;
    if (resume) {
      targetPath = resume.partPath;
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      handle = await fs.open(targetPath, startBytes > 0 ? "a" : "w");
    } else {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nolm-import-"));
      targetPath = path.join(tmpDir, "download.bin");
      handle = await fs.open(targetPath, "w");
    }
    try {
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          throw new ImportError("too_large", `Download überschreitet das Limit von ${Math.round(maxBytes / 1024 / 1024)} MB`);
        }
        await handle.write(value);
        opts.onProgress?.(bytes, validators);
      }
    } finally {
      await handle.close();
    }
  } catch (err) {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true }).catch(() => {});
    throw err;
  }

  const buffer = await fs.readFile(targetPath);
  if (buffer.length === 0) {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true }).catch(() => {});
    throw new ImportError("bad_content", "Leere Datei empfangen");
  }
  const contentType = resolveMime(plan, buffer, response.headers.get("content-type") || "");
  return {
    buffer,
    tempPath: tmpDir ? targetPath : null, // resume mode: the engine owns the part file
    contentType,
    finalUrl,
    bytes: buffer.length,
    restarted,
    etag: validators.etag,
    lastModified: validators.lastModified,
  };
}

export async function cleanupDownload(result: DownloadResult): Promise<void> {
  if (result.tempPath) {
    await fs.rm(path.dirname(result.tempPath), { recursive: true }).catch(() => {});
  }
}
