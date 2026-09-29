/**
 * Provider layer (multi-provider plan, slice S1): presets, connections and
 * per-capability resolution over the settings table. A **preset** describes
 * how to talk (OpenAI wire protocol), a **connection** is where (its own
 * instance id, endpoint, secret reference), a **capability** selects a
 * connection + model from explicit config. No silent fallback: a configured
 * remote provider that fails surfaces its own error, never local inference.
 *
 * Offline is enforced at CALL time: every remote call re-reads the
 * `ai.offline` settings flag and refuses (typed OfflineBlockedError, German
 * copy) before touching the network; in-flight remote calls are aborted when
 * the flag flips on. Local llama.cpp calls are never blocked.
 *
 * Secrets (S1): the connection stores only a secretRef; the value is looked
 * up in the `ai.secrets` settings row (test/dev path) with the env key as
 * dev fallback. The `secret_request` keyring channel replaces this in S2.
 */
import type { LocalDb } from "@/db/local";
import { getSetting, setSetting } from "@/lib/services/settings";
import { recordProviderRun, type ProviderRunInput } from "@/lib/services/provider-runs";
import { openaiClient, type AiClientConfig } from "@/lib/openai";
import type { LlamaHandle } from "@/lib/ai/llama-supervisor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Normalized chat answer: what actually answered plus honest usage. */
export interface ChatResult {
  text: string;
  provider: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
  finishReason?: string;
}

export type ChatFn = (
  messages: Array<{ role: string; content: string }>,
  signal?: AbortSignal
) => Promise<ChatResult>;

export type EmbedFn = (texts: string[]) => Promise<Buffer[]>;

/** One transcript segment with its REAL time range in the media file, when
 *  the provider reports one (local whisper -oj). Structurally identical to
 *  ingestion/process MediaSegment — kept here so providers.ts never imports
 *  the ingestion graph. */
export interface TranscribeSegment {
  startSec: number;
  endSec: number;
  text: string;
}

/** Media transcription: injected from resolveCapabilities (S3) instead of a
 *  hardcoded module import — the call site never knows the provider.
 *  `segments` is optional and honest: only providers that report real times
 *  (local whisper's own JSON) fill it — a provider without times returns
 *  {text} and callers fall back to their no-times path. */
export type TranscribeFn = (
  audio: Buffer,
  fileName: string
) => Promise<{ text: string; segments?: TranscribeSegment[] }>;

export type ProviderCapability = "chat" | "embed" | "transcribe" | "tts";

export interface ProviderLabel {
  kind: "local" | "remote";
  label: string;
}

/** Data-driven preset catalog (kept in code, deliberately not a JSON file). */
export interface ProviderPreset {
  id: string;
  label: string;
  /** null = managed local (base url comes from the supervisor handle). */
  baseUrl: string | null;
  capabilities: ProviderCapability[];
  authHeader: "bearer" | "x-api-key";
  experimental?: boolean;
}

/** A configured instance: preset + own id + endpoint + secret reference. */
export interface ProviderConnection {
  id: string;
  presetId: string;
  label: string;
  /** Required for the "custom" preset; overrides the preset base url. */
  baseUrl?: string;
  /** Settings-row reference; defaults to the connection id. */
  secretRef?: string;
}

/** Per-capability explicit selection stored in `ai.capabilities`. */
export interface CapabilityConfig {
  connectionId: string;
  model: string;
}

export interface ChatCapabilityConfig {
  connection: ProviderConnection;
  preset: ProviderPreset;
  model: string;
}

// ---------------------------------------------------------------------------
// Presets (catalog v1)
// ---------------------------------------------------------------------------

export const PRESETS: ProviderPreset[] = [
  {
    id: "llamacpp",
    label: "Auf diesem Computer (llama.cpp)",
    baseUrl: null,
    capabilities: ["chat", "embed"],
    authHeader: "bearer",
  },
  {
    // managed local ASR (whisper.cpp): baseUrl null = managed local, like
    // llamacpp. The runtime + model come from the local machine (runtime via
    // NOTELM_WHISPER_DIR / packaged resources, model via the catalog); the
    // TranscribeFn is built in engine/capabilities.ts, never a remote wire.
    id: "whisper-local",
    label: "Auf diesem Computer (whisper.cpp)",
    baseUrl: null,
    capabilities: ["transcribe"],
    authHeader: "bearer",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    capabilities: ["chat", "embed", "transcribe", "tts"],
    authHeader: "bearer",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    capabilities: ["chat", "embed"],
    authHeader: "bearer",
  },
  {
    // OpenAI-compat layer only — experimental, chat only (plan: catalog v1)
    id: "anthropic-compat",
    label: "Anthropic (OpenAI-kompatibel)",
    baseUrl: "https://api.anthropic.com/v1",
    capabilities: ["chat"],
    authHeader: "x-api-key",
    experimental: true,
  },
  {
    id: "custom",
    label: "Eigener Endpunkt (OpenAI-kompatibel)",
    baseUrl: null,
    capabilities: ["chat", "embed", "transcribe", "tts"],
    authHeader: "bearer",
  },
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown at call time when ai.offline is on (remote requests and retries). */
export class OfflineBlockedError extends Error {
  readonly capability: ProviderCapability;
  constructor(capability: ProviderCapability) {
    const labels: Record<ProviderCapability, string> = {
      chat: "Chat",
      embed: "Einbettungen",
      transcribe: "Transkription",
      tts: "Sprachausgabe",
    };
    super(
      `Offline-Modus ist aktiv. Die Funktion „${labels[capability]}" läuft nur lokal — bitte online gehen oder einen lokalen Anbieter wählen.`
    );
    this.name = "OfflineBlockedError";
    this.capability = capability;
  }
}

/** A failing remote provider surfaces itself; never a fallback to local. */
export class RemoteProviderError extends Error {
  readonly connectionId: string;
  readonly capability: ProviderCapability;
  constructor(connection: ProviderConnection, capability: ProviderCapability, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Verbindung mit ${connection.label} fehlgeschlagen: ${detail}`);
    this.name = "RemoteProviderError";
    this.connectionId = connection.id;
    this.capability = capability;
  }
}

// ---------------------------------------------------------------------------
// Desktop detection + offline mode
// ---------------------------------------------------------------------------

/**
 * The Tauri host runs this bundle as the engine process; the engine entry
 * (src/engine/main.ts) sets NOTELM_ENGINE=1 at boot. Absent = Next dev/e2e
 * host in-process — env fallbacks stay available there.
 */
export function isDesktopEngine(): boolean {
  return process.env.NOTELM_ENGINE === "1";
}

const OFFLINE_KEY = "ai.offline";
const SECRETS_KEY = "ai.secrets";

const inFlight: Record<ProviderCapability, Set<AbortController>> = {
  chat: new Set(),
  embed: new Set(),
  // probes (providers.test) are one-shot, never registered for abort
  transcribe: new Set(),
  tts: new Set(),
};

/** Throw OfflineBlockedError when ai.offline is "1" (checked per call). */
async function assertRemoteAllowed(db: LocalDb, capability: ProviderCapability): Promise<void> {
  const flag = await getSetting<string>(db, OFFLINE_KEY);
  if (flag === "1") throw new OfflineBlockedError(capability);
}

/**
 * Flip the offline switch and, when turning it on, abort every in-flight
 * remote call. New requests and retries go through the same capability
 * functions and are refused by the per-call flag check.
 */
export async function setOfflineMode(db: LocalDb, on: boolean): Promise<void> {
  await setSetting(db, OFFLINE_KEY, on ? "1" : "0");
  if (!on) return;
  for (const set of Object.values(inFlight)) {
    for (const ac of set) ac.abort();
    set.clear();
  }
}

export async function isOffline(db: LocalDb): Promise<boolean> {
  return (await getSetting<string>(db, OFFLINE_KEY)) === "1";
}

/**
 * Combine the registry controller, the caller's signal and the call timeout
 * into one signal (AbortSignal.any is not assumed for Node compat).
 */
function linkedSignal(signals: Array<AbortSignal | undefined>): { signal: AbortSignal; cleanup: () => void } {
  const ac = new AbortController();
  const listeners: Array<[AbortSignal, () => void]> = [];
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      ac.abort(s.reason);
      break;
    }
    const onAbort = () => ac.abort(s.reason);
    s.addEventListener("abort", onAbort, { once: true });
    listeners.push([s, onAbort]);
  }
  return {
    signal: ac.signal,
    cleanup: () => {
      for (const [s, fn] of listeners) s.removeEventListener("abort", fn);
    },
  };
}

// ---------------------------------------------------------------------------
// Secret resolution (S2: keyring channel when running as the engine;
// settings row + env fallback stay the dev/browser path)
// ---------------------------------------------------------------------------

/**
 * The engine entrypoint installs the stdio secret_request channel; tests may
 * install a fake host. Null = dev/browser: the settings row stays the source.
 */
let secretRequester: ((connectionId: string) => Promise<string | null>) | null = null;

export function setSecretRequester(
  fn: ((connectionId: string) => Promise<string | null>) | null
): void {
  secretRequester = fn;
}

/** Exported for the providers.test probe (anthropic-compat x-api-key). */
export function authHeaderFor(preset: ProviderPreset, apiKey: string): Record<string, string> {
  return preset.authHeader === "x-api-key" ? { "x-api-key": apiKey } : {};
}

/**
 * Engine mode: ask the host (keyring channel), null/timeout -> typed
 * secret_unavailable. Dev/browser: settings row; env stays the dev fallback.
 */
async function resolveSecret(db: LocalDb, connection: ProviderConnection): Promise<string | undefined> {
  if (isDesktopEngine() && secretRequester) {
    const value = await secretRequester(connection.secretRef ?? connection.id);
    if (!value) throw new SecretUnavailableError(connection);
    return value;
  }
  const secrets = (await getSetting<Record<string, string>>(db, SECRETS_KEY)) ?? {};
  return secrets[connection.secretRef ?? connection.id];
}

/** Configured secret first; the env key is the dev-only fallback. */
async function clientConfig(db: LocalDb, connection: ProviderConnection): Promise<AiClientConfig> {
  const secret = await resolveSecret(db, connection);
  if (secret) return { apiKey: secret, baseURL: connection.baseUrl ?? getPreset(connection.presetId)?.baseUrl ?? undefined };
  if (!isDesktopEngine() && process.env.OPENAI_API_KEY) return { baseURL: connection.baseUrl ?? getPreset(connection.presetId)?.baseUrl ?? undefined };
  throw new Error(
    `Kein Zugangsdaten für die Verbindung „${connection.label}" gespeichert. Bitte in den Einstellungen hinterlegen.`
  );
}

/** Fire-and-forget telemetry write: a failing provider_runs insert must never
 *  break the capability call it observes (and stores no prompt text). */
function recordQuietly(db: LocalDb, run: ProviderRunInput): void {
  try {
    recordProviderRun(db, run);
  } catch (err) {
    console.error("[providers] provider_runs write failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Capability factories
// ---------------------------------------------------------------------------

/** Local llama.cpp chat — never blocked by offline mode. Usage is unknown
 *  (llamaChat drops it), so usage/finishReason stay undefined, never zero,
 *  and the telemetry row honestly records null tokens. */
export function makeLocalChat(db: LocalDb, handle: LlamaHandle, model: string): ChatFn {
  return async (messages) => {
    const t0 = Date.now();
    try {
      const text = await handle.chat(messages);
      recordQuietly(db, {
        capability: "chat", provider: "llamacpp", model,
        latencyMs: Date.now() - t0, ok: true,
      });
      return { text, provider: "llamacpp", model };
    } catch (err) {
      recordQuietly(db, {
        capability: "chat", provider: "llamacpp", model,
        latencyMs: Date.now() - t0, ok: false, errorCode: "local_error",
      });
      throw err;
    }
  };
}

/** Thrown when the host denies a secret or the 3 s window lapses (S2). */
export class SecretUnavailableError extends Error {
  readonly connectionId: string;
  constructor(connection: ProviderConnection) {
    super(
      `Keine Zugangsdaten für die Verbindung „${connection.label}" verfügbar. Bitte in den Einstellungen hinterlegen.`
    );
    this.name = "SecretUnavailableError";
    this.connectionId = connection.id;
  }
}

/**
 * Remote chat via the OpenAI SDK: client built per call from the fully-read
 * config (client-cache fix — a key or base url change takes effect without
 * restart), offline checked before any network I/O, and the call registered
 * so setOfflineMode(true) can abort it mid-flight.
 */
export function makeRemoteChat(
  db: LocalDb,
  cfg: ChatCapabilityConfig
): ChatFn {
  return async (messages, signal) => {
    await assertRemoteAllowed(db, "chat");
    const { apiKey, baseURL } = await clientConfig(db, cfg.connection);
    const client = openaiClient({ apiKey, baseURL });
    const ac = new AbortController();
    inFlight.chat.add(ac);
    const t0 = Date.now();
    try {
      // the flag may have flipped while this call was between gate and
      // registration — re-check so the call can not slip onto the wire
      await assertRemoteAllowed(db, "chat");
      const linked = linkedSignal([
        ac.signal,
        signal,
        AbortSignal.timeout(120_000),
      ]);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await client.chat.completions.create({ model: cfg.model, messages: messages as any }, {
          signal: linked.signal,
          ...(apiKey ? authHeaderFor(cfg.preset, apiKey) : {}),
        });
        const choice = response.choices[0];
        const usage = response.usage;
        const result = {
          text: choice?.message?.content || "",
          provider: cfg.preset.id,
          model: cfg.model,
          ...(usage && typeof usage.prompt_tokens === "number" && typeof usage.completion_tokens === "number"
            ? { usage: { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens } }
            : {}),
          ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
        };
        recordQuietly(db, {
          capability: "chat", provider: cfg.preset.id, model: cfg.model,
          latencyMs: Date.now() - t0,
          promptTokens: usage && typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
          completionTokens: usage && typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
          ok: true,
        });
        return result;
      } finally {
        linked.cleanup();
      }
    } catch (err) {
      if (err instanceof SecretUnavailableError || err instanceof OfflineBlockedError) throw err; // stays typed
      recordQuietly(db, {
        capability: "chat", provider: cfg.preset.id, model: cfg.model,
        latencyMs: Date.now() - t0, ok: false, errorCode: "remote_error",
      });
      throw new RemoteProviderError(cfg.connection, "chat", err);
    } finally {
      inFlight.chat.delete(ac);
    }
  };
}

/** Remote embeddings; same call-time offline gate and abort registry. */
export function makeRemoteEmbed(db: LocalDb, cfg: ChatCapabilityConfig): EmbedFn {
  return async (texts) => {
    await assertRemoteAllowed(db, "embed");
    const { apiKey, baseURL } = await clientConfig(db, cfg.connection);
    const client = openaiClient({ apiKey, baseURL });
    const ac = new AbortController();
    inFlight.embed.add(ac);
    const t0 = Date.now();
    try {
      await assertRemoteAllowed(db, "embed"); // re-check after registration

      const linked = linkedSignal([ac.signal, AbortSignal.timeout(120_000)]);
      try {
        const response = await client.embeddings.create({ model: cfg.model, input: texts }, {
          signal: linked.signal,
          ...(apiKey ? authHeaderFor(cfg.preset, apiKey) : {}),
        });
        recordQuietly(db, {
          capability: "embed", provider: cfg.preset.id, model: cfg.model,
          latencyMs: Date.now() - t0,
          promptTokens: typeof response.usage?.prompt_tokens === "number" ? response.usage.prompt_tokens : null,
          completionTokens: null,
          ok: true,
        });
        return response.data.map((item) => {
          const buf = new Float32Array(item.embedding);
          return Buffer.from(buf.buffer);
        });
      } finally {
        linked.cleanup();
      }
    } catch (err) {
      if (err instanceof SecretUnavailableError || err instanceof OfflineBlockedError) throw err; // stays typed
      recordQuietly(db, {
        capability: "embed", provider: cfg.preset.id, model: cfg.model,
        latencyMs: Date.now() - t0, ok: false, errorCode: "remote_error",
      });
      throw new RemoteProviderError(cfg.connection, "embed", err);
    } finally {
      inFlight.embed.delete(ac);
    }
  };
}

/**
 * Dev fallback when no explicit config exists (Next dev only — desktop never
 * reaches this): today's env-based remote chat, normalized to ChatResult.
 */
export function makeEnvRemoteChat(db: LocalDb): ChatFn {
  const connection: ProviderConnection = { id: "env", presetId: "openai", label: "OpenAI" };
  return async (messages, signal) => {
    await assertRemoteAllowed(db, "chat");
    const client = openaiClient(); // env key; throws the Kein KI-Anbieter error when absent
    const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
    const ac = new AbortController();
    inFlight.chat.add(ac);
    const t0 = Date.now();
    try {
      // the flag may have flipped while this call was between gate and
      // registration — re-check so the call can not slip onto the wire
      await assertRemoteAllowed(db, "chat");
      const linked = linkedSignal([ac.signal, signal, AbortSignal.timeout(120_000)]);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await client.chat.completions.create({ model, messages: messages as any }, { signal: linked.signal });
        const choice = response.choices[0];
        const usage = response.usage;
        const result = {
          text: choice?.message?.content || "",
          provider: "openai",
          model,
          ...(usage && typeof usage.prompt_tokens === "number" && typeof usage.completion_tokens === "number"
            ? { usage: { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens } }
            : {}),
          ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
        };
        recordQuietly(db, {
          capability: "chat", provider: "openai", model,
          latencyMs: Date.now() - t0,
          promptTokens: usage && typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
          completionTokens: usage && typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
          ok: true,
        });
        return result;
      } finally {
        linked.cleanup();
      }
    } catch (err) {
      recordQuietly(db, {
        capability: "chat", provider: "openai", model,
        latencyMs: Date.now() - t0, ok: false, errorCode: "remote_error",
      });
      throw new RemoteProviderError(connection, "chat", err);
    } finally {
      inFlight.chat.delete(ac);
    }
  };
}

// ---------------------------------------------------------------------------
// Transcription (S3): remote Whisper-style ASR, same gate/abort/telemetry
// pattern as chat. Managed local ASR is a later phase — there is no local
// transcribe factory yet, a llamacpp selection resolves to null with a typed
// reason (see engine/capabilities.ts).
// ---------------------------------------------------------------------------

/** OpenAI audio upload MIME types (extension-based, audio/wav default). */
const TRANSCRIBE_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

/**
 * Remote transcription via the OpenAI SDK audio.transcriptions endpoint:
 * client built per call from fully-read config, offline checked before any
 * network I/O, call registered for setOfflineMode aborts, run recorded.
 */
export function makeRemoteTranscribe(db: LocalDb, cfg: ChatCapabilityConfig): TranscribeFn {
  return async (audio, fileName) => {
    await assertRemoteAllowed(db, "transcribe");
    const { apiKey, baseURL } = await clientConfig(db, cfg.connection);
    const client = openaiClient({ apiKey, baseURL });
    const ac = new AbortController();
    inFlight.transcribe.add(ac);
    const t0 = Date.now();
    try {
      // re-check after registration so the call can not slip onto the wire
      await assertRemoteAllowed(db, "transcribe");
      const linked = linkedSignal([ac.signal, AbortSignal.timeout(120_000)]);
      try {
        const ext = fileName.split(".").pop()?.toLowerCase() || "wav";
        const response = await client.audio.transcriptions.create(
          {
            model: cfg.model,
            file: new File([new Uint8Array(audio)], fileName, { type: TRANSCRIBE_MIME[ext] ?? "audio/wav" }),
          },
          { signal: linked.signal, ...(apiKey ? authHeaderFor(cfg.preset, apiKey) : {}) }
        );
        recordQuietly(db, {
          capability: "transcribe", provider: cfg.preset.id, model: cfg.model,
          latencyMs: Date.now() - t0, ok: true,
        });
        return { text: typeof response === "string" ? response : (response as { text: string }).text };
      } finally {
        linked.cleanup();
      }
    } catch (err) {
      if (err instanceof SecretUnavailableError || err instanceof OfflineBlockedError) throw err; // stays typed
      recordQuietly(db, {
        capability: "transcribe", provider: cfg.preset.id, model: cfg.model,
        latencyMs: Date.now() - t0, ok: false, errorCode: "remote_error",
      });
      throw new RemoteProviderError(cfg.connection, "transcribe", err);
    } finally {
      inFlight.transcribe.delete(ac);
    }
  };
}

/** Dev fallback when no explicit transcribe config exists (Next dev only —
 *  desktop never reaches this): today's env-based Whisper call, normalized
 *  to the TranscribeFn shape. */
export function makeEnvRemoteTranscribe(db: LocalDb): TranscribeFn {
  const connection: ProviderConnection = { id: "env", presetId: "openai", label: "OpenAI" };
  return async (audio, fileName) => {
    await assertRemoteAllowed(db, "transcribe");
    const client = openaiClient(); // env key; throws the Kein KI-Anbieter error when absent
    const model = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
    const ac = new AbortController();
    inFlight.transcribe.add(ac);
    const t0 = Date.now();
    try {
      await assertRemoteAllowed(db, "transcribe"); // re-check after registration
      const linked = linkedSignal([ac.signal, AbortSignal.timeout(120_000)]);
      try {
        const ext = fileName.split(".").pop()?.toLowerCase() || "wav";
        const response = await client.audio.transcriptions.create(
          {
            model,
            file: new File([new Uint8Array(audio)], fileName, { type: TRANSCRIBE_MIME[ext] ?? "audio/wav" }),
          },
          { signal: linked.signal }
        );
        recordQuietly(db, {
          capability: "transcribe", provider: "openai", model,
          latencyMs: Date.now() - t0, ok: true,
        });
        return { text: typeof response === "string" ? response : (response as { text: string }).text };
      } finally {
        linked.cleanup();
      }
    } catch (err) {
      if (err instanceof SecretUnavailableError || err instanceof OfflineBlockedError) throw err; // stays typed
      recordQuietly(db, {
        capability: "transcribe", provider: "openai", model,
        latencyMs: Date.now() - t0, ok: false, errorCode: "remote_error",
      });
      throw new RemoteProviderError(connection, "transcribe", err);
    } finally {
      inFlight.transcribe.delete(ac);
    }
  };
}
