/**
 * Engine capabilities: resolve the chat/embed capabilities per capability
 * from explicit config (settings rows `ai.connections`, `ai.capabilities`),
 * with local llama.cpp as the default when no remote config exists.
 * Resolution is config-driven, never env-inferred for remote:
 *   - explicit connection config wins over env, always.
 *   - no explicit config -> local llama.cpp when available (local-first);
 *   - still nothing -> desktop: chat is null with a typed reason (env never
 *     reactivates remote providers in the desktop app); dev/browser: today's
 *     env fallback keeps the Next dev path working.
 *
 * Env (desktop: set by the launcher from resources; dev: .probe-downloads):
 *   NOTELM_LLAMA_DIR        — dir with llama-server.exe + DLLs
 *   NOTELM_CHAT_MODEL       — chat GGUF path
 *   NOTELM_EMBED_MODEL      — embeddings GGUF path
 *   NOTELM_EMBED_DIMENSION  — dimension of the embeddings model
 */
import path from "node:path";
import fs from "node:fs";
import { startLlama, type LlamaHandle } from "@/lib/ai/llama-supervisor";
import { getLocalContext } from "@/lib/storage/local";
import { getSetting } from "@/lib/services/settings";
import { getModel } from "@/lib/services/models";
import {
  getPreset,
  isDesktopEngine,
  makeLocalChat,
  makeEnvRemoteChat,
  makeRemoteChat,
  makeRemoteEmbed,
  type CapabilityConfig,
  type ChatFn,
  type EmbedFn,
  type ProviderConnection,
  type ProviderLabel,
} from "@/lib/ai/providers";

export type { ChatFn, ChatResult, EmbedFn, ProviderLabel } from "@/lib/ai/providers";

interface Capabilities {
  chat: ChatFn | null;
  /** What actually answers chat: kind + human label, or null. */
  chatProvider: ProviderLabel | null;
  /** String kind for existing consumers reading "local" | "remote". */
  chatProviderKind: "local" | "remote" | null;
  /** German reason when chat is null (typed, not parsed from a message). */
  chatReason?: string;
  embed: EmbedFn | null;
}

let llamaChat: LlamaHandle | null = null;
let llamaEmbed: LlamaHandle | null = null;
/** Test seam: replaces config-based resolution. */
let override: Capabilities | null = null;

export function setCapabilitiesForTests(caps: Capabilities | null): void {
  override = caps;
}

const float32 = (values: number[]): Buffer => {
  const buf = new Float32Array(values);
  return Buffer.from(buf.buffer);
};

interface ResolvedModelPaths {
  llamaDir: string | undefined;
  chatModel: string | undefined;
  embedModel: string | undefined;
}

/** Model paths from the settings-chosen library rows first, env fallback. */
async function resolveModelPaths(): Promise<ResolvedModelPaths> {
  const { db, dataDir } = getLocalContext();
  const chatId = await getSetting<string>(db, "ai.chatModelId");
  const embedId = await getSetting<string>(db, "ai.embedModelId");
  const absolute = (m: { path: string } | null) =>
    m ? path.resolve(dataDir, m.path) : undefined;

  const chatRow = chatId ? await getModel(db, chatId) : null;
  const embedRow = embedId ? await getModel(db, embedId) : null;
  const chatModel = absolute(chatRow);
  const embedModel = absolute(embedRow);
  if (chatRow && !fs.existsSync(chatModel!)) {
    throw new Error(`Chat-Modelldatei fehlt: ${chatModel}`);
  }
  if (embedRow && !fs.existsSync(embedModel!)) {
    throw new Error(`Embedding-Modelldatei fehlt: ${embedModel}`);
  }

  const llamaDir =
    process.env.NOTELM_LLAMA_DIR ||
    (chatModel || embedModel
      ? path.resolve(dataDir, "..", "resources", "llama") // packaged layout
      : undefined);
  return { llamaDir, chatModel: chatModel ?? process.env.NOTELM_CHAT_MODEL, embedModel: embedModel ?? process.env.NOTELM_EMBED_MODEL };
}

/** Read the connections/capability selections from settings (JSON rows). */
async function readProviderConfig(db: Parameters<typeof getSetting>[0]): Promise<{
  connections: ProviderConnection[];
  capCfg: Partial<Record<"chat" | "embed", CapabilityConfig | null>>;
}> {
  const connections = (await getSetting<ProviderConnection[]>(db, "ai.connections")) ?? [];
  const capCfg =
    (await getSetting<Partial<Record<"chat" | "embed", CapabilityConfig | null>>>(db, "ai.capabilities")) ?? {};
  return { connections, capCfg };
}

/** Look up a configured remote capability; null (with reason for chat) when
 *  the config does not name a usable chat/embed connection. */
function resolveRemoteCapability(
  capability: "chat" | "embed",
  cfg: CapabilityConfig | null | undefined,
  connections: ProviderConnection[]
): { connection: ProviderConnection; preset: NonNullable<ReturnType<typeof getPreset>>; } | { error: string } {
  const conn = cfg ? connections.find((c) => c.id === cfg.connectionId) : undefined;
  if (!conn) {
    return { error: `Kein KI-Anbieter konfiguriert: Für ${capability === "chat" ? "Chat" : "Einbettungen"} ist keine gültige Verbindung ausgewählt.` };
  }
  const preset = getPreset(conn.presetId);
  if (!preset) return { error: `Kein KI-Anbieter konfiguriert: Unbekannter Verbindungstyp „${conn.presetId}".` };
  if (!preset.capabilities.includes(capability)) {
    return { error: `Kein KI-Anbieter konfiguriert: ${preset.label} unterstützt ${capability === "chat" ? "keinen Chat" : "keine Einbettungen"}.` };
  }
  return { connection: conn, preset };
}

export async function resolveCapabilities(db?: Parameters<typeof getSetting>[0]): Promise<Capabilities> {
  if (override) return override;

  const d = db ?? getLocalContext().db;
  const { connections, capCfg } = await readProviderConfig(d);

  // Embeddings: explicit remote config, otherwise local llama.cpp as before
  let embed: EmbedFn | null = null;
  const embedRes = resolveRemoteCapability("embed", capCfg.embed, connections);
  if ("connection" in embedRes) {
    embed = makeRemoteEmbed(d, { ...embedRes, model: capCfg.embed!.model });
  } else {
    const { llamaDir: dir, embedModel } = await resolveModelPaths();
    if (dir && embedModel) {
      if (!llamaEmbed) llamaEmbed = await startLlama({ exeDir: dir, modelPath: embedModel });
      const handle = llamaEmbed;
      embed = async (texts) => {
        const vectors: Buffer[] = [];
        for (const t of texts) vectors.push(float32(await handle.embed(t)));
        return vectors;
      };
    }
  }

  // Chat: explicit remote config wins; local llama.cpp is the default when
  // nothing is configured (local-first); env remote only in dev/browser mode.
  let chat: ChatFn | null = null;
  let chatProvider: ProviderLabel | null = null;
  let chatProviderKind: "local" | "remote" | null = null;
  let chatReason: string | undefined;

  const chatRes = resolveRemoteCapability("chat", capCfg.chat, connections);
  if ("connection" in chatRes) {
    chat = makeRemoteChat(d, { ...chatRes, model: capCfg.chat!.model });
    chatProvider = { kind: "remote", label: `${chatRes.preset.label} · ${capCfg.chat!.model}` };
    chatProviderKind = "remote";
  } else {
    const { llamaDir: dir, chatModel } = await resolveModelPaths();
    if (dir && chatModel) {
      if (!llamaChat) llamaChat = await startLlama({ exeDir: dir, modelPath: chatModel });
      chat = makeLocalChat(llamaChat, path.basename(chatModel));
      chatProvider = { kind: "local", label: "Auf diesem Computer" };
      chatProviderKind = "local";
    } else if (isDesktopEngine()) {
      // Desktop: env NEVER reactivates remote here — typed null + reason.
      chatReason = "Kein KI-Anbieter konfiguriert. Wähle in den Einstellungen lokale Modelle oder einen Cloud-Anbieter.";
    } else if (process.env.OPENAI_API_KEY) {
      chat = makeEnvRemoteChat(d);
      chatProvider = { kind: "remote", label: "OpenAI" };
      chatProviderKind = "remote";
    } else {
      chatReason = "Kein KI-Anbieter konfiguriert. Lokale Modelle in den Einstellungen wählen oder OPENAI_API_KEY setzen.";
    }
  }

  return { chat, chatProvider, chatProviderKind, embed, ...(chatReason ? { chatReason } : {}) };
}

export async function stopLlamaHelpers(): Promise<void> {
  await llamaChat?.stop();
  await llamaEmbed?.stop();
  llamaChat = null;
  llamaEmbed = null;
}
