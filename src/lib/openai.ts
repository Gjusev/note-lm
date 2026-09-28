import OpenAI from "openai";

/**
 * Lazy OpenAI access: the app (and the worker) must START without any key —
 * AI is an optional capability. Clients are created on first use, never at
 * module import. ponytail: per-capability provider registry (plan §4) can
 * replace `client()` when a second provider is actually added.
 */

let cached: OpenAI | null = null;

export function aiChatConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export function openaiClient(): OpenAI {
  if (!cached) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Kein KI-Anbieter konfiguriert. OPENAI_API_KEY setzen oder KI-Funktionen ignorieren — Notizbücher, Quellen und Suche arbeiten ohne."
      );
    }
    cached = new OpenAI({ apiKey });
  }
  return cached;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openaiClient().embeddings.create({
    model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

const MIME_MAP: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

export async function transcribeAudio(audioBuffer: Buffer, fileName: string): Promise<string> {
  const model = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
  const ext = fileName.split(".").pop()?.toLowerCase() || "wav";
  const mimeType = MIME_MAP[ext] || "audio/wav";

  const response = await openaiClient().audio.transcriptions.create({
    model,
    file: new File([new Uint8Array(audioBuffer)], fileName, { type: mimeType }),
  });

  return typeof response === "string" ? response : (response as { text: string }).text;
}

export async function chatCompletion(messages: { role: string; content: string }[]): Promise<string> {
  const response = await openaiClient().chat.completions.create(
    {
      model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages as any,
    },
    { signal: AbortSignal.timeout(120_000) }
  );
  return response.choices[0]?.message?.content || "";
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
