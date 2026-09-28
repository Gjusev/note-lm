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
  tempPath: string | null;
  contentType: string;
  finalUrl: string;
  bytes: number;
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
 * Stream a plan to a temp file (bounded), then read it back. Byte limit,
 * timeout and redirects are enforced end-to-end; the temp file is always
 * removed by the caller via cleanup().
 */
export async function downloadPlan(plan: DownloadPlan, opts: { timeoutMs?: number } = {}): Promise<DownloadResult> {
  const maxBytes = MAX_BYTES[plan.expect];
  const { response, finalUrl } = await policyFetch(plan.url, {
    timeoutMs: opts.timeoutMs ?? 120_000,
    headers: plan.headers,
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

  const declared = Number(response.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    throw new ImportError("too_large", `Datei zu groß (${(declared / 1024 / 1024).toFixed(0)} MB > Limit)`);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nolm-import-"));
  const tempPath = path.join(tmpDir, "download.bin");
  let bytes = 0;
  try {
    const body = response.body;
    if (!body) throw new ImportError("bad_content", "Leere Antwort");
    const reader = body.getReader();
    const handle = await fs.open(tempPath, "w");
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          throw new ImportError("too_large", `Download überschreitet das Limit von ${Math.round(maxBytes / 1024 / 1024)} MB`);
        }
        await handle.write(value);
      }
    } finally {
      await handle.close();
    }
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true }).catch(() => {});
    throw err;
  }

  const buffer = await fs.readFile(tempPath);
  if (buffer.length === 0) {
    await fs.rm(tmpDir, { recursive: true }).catch(() => {});
    throw new ImportError("bad_content", "Leere Datei empfangen");
  }
  const contentType = resolveMime(plan, buffer, response.headers.get("content-type") || "");
  return { buffer, tempPath, contentType, finalUrl, bytes };
}

export async function cleanupDownload(result: DownloadResult): Promise<void> {
  if (result.tempPath) {
    await fs.rm(path.dirname(result.tempPath), { recursive: true }).catch(() => {});
  }
}
