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
import { startLlama, type LlamaHandle } from "@/lib/ai/llama-supervisor";
import { chatCompletion } from "@/lib/openai";

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

export async function resolveCapabilities(): Promise<Capabilities> {
  if (override) return override;

  const dir = process.env.NOTELM_LLAMA_DIR;
  const chatModel = process.env.NOTELM_CHAT_MODEL;
  const embedModel = process.env.NOTELM_EMBED_MODEL;
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
