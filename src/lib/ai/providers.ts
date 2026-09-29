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

export type ProviderCapability = "chat" | "embed";

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
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    capabilities: ["chat", "embed"],
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
    capabilities: ["chat", "embed"],
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
    super(
      `Offline-Modus ist aktiv. Die Funktion „${capability === "chat" ? "Chat" : "Einbettungen"}" läuft nur lokal — bitte online gehen oder einen lokalen Anbieter wählen.`
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
// Secret resolution (S1: settings row; keyring channel lands in S2)
// ---------------------------------------------------------------------------

async function resolveSecret(db: LocalDb, connection: ProviderConnection): Promise<string | undefined> {
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

// ---------------------------------------------------------------------------
// Capability factories
// ---------------------------------------------------------------------------

/** Local llama.cpp chat — never blocked by offline mode. Usage is unknown
 *  (llamaChat drops it), so usage/finishReason stay undefined, never zero. */
export function makeLocalChat(handle: LlamaHandle, model: string): ChatFn {
  return async (messages) => ({
    text: await handle.chat(messages),
    provider: "llamacpp",
    model,
  });
}

function authHeaderFor(preset: ProviderPreset, apiKey: string): Record<string, string> {
  return preset.authHeader === "x-api-key" ? { "x-api-key": apiKey } : {};
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
        return {
          text: choice?.message?.content || "",
          provider: cfg.preset.id,
          model: cfg.model,
          ...(usage && typeof usage.prompt_tokens === "number" && typeof usage.completion_tokens === "number"
            ? { usage: { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens } }
            : {}),
          ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
        };
      } finally {
        linked.cleanup();
      }
    } catch (err) {
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
    try {
      await assertRemoteAllowed(db, "embed"); // re-check after registration

      const linked = linkedSignal([ac.signal, AbortSignal.timeout(120_000)]);
      try {
        const response = await client.embeddings.create({ model: cfg.model, input: texts }, {
          signal: linked.signal,
          ...(apiKey ? authHeaderFor(cfg.preset, apiKey) : {}),
        });
        return response.data.map((item) => {
          const buf = new Float32Array(item.embedding);
          return Buffer.from(buf.buffer);
        });
      } finally {
        linked.cleanup();
      }
    } catch (err) {
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
        return {
          text: choice?.message?.content || "",
          provider: "openai",
          model,
          ...(usage && typeof usage.prompt_tokens === "number" && typeof usage.completion_tokens === "number"
            ? { usage: { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens } }
            : {}),
          ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
        };
      } finally {
        linked.cleanup();
      }
    } catch (err) {
      throw new RemoteProviderError(connection, "chat", err);
    } finally {
      inFlight.chat.delete(ac);
    }
  };
}
