import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { chatCompletion } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 600; // 10 minutes for TTS podcast generation

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;
const INTERNAL_KEY = process.env.INTERNAL_API_KEY!;
const openai = new OpenAI();

async function convexMutation(path: string, args: Record<string, unknown>) {
  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify({ path, args }),
  });
  return res.json();
}

async function convexQuery(path: string, args: Record<string, unknown>) {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify({ path, args }),
  });
  return res.json();
}

async function uploadToConvexStorage(audioBuffer: Buffer): Promise<string> {
  const { value: uploadUrl } = await convexMutation("sources:generateUploadUrl", {});
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "audio/mpeg" },
    body: new Uint8Array(audioBuffer),
  });
  if (!uploadRes.ok) throw new Error("Audio-Upload fehlgeschlagen");
  const { storageId } = await uploadRes.json();
  return storageId;
}

async function generatePodcastAudio(script: string): Promise<Buffer> {
  const voice1 = process.env.OPENAI_TTS_VOICE_HOST_1 || "alloy";
  const voice2 = process.env.OPENAI_TTS_VOICE_HOST_2 || "echo";

  const segments: Buffer[] = [];
  const lines = script.split("\n");
  let currentHost: 1 | 2 = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(/^#{1,3}\s*(.+)/);
    if (headingMatch) {
      const speaker = headingMatch[1];
      currentHost = /moderator\s*1|moderatorin\s*1/i.test(speaker) ? 1 : 2;
      continue;
    }

    if (/^moderator(?:in)?\s*[12]/i.test(trimmed)) {
      currentHost = /moderator(?:in)?\s*1/i.test(trimmed) ? 1 : 2;
      continue;
    }

    const voice = currentHost === 1 ? voice1 : voice2;
    try {
      const mp3 = await openai.audio.speech.create({
        model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
        voice: voice as OpenAI.Audio.SpeechCreateParams["voice"],
        input: trimmed.slice(0, 4096),
        response_format: "mp3",
      }, { signal: AbortSignal.timeout(60_000) });
      const buf = Buffer.from(await mp3.arrayBuffer());
      if (buf.length > 0) segments.push(buf);
    } catch (err) {
      console.error("TTS segment error:", err);
    }
  }

  return Buffer.concat(segments);
}

const TYPE_PROMPTS: Record<string, string> = {
  summary: `Erstelle eine umfassende Zusammenfassung der folgenden Quellen auf Deutsch. Strukturiere die Zusammenfassung mit Überschriften und Absätzen.`,
  flashcards: `Erstelle 15-20 Karteikarten (Flashcards) basierend auf den folgenden Quellen. Format als JSON-Array: [{"front": "Frage/Begriff", "back": "Antwort/Definition"}]. Antworte nur mit dem JSON-Array.`,
  quiz: `Erstelle ein Quiz mit 10 Fragen basierend auf den folgenden Quellen. Format als JSON-Array: [{"question": "Frage", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "Erklärung"}]. Antworte nur mit dem JSON-Array.`,
  studyGuide: `Erstelle einen strukturierten Lernleitfaden basierend auf den folgenden Quellen. Enthalt: Lernziele, Schlüsselkonzepte, Zusammenfassung jedes Themas und Empfehlungen zum weiteren Lernen. Auf Deutsch.`,
  keyInsights: `Extrahiere die 10 wichtigsten Erkenntnisse aus den folgenden Quellen. Für jede Erkenntnis: einen kurzen Titel, eine Beschreibung und die Quelle. Auf Deutsch.`,
  podcastSummary: `Erstelle ein Podcast-Skript mit zwei Moderatoren (Moderator 1 und Moderator 2), das die wichtigsten Inhalte der folgenden Quellen in einem spannenden Gespräch zusammenfasst. Auf Deutsch. Jeder Sprecher-Wechsel beginnt mit einer Zeile "## Moderator 1" oder "## Moderator 2", gefolgt von dessen Text im nächsten Absatz.`,
  slides: `Erstelle eine Präsentation mit 8-12 Folien basierend auf den folgenden Quellen. Format als JSON-Array: [{"title": "Folientitel", "content": "Folieninhalt mit Stichpunkten"}]. Auf Deutsch.`,
};

export async function POST(req: NextRequest) {
  const { materialId, notebookId, type } = await req.json();

  if (!materialId || !notebookId || !type) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  try {
    await convexMutation("learningMaterials:updateContent", {
      materialId,
      status: "generating",
    });

    const { value: chunks } = await convexQuery("chunks:getByNotebook", { notebookId });

    if (!chunks || chunks.length === 0) {
      await convexMutation("learningMaterials:updateContent", {
        materialId,
        status: "error",
        errorMessage: "Keine Quelleninhalte verfügbar. Lade zuerst Quellen hoch.",
      });
      return NextResponse.json({ error: "No content available" }, { status: 400 });
    }

    const sourceText = chunks.map((c: { content: string }) => c.content).join("\n\n").slice(0, 12000);

    const prompt = TYPE_PROMPTS[type];
    if (!prompt) {
      await convexMutation("learningMaterials:updateContent", {
        materialId,
        status: "error",
        errorMessage: `Unbekannter Materialtyp: ${type}`,
      });
      return NextResponse.json({ error: "Unknown type" }, { status: 400 });
    }

    const content = await chatCompletion([
      { role: "system", content: prompt },
      { role: "user", content: `Quellen:\n\n${sourceText}` },
    ]);

    let audioStorageId: string | undefined;

    if (type === "podcastSummary") {
      try {
        const audioBuffer = await generatePodcastAudio(content);
        if (audioBuffer.length > 0) {
          audioStorageId = await uploadToConvexStorage(audioBuffer);
        }
      } catch (err) {
        console.error("Podcast audio generation failed:", err);
      }
    }

    await convexMutation("learningMaterials:updateContent", {
      materialId,
      status: "completed",
      content,
      ...(audioStorageId ? { audioStorageId } : {}),
    });

    return NextResponse.json({ success: true, materialId });
  } catch (error) {
    console.error("Generation error:", error);
    await convexMutation("learningMaterials:updateContent", {
      materialId,
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Generierung fehlgeschlagen",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 }
    );
  }
}
