import { NextRequest, NextResponse } from "next/server";
import { chatCompletion, textToSpeech } from "@/lib/openai";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { getMaterial, updateMaterial } from "@/lib/services/learning-materials";
import { getChunksByNotebook } from "@/lib/services/sources";
import { userOwnsNotebook } from "@/lib/services/notebooks";
import type { MaterialType } from "@/db/local/schema";

export const runtime = "nodejs";
export const maxDuration = 600; // 10 minutes for TTS podcast generation

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
      const mp3 = await textToSpeech(trimmed, voice);
      if (mp3.length > 0) segments.push(mp3);
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
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });

  const { materialId, notebookId, type } = await req.json();

  if (!materialId || !notebookId || !type) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }
  if (!TYPE_PROMPTS[type]) {
    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  }

  const { db, store } = getLocalContext();
  if (!(await userOwnsNotebook(db, user.id, notebookId))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }

  try {
    const material = await getMaterial(db, materialId);
    if (!material || material.notebookId !== notebookId) {
      return NextResponse.json({ error: "Material nicht gefunden" }, { status: 404 });
    }

    await updateMaterial(db, materialId, { status: "generating" });

    const chunks = await getChunksByNotebook(db, notebookId);
    if (chunks.length === 0) {
      await updateMaterial(db, materialId, {
        status: "error",
        errorMessage: "Keine Quelleninhalte verfügbar. Lade zuerst Quellen hoch.",
      });
      return NextResponse.json({ error: "No content available" }, { status: 400 });
    }

    const sourceText = chunks.map((c) => c.content).join("\n\n").slice(0, 12000);

    const content = (
      await chatCompletion([
        { role: "system", content: TYPE_PROMPTS[type] },
        { role: "user", content: `Quellen:\n\n${sourceText}` },
      ])
    ).text;

    let audioFileId: string | undefined;
    if (type === ("podcastSummary" as MaterialType)) {
      try {
        const audioBuffer = await generatePodcastAudio(content);
        if (audioBuffer.length > 0) {
          const file = await store.save(audioBuffer, {
            fileName: "podcast.mp3",
            contentType: "audio/mpeg",
          });
          audioFileId = file.id;
        }
      } catch (err) {
        console.error("Podcast audio generation failed:", err);
      }
    }

    await updateMaterial(db, materialId, {
      status: "completed",
      content,
      ...(audioFileId ? { audioFileId } : {}),
    });

    return NextResponse.json({ success: true, materialId });
  } catch (error) {
    console.error("Generation error:", error);
    await updateMaterial(db, materialId, {
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Generierung fehlgeschlagen",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 }
    );
  }
}
