import { NextRequest, NextResponse } from "next/server";
import { chatCompletion } from "@/lib/openai";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { userOwnsNotebook } from "@/lib/services/notebooks";
import { sendChatMessage } from "@/lib/services/chat";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Web adapter: same chat service the desktop engine uses (phase 2). The
 *  remote provider is injected; retrieval is hybrid when a profile is
 *  active — the web adapter itself has no local embedder. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });

  const { message, notebookId, skipUserMessage } = await req.json();
  if (!message || !notebookId) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const { db } = getLocalContext();
  if (!(await userOwnsNotebook(db, user.id, notebookId))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }

  try {
    const reply = await sendChatMessage(db, {
      notebookId,
      ownerId: user.id,
      message,
      chat: (messages) => chatCompletion(messages),
      embedQuery: null,
      ...(skipUserMessage && { skipUserMessage }),
    });
    return NextResponse.json({
      response: reply.response,
      citations: reply.citations,
      mode: reply.mode,
      vectorStatus: reply.vectorStatus,
    });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat fehlgeschlagen" },
      { status: 500 }
    );
  }
}
