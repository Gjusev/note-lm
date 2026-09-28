import { IdentifiedResource, ImportError, InspectResult, DownloadPlan, ProviderAdapter } from "../types";

/**
 * YouTube adapter built on youtubei.js (MIT, https://github.com/LuanRT/YouTube.js).
 * The library is imported dynamically so identify-only contexts (Next.js API)
 * never load it. Stream URLs are short-lived: resolve() runs right before the
 * download and its output never leaves the server.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Innertube = any;

let ytPromise: Promise<Innertube> | null = null;

async function getClient(): Promise<Innertube> {
  if (!ytPromise) {
    ytPromise = (async () => {
      const { Innertube } = await import("youtubei.js");
      return Innertube.create({ retrieve_player: true });
    })().catch((err) => {
      ytPromise = null; // allow retry on transient init failures
      throw err;
    });
  }
  return ytPromise;
}

function mapExtractorError(err: unknown): ImportError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (/unavailable|private|removed|does not exist|not found|404/.test(lower)) {
    return new ImportError("unavailable", "Video nicht verfügbar");
  }
  if (/age|sign in|login|bot|confirm you.re human|attempts/.test(lower)) {
    // Datacenter IPs frequently get bot-checked: not recoverable by retrying from here.
    return new ImportError("blocked", "YouTube verweigert den Server-Zugriff (Bot-Check/Login erforderlich)");
  }
  return new ImportError("extractor", `YouTube-Extraktion fehlgeschlagen: ${msg}`, { transient: true });
}

async function loadInfo(resource: IdentifiedResource): Promise<{ client: Innertube; info: Innertube }> {
  const client = await getClient();
  let info;
  try {
    info = await client.getInfo(resource.externalId!);
  } catch (err) {
    throw mapExtractorError(err);
  }
  return { client, info };
}

export const youtubeAdapter: ProviderAdapter = {
  id: "youtube",

  async inspect(resource: IdentifiedResource): Promise<InspectResult> {
    const { info } = await loadInfo(resource);
    const basic = info.basic_info ?? {};
    if (basic.is_live) {
      throw new ImportError("unsupported", "Livestreams werden nicht unterstützt");
    }
    return {
      title: basic.title,
      author: basic.author,
      durationSeconds: basic.duration,
    };
  },

  async resolve(resource: IdentifiedResource): Promise<DownloadPlan> {
    const { client, info } = await loadInfo(resource);
    let format;
    try {
      format = info.chooseFormat({ type: "audio", quality: "best", format: "any" });
    } catch (err) {
      throw mapExtractorError(err);
    }
    if (!format) {
      throw new ImportError("unavailable", "Keine Audio-Spur verfügbar");
    }
    let url: string;
    try {
      url = await format.decipher(client.session.player);
    } catch (err) {
      throw mapExtractorError(err);
    }
    if (!url) {
      throw new ImportError("extractor", "Stream-URL konnte nicht entschlüsselt werden", { transient: true });
    }
    const mime = String(format.mime_type || "audio/mp4");
    const ext = mime.includes("webm") ? "webm" : "m4a";
    return {
      url,
      expect: "audio",
      fileNameHint: `${resource.externalId}.${ext}`,
      headers: { referer: "https://www.youtube.com/" },
    };
  },
};
