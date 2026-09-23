import OpenAI from "openai";

const openai = new OpenAI();

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
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

  const response = await openai.audio.transcriptions.create({
    model,
    file: new File([new Uint8Array(audioBuffer)], fileName, { type: mimeType }),
  });

  return typeof response === "string" ? response : (response as { text: string }).text;
}

export async function chatCompletion(messages: { role: string; content: string }[]): Promise<string> {
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: messages as any,
  }, { signal: AbortSignal.timeout(120_000) });
  return response.choices[0]?.message?.content || "";
}
