import OpenAI from "openai";
import type { ChatResult } from "@/lib/ai/providers";

/**
 * Lazy OpenAI access: the app (and the worker) must START without any key —
 * AI is an optional capability. Clients are created on use, never at module
 * import.
 *
 * Client cache fix (multi-provider plan, "Client caching"): the old single
 * `cached` module-level client is deleted. Clients are built per call from a
 * fully-read config — the OpenAI client is a stateless config holder, so
 * building it is free and a changed apiKey/baseURL takes effect on the very
 * next call, without a restart. Explicit config (connection settings) beats
 * env; env is only consulted when no explicit config is given.
 */

export interface AiClientConfig {
  apiKey?: string;
  baseURL?: string;
}

export function aiChatConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export function openaiClient(cfg?: AiClientConfig): OpenAI {
  const apiKey = cfg?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Kein KI-Anbieter konfiguriert. OPENAI_API_KEY setzen oder KI-Funktionen ignorieren — Notizbücher, Quellen und Suche arbeiten ohne."
    );
  }
  return new OpenAI({ apiKey, ...(cfg?.baseURL ? { baseURL: cfg.baseURL } : {}) });
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openaiClient().embeddings.create({
    model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

/** Env-configured chat, normalized to ChatResult (dev path + legacy alias). */
export async function chatCompletion(
  messages: { role: string; content: string }[]
): Promise<ChatResult> {
  const response = await openaiClient().chat.completions.create(
    {
      model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages as any,
    },
    { signal: AbortSignal.timeout(120_000) }
  );
  const choice = response.choices[0];
  const usage = response.usage;
  return {
    text: choice?.message?.content || "",
    provider: "openai",
    model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
    ...(usage && typeof usage.prompt_tokens === "number" && typeof usage.completion_tokens === "number"
      ? { usage: { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens } }
      : {}),
    ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
  };
}

export async function textToSpeech(
  input: string,
  voice: string
): Promise<Buffer> {
  const mp3 = await openaiClient().audio.speech.create(
    {
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice: voice as OpenAI.Audio.SpeechCreateParams["voice"],
      input: input.slice(0, 4096),
      response_format: "mp3",
    },
    { signal: AbortSignal.timeout(60_000) }
  );
  return Buffer.from(await mp3.arrayBuffer());
}
