/**
 * Learning-materials generation service (phase 6): transport-independent —
 * the web route and the engine share it. Generation runs through the
 * injected chat capability (local llama or remote), with podcast TTS via an
 * optional voice capability. Context comes from notebook chunks with a
 * budget; no provider is instantiated here.
 */
import type { LocalDb } from "@/db/local";
import { getChunksByNotebook } from "./sources";
import {
  listMaterialsByNotebook,
  getMaterial,
  requestGeneration,
  updateMaterial,
} from "./learning-materials";
import type { LocalStore } from "@/lib/storage/local";
import type { ChatFn } from "@/lib/ai/providers";

export type MaterialType =
  | "summary" | "flashcards" | "quiz" | "studyGuide"
  | "keyInsights" | "podcastSummary" | "slides";

const TYPE_PROMPTS: Record<string, string> = {
  summary: `Erstelle eine umfassende Zusammenfassung der folgenden Quellen auf Deutsch. Strukturiere die Zusammenfassung mit Überschriften und Absätzen.`,
  flashcards: `Erstelle 15-20 Karteikarten (Flashcards) basierend auf den folgenden Quellen. Format als JSON-Array: [{"front": "Frage/Begriff", "back": "Antwort/Definition"}]. Antworte nur mit dem JSON-Array.`,
  quiz: `Erstelle ein Quiz mit 10 Fragen basierend auf den folgenden Quellen. Format als JSON-Array: [{"question": "Frage", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "Erklärung"}]. Antworte nur mit dem JSON-Array.`,
  studyGuide: `Erstelle einen strukturierten Lernleitfaden basierend auf den folgenden Quellen. Enthalt: Lernziele, Schlüsselkonzepte, Zusammenfassung jedes Themas und Empfehlungen zum weiteren Lernen. Auf Deutsch.`,
  keyInsights: `Extrahiere die 10 wichtigsten Erkenntnisse aus den folgenden Quellen. Für jede Erkenntnis: einen kurzen Titel, eine Beschreibung und die Quelle. Auf Deutsch.`,
  podcastSummary: `Erstelle ein Podcast-Skript mit zwei Moderatoren (Moderator 1 und Moderator 2), das die wichtigsten Inhalte der folgenden Quellen in einem spannenden Gespräch zusammenfasst. Auf Deutsch. Jeder Sprecher-Wechsel beginnt mit einer Zeile "## Moderator 1" oder "## Moderator 2", gefolgt von dessen Text im nächsten Absatz.`,
  slides: `Erstelle eine Präsentation mit 8-12 Folien basierend auf den folgenden Quellen. Format als JSON-Array: [{"title": "Folientitel", "content": "Folieninhalt mit Stichpunkten"}]. Auf Deutsch.`,
};

const CONTEXT_CHAR_BUDGET = 12_000;

export async function generateMaterial(
  db: LocalDb,
  store: LocalStore,
  opts: {
    materialId: string;
    notebookId: string;
    type: MaterialType;
    chat: ChatFn;
    tts?: ((script: string) => Promise<Buffer>) | null;
  }
): Promise<{ ok: boolean; error?: string }> {
  const material = await getMaterial(db, opts.materialId);
  if (!material || material.notebookId !== opts.notebookId) {
    return { ok: false, error: "Material nicht gefunden" };
  }
  const prompt = TYPE_PROMPTS[opts.type];
  if (!prompt) return { ok: false, error: `Unbekannter Materialtyp: ${opts.type}` };

  try {
    await updateMaterial(db, opts.materialId, { status: "generating" });

    const chunks = await getChunksByNotebook(db, opts.notebookId);
    if (chunks.length === 0) {
      await updateMaterial(db, opts.materialId, {
        status: "error",
        errorMessage: "Keine Quelleninhalte verfügbar. Lade zuerst Quellen hoch.",
      });
      return { ok: false, error: "no content" };
    }

    let used = 0;
    const sourceText = chunks
      .filter((c) => (used += c.content.length) <= CONTEXT_CHAR_BUDGET || used - c.content.length === 0)
      .map((c) => c.content)
      .join("\n\n");

    const content = (
      await opts.chat([
        { role: "system", content: prompt },
        { role: "user", content: `Quellen:\n\n${sourceText}` },
      ])
    ).text;

    let audioFileId: string | undefined;
    if (opts.type === "podcastSummary" && opts.tts) {
      try {
        const audio = await opts.tts(content);
        if (audio.length > 0) {
          const file = await store.save(audio, { fileName: "podcast.mp3", contentType: "audio/mpeg" });
          audioFileId = file.id;
        }
      } catch (err) {
        console.error("Podcast audio generation failed:", err);
      }
    }

    await updateMaterial(db, opts.materialId, {
      status: "completed",
      content,
      ...(audioFileId ? { audioFileId } : {}),
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generierung fehlgeschlagen";
    await updateMaterial(db, opts.materialId, { status: "error", errorMessage: message });
    return { ok: false, error: message };
  }
}

export {
  listMaterialsByNotebook,
  getMaterial,
  requestGeneration,
  updateMaterial,
};
