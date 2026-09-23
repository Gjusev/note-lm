/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { chatCompletion } from "@/lib/openai";

export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;
const INTERNAL_KEY = process.env.INTERNAL_API_KEY!;

async function convexQuery(path: string, args: Record<string, unknown>) {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify({ path, args }),
  });
  return res.json();
}

async function convexMutation(path: string, args: Record<string, unknown>) {
  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify({ path, args }),
  });
  return res.json();
}

const SYSTEM_PROMPT_WITH_SOURCES = `Du bist ein KI-Forschungsassistent. Du hast Kontext aus den Quellen des Nutzers erhalten.
Beantworte die Frage basierend auf diesen Quellen. Zitiere mit [Quelle: dateiname] wenn du dich auf eine konkrete Quelle beziehst.
Wenn die Quellen die Frage nicht vollständig beantworten, ergänze mit deinem Wissen, aber kennzeichne das klar.
Erfinde niemals Quellen. Antworte in der Sprache der Frage, Standard: Deutsch.`;

const SYSTEM_PROMPT_NO_SOURCES = `Du bist ein KI-Forschungsassistent. Es wurden keine Quellen hochgeladen.
Beantworte die Frage hilfreich mit deinem allgemeinen Wissen.
Füge am Ende hinzu: "[Keine Quellenangabe — Antwort basiert nicht auf hochgeladenen Dokumenten]"
Antworte in der Sprache der Frage, Standard: Deutsch.`;

export async function POST(req: NextRequest) {
  const { message, notebookId, ownerId, skipUserMessage } = await req.json();

  // Debug: verify env vars are loaded
  if (!process.env.INTERNAL_API_KEY) {
    console.error("INTERNAL_API_KEY is missing from env!");
  }
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    console.error("NEXT_PUBLIC_CONVEX_URL is missing from env!");
  }

  if (!message || !notebookId || !ownerId) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  try {
    // Get all chunks for the notebook
    const { value: chunks } = await convexQuery("chunks:getByNotebook", { notebookId });

    if (!chunks || chunks.length === 0) {
      // No sources — answer freely but note it's not from sources
      if (!skipUserMessage) {
        await convexMutation("messages:create", {
          ownerId,
          notebookId,
          role: "user",
          content: message,
        });
      }
      const chatMessages = [
        { role: "system", content: SYSTEM_PROMPT_NO_SOURCES },
        { role: "user", content: message },
      ];
      const response = await chatCompletion(chatMessages);
      await convexMutation("messages:create", {
        ownerId,
        notebookId,
        role: "assistant",
        content: response,
      });
      return NextResponse.json({ response, citations: [] });
    }

    // Keyword matching as primary strategy (Convex self-hosted lacks native vector search)
    const queryWords = message.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
    const keywordScored = chunks.map((chunk: any) => {
      const content = chunk.content.toLowerCase();
      const matches = queryWords.filter((w: string) => content.includes(w)).length;
      return { ...chunk, score: matches / Math.max(queryWords.length, 1) };
    }).filter((c: any) => c.score > 0).sort((a: any, b: any) => b.score - a.score).slice(0, 5);

    // Ensure at least one chunk from each source is included
    const seenSources = new Set(keywordScored.map((c: any) => c.sourceId));
    const representativeChunks: any[] = [];
    const sourceGroups = new Map<string, any[]>();
    for (const chunk of chunks) {
      const group = sourceGroups.get(chunk.sourceId) || [];
      group.push(chunk);
      sourceGroups.set(chunk.sourceId, group);
    }
    for (const [sourceId, group] of sourceGroups) {
      if (!seenSources.has(sourceId)) {
        representativeChunks.push(group[0]);
      }
    }

    // Combine: keyword-matched chunks first, then one representative per missing source
    const relevantChunks = keywordScored.length > 0
      ? [...keywordScored, ...representativeChunks.slice(0, 5)]
      : chunks.slice(0, 8);

    console.log(`[CHAT] ${chunks.length} chunks from ${sourceGroups.size} sources | keyword=${keywordScored.length} rep=${representativeChunks.length} total=${relevantChunks.length}`);

    // Include source filenames in context for proper citations
    const { value: sources } = await convexQuery("sources:listByNotebook", { notebookId });
    const sourceMap = new Map<string, any>((sources || []).map((s: any) => [s._id, s]));

    const context = relevantChunks
      .map((c: any) => {
        const src = sourceMap.get(c.sourceId);
        return `[${src?.fileName || "Quelle"}]: ${c.content}`;
      })
      .join("\n\n");

    // Build chat messages
    const chatMessages = [
      { role: "system", content: SYSTEM_PROMPT_WITH_SOURCES },
      {
        role: "system",
        content: `Kontext aus den Quellen:\n\n${context}`,
      },
      { role: "user", content: message },
    ];

    const response = await chatCompletion(chatMessages);

    // Build citations (only fields matching Convex schema)
    const citationsForStorage = relevantChunks.map((c: any) => ({
      sourceId: c.sourceId,
      chunkIndex: c.chunkIndex,
      text: c.content.slice(0, 200),
    }));

    // Build citations with fileName for the client response
    const citationsForClient = relevantChunks.map((c: any) => {
      const source = sourceMap.get(c.sourceId);
      return {
        sourceId: c.sourceId,
        chunkIndex: c.chunkIndex,
        text: c.content.slice(0, 200),
        fileName: source?.fileName || "Unbekannt",
      };
    });

    // Save messages to Convex
    if (!skipUserMessage) {
      const userResult = await convexMutation("messages:create", {
        ownerId,
        notebookId,
        role: "user",
        content: message,
      });
      console.log("User msg saved:", JSON.stringify(userResult));
    }
    const assistantResult = await convexMutation("messages:create", {
      ownerId,
      notebookId,
      role: "assistant",
      content: response,
      citations: citationsForStorage,
    });
    console.log("Assistant msg saved:", JSON.stringify(assistantResult));

    return NextResponse.json({ response, citations: citationsForClient });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat fehlgeschlagen" },
      { status: 500 }
    );
  }
}
