import { IdentifiedResource, ImportError, ProviderId, ResourceKind } from "./types";

/**
 * Local URL classification, no network. Host matching is exact (no substring
 * tricks) so look-alike domains are never treated as official.
 */

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const DIRECT_FILE_EXTENSIONS: Record<string, ResourceKind> = {
  pdf: "document",
  txt: "document",
  md: "document",
  markdown: "document",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  aac: "audio",
  ogg: "audio",
  oga: "audio",
  flac: "audio",
  opus: "audio",
  weba: "audio",
  mp4: "video",
  m4v: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
};

function youtubeVideoId(url: URL): string | null {
  if (url.hostname === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && YOUTUBE_ID.test(id) ? id : null;
  }
  const v = url.searchParams.get("v");
  if (v && YOUTUBE_ID.test(v)) return v;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 2 && ["shorts", "live", "embed", "v"].includes(parts[0]) && YOUTUBE_ID.test(parts[1])) {
    return parts[1];
  }
  return null;
}

export function classifyUrl(rawUrl: string): IdentifiedResource {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImportError("unrecognized_url", "Ungültige URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ImportError("unrecognized_url", "Nur HTTP/HTTPS-URLs werden unterstützt");
  }

  const host = url.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(host)) {
    const videoId = youtubeVideoId(url);
    if (!videoId) {
      throw new ImportError(
        "unsupported",
        "YouTube-Link erkannt, aber kein einzelnes Video (Playlists/Kanäle werden noch nicht unterstützt)"
      );
    }
    return {
      provider: "youtube",
      kind: "video",
      resourceKey: `youtube:video:${videoId}`,
      originalUrl: rawUrl,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      externalId: videoId,
    };
  }

  const ext = url.pathname.split(".").pop()?.toLowerCase() ?? "";
  if (ext && DIRECT_FILE_EXTENSIONS[ext]) {
    return {
      provider: "direct-file",
      kind: DIRECT_FILE_EXTENSIONS[ext],
      resourceKey: `web:${url.origin}${url.pathname}`,
      originalUrl: rawUrl,
      // Query params are not stripped: some are required to access the resource.
      canonicalUrl: url.toString(),
    };
  }

  return {
    provider: "web",
    kind: "page",
    resourceKey: `web:${url.origin}${url.pathname}`,
    originalUrl: rawUrl,
    canonicalUrl: url.toString(),
  };
}

export function providerEnabled(provider: ProviderId): boolean {
  if (provider === "youtube") return process.env.INGEST_DISABLE_YOUTUBE !== "1";
  return true;
}
