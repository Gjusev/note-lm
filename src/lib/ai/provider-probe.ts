/**
 * Side-effect-free connection probes (multi-provider S2): providers.test runs
 * against PENDING form config - it saves nothing, invalidates no index and
 * triggers no reindexing. Changes apply only on save. Per capability:
 *   - chat        one 1-message completion with max_tokens 8 (bounded cost)
 *   - embed       embed "ping", returns the vector dimension
 *   - transcribe  POST a ~1 kB silent WAV fixture to /audio/transcriptions
 *                 (a plain GET /models would pass without audio access)
 *   - tts         GET /models when the preset declares one (openai,
 *                 openrouter, anthropic); custom presets declare no /models,
 *                 so the cheapest real call (a tiny speech synthesis) is used
 * The op NEVER logs or returns the secret.
 */
import type { LocalDb } from "@/db/local";
import { getSetting } from "@/lib/services/settings";
import { openaiClient } from "@/lib/openai";
import {
  OfflineBlockedError,
  authHeaderFor,
  getPreset,
  type ProviderCapability,
} from "@/lib/ai/providers";

const PROBE_TIMEOUT_MS = 10_000;

export interface ProbeArgs {
  capability: ProviderCapability;
  connection: { presetId: string; baseUrl?: string; model?: string };
  secret?: string;
}

/** Typed probe failure surfaced to the UI with a German message. */
export class ProbeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProbeError";
    this.code = code;
  }
}

const CAPABILITY_LABELS: Record<ProviderCapability, string> = {
  chat: "Chat",
  embed: "Einbettungen",
  transcribe: "Transkription",
  tts: "Sprachausgabe",
};

/** Minimal valid silent WAV: 44-byte header + PCM zeros (~1 kB total). */
export function silentWav(totalBytes = 1024): Buffer {
  const dataLen = totalBytes - 44;
  const buf = Buffer.alloc(totalBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(8000, 24); // sample rate
  buf.writeUInt32LE(16000, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  return buf; // data chunk is already zeros (silence)
}

/** Map SDK/fetch failures to the plan error codes (+ typed internal). */
function mapProbeError(err: unknown): ProbeError {
  if (err instanceof ProbeError) return err;
  const e = err as { status?: number; name?: string; message?: string };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return new ProbeError("timeout", `Zeitüberschreitung: Der Anbieter hat nicht innerhalb von 10 s geantwortet.`);
  }
  if (e?.status === 401 || e?.status === 403) {
    return new ProbeError("auth_failed", "Zugangsdaten wurden vom Anbieter abgelehnt (401/403).");
  }
  // the real OpenAI SDK throws APIConnectionError with name "Error"; only the
  // constructor name identifies it (fetch-level TypeError stays the other path)
  const ctorName = (e as { constructor?: { name?: string } } | null)?.constructor?.name;
  if (e?.name === "TypeError" || e?.name === "APIConnectionError" || ctorName === "APIConnectionError") {
    return new ProbeError("bad_base_url", "Serveradresse nicht erreichbar — bitte URL und Port prüfen.");
  }
  const detail = e?.message ?? String(err);
  return new ProbeError("internal", `Verbindung fehlgeschlagen: ${detail}`);
}

/** Run one probe against pending config. Throws ProbeError on failure. */
export async function probeConnection(
  db: LocalDb,
  args: ProbeArgs
): Promise<{ capability: ProviderCapability; latencyMs: number; dimension?: number }> {
  // offline is checked BEFORE anything else - never any network I/O
  if ((await getSetting<string>(db, "ai.offline")) === "1") {
    throw new ProbeError("offline_blocked", new OfflineBlockedError(args.capability).message);
  }
  const preset = getPreset(args.connection.presetId);
  if (!preset) throw new ProbeError("bad_args", `Unbekannter Verbindungstyp: ${args.connection.presetId}`);
  if (!preset.capabilities.includes(args.capability)) {
    throw new ProbeError(
      "capability_unsupported",
      `${preset.label} unterstützt ${CAPABILITY_LABELS[args.capability]} nicht.`
    );
  }
  const baseURL = args.connection.baseUrl ?? preset.baseUrl;
  if (!baseURL) {
    throw new ProbeError(
      "no_base_url",
      "Diese Verbindung hat keine Serveradresse. Lokale Modelle werden über die Modellverwaltung getestet."
    );
  }
  // Local endpoints (LM Studio, Ollama) need no key; the placeholder keeps
  // the client constructible so a keyless remote fails as auth_failed.
  const apiKey = args.secret || "notelm-probe";
  const client = openaiClient({ apiKey, baseURL });
  const headers = authHeaderFor(preset, apiKey);
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const started = Date.now();
  try {
    switch (args.capability) {
      case "chat":
        await client.chat.completions.create(
          { model: args.connection.model ?? "", messages: [{ role: "user", content: "ping" }], max_tokens: 8 },
          { signal, ...(Object.keys(headers).length ? { headers } : {}) }
        );
        return { capability: "chat", latencyMs: Date.now() - started };
      case "embed": {
        const res = await client.embeddings.create(
          { model: args.connection.model ?? "", input: ["ping"] },
          { signal, ...(Object.keys(headers).length ? { headers } : {}) }
        );
        const embedding = res.data[0]?.embedding ?? [];
        if (!embedding.length) {
          throw new ProbeError("internal", "Der Anbieter lieferte keinen Einbettungsvektor.");
        }
        return { capability: "embed", latencyMs: Date.now() - started, dimension: embedding.length };
      }
      case "transcribe": {
        const file = new File([new Uint8Array(silentWav(1024))], "probe.wav", { type: "audio/wav" });
        await client.audio.transcriptions.create(
          { model: args.connection.model ?? "whisper-1", file },
          { signal, ...(Object.keys(headers).length ? { headers } : {}) }
        );
        return { capability: "transcribe", latencyMs: Date.now() - started };
      }
      case "tts": {
        // Per-preset probe: managed catalog presets (openai, openrouter,
        // anthropic) serve GET /models; custom presets declare no models
        // endpoint, so the cheapest real call (tiny speech synthesis) runs.
        if (preset.id !== "custom") {
          const res = await fetch(`${baseURL}/models`, {
            headers: { Authorization: `Bearer ${apiKey}`, ...headers },
            signal,
          });
          if (res.status === 401 || res.status === 403) {
            throw new ProbeError("auth_failed", "Zugangsdaten wurden vom Anbieter abgelehnt (401/403).");
          }
          if (!res.ok) {
            throw new ProbeError("internal", `Verbindung fehlgeschlagen: HTTP ${res.status}`);
          }
        } else {
          await client.audio.speech.create(
            { model: args.connection.model ?? "gpt-4o-mini-tts", voice: "alloy", input: "ping", response_format: "mp3" },
            { signal, ...(Object.keys(headers).length ? { headers } : {}) }
          );
        }
        return { capability: "tts", latencyMs: Date.now() - started };
      }
    }
  } catch (err) {
    throw mapProbeError(err);
  }
}
