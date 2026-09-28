/**
 * Engine capabilities (phase 2): resolve the chat/embedding providers from
 * the environment — local llama-server when configured, remote OpenAI as a
 * fallback for chat, and a typed error when nothing is available. No silent
 * remote substitution: if the user chose local and it fails, the error says so.
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
import { chatCompletion } from "@/lib/openai";
import { getLocalContext } from "@/lib/storage/local";
import { getSetting } from "@/lib/services/settings";
import { getModel } from "@/lib/services/models";

export type ChatFn = (messages: Array<{ role: string; content: string }>) => Promise<string>;
export type EmbedFn = (texts: string[]) => Promise<Buffer[]>;

interface Capabilities {
  chat: ChatFn;
  chatProvider: "local" | "remote";
  embed: EmbedFn | null;
}

let llamaChat: LlamaHandle | null = null;
let llamaEmbed: LlamaHandle | null = null;
/** Test seam: replaces env-based resolution. */
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

export async function resolveCapabilities(): Promise<Capabilities> {
  if (override) return override;

  const { llamaDir: dir, chatModel, embedModel } = await resolveModelPaths();
  const wantLocal = !!dir && (!!chatModel || !!embedModel);
  if (!wantLocal && !process.env.OPENAI_API_KEY) {
    throw new Error(
      "Kein KI-Anbieter konfiguriert. Lokale Modelle in den Einstellungen wählen oder OPENAI_API_KEY setzen."
    );
  }

  // embeddings: local only in this phase (remote embeddings are phase 4+)
  let embed: EmbedFn | null = null;
  if (dir && embedModel) {
    if (!llamaEmbed) {
      llamaEmbed = await startLlama({ exeDir: dir, modelPath: embedModel });
    }
    const handle = llamaEmbed;
    embed = async (texts) => {
      const vectors: Buffer[] = [];
      for (const t of texts) vectors.push(float32(await handle.embed(t)));
      return vectors;
    };
  }

  // chat: local when a chat model exists; remote is an explicit fallback
  if (dir && chatModel) {
    if (!llamaChat) {
      llamaChat = await startLlama({ exeDir: dir, modelPath: chatModel });
    }
    const handle = llamaChat;
    return { chat: (messages) => handle.chat(messages), chatProvider: "local", embed };
  }

  return { chat: (messages) => chatCompletion(messages), chatProvider: "remote", embed };
}

export async function stopLlamaHelpers(): Promise<void> {
  await llamaChat?.stop();
  await llamaEmbed?.stop();
  llamaChat = null;
  llamaEmbed = null;
}
