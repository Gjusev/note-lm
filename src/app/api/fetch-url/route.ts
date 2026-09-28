import { NextRequest, NextResponse } from "next/server";
import { chunkText } from "@/lib/text-extraction";
import { getSessionUser, userOwnsNotebook } from "@/lib/server/notebook-access";
import { extractTextFromHtml, extractTitleFromHtml } from "@/lib/ingestion/html-extract";

export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;
const INTERNAL_KEY = process.env.INTERNAL_API_KEY!;

async function convexMutation(path: string, args: Record<string, unknown>) {
  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify({ path, args }),
  });
  return res.json();
}

async function fetchAndExtractText(url: string): Promise<{ text: string; title: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; KIResearchBot/1.0)",
      "Accept": "text/html,application/xhtml+xml,text/plain,text/markdown",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Fetch fehlgeschlagen: ${res.status} ${res.statusText}`);

  const contentType = res.headers.get("content-type") || "";
  const raw = await res.text();

  if (contentType.includes("text/plain") || contentType.includes("text/markdown")) {
    const title = url.split("/").pop() || url;
    return { text: raw, title };
  }

  const title = extractTitleFromHtml(raw, new URL(url).hostname);
  const text = extractTextFromHtml(raw);
  return { text, title };
}

export async function POST(req: NextRequest) {
  const { url, notebookId, forceText, title: customTitle } = await req.json();

  // ownerId comes from the session, never from the request body
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }
  const ownerId = user.id;

  if (!notebookId) {
    return NextResponse.json({ error: "notebookId ist erforderlich" }, { status: 400 });
  }
  if (!(await userOwnsNotebook(ownerId, notebookId))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }

  try {
    let text: string;
    let title: string;

    // Direct text content (e.g. from learning materials)
    if (forceText) {
      text = forceText;
      title = customTitle || "Importierte Quelle";
    } else {
      if (!url) {
        return NextResponse.json({ error: "url oder forceText sind erforderlich" }, { status: 400 });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return NextResponse.json({ error: "Ungültige URL" }, { status: 400 });
      }

      const allowedProtocols = ["http:", "https:"];
      if (!allowedProtocols.includes(parsedUrl.protocol)) {
        return NextResponse.json({ error: "Nur HTTP/HTTPS URLs erlaubt" }, { status: 400 });
      }

      const result = await fetchAndExtractText(url);
      text = result.text;
      title = result.title;

      if (text.length < 50) {
        return NextResponse.json({ error: "Seite enthält zu wenig Textinhalt" }, { status: 400 });
      }
    }

    // Create source record
    const { value: sourceId } = await convexMutation("sources:create", {
      ownerId,
      notebookId,
      fileName: title,
      fileType: forceText ? "text/plain" : "text/html",
      fileSize: text.length,
      ...(url && !forceText ? { url } : {}),
    });

    // Update status to processing
    await convexMutation("sources:updateStatus", { sourceId, status: "processing" });

    // Chunk and store
    const chunks = chunkText(text);
    for (let i = 0; i < chunks.length; i++) {
      const embeddingId = `emb_${sourceId}_${i}`;
      await convexMutation("chunks:create", {
        ownerId,
        sourceId,
        notebookId,
        content: chunks[i],
        chunkIndex: i,
        embeddingId,
      });
    }

    await convexMutation("sources:updateStatus", { sourceId, status: "completed" });

    return NextResponse.json({
      sourceId,
      title,
      chunksCreated: chunks.length,
    });
  } catch (error) {
    console.error("URL fetch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Quelle konnte nicht geladen werden" },
      { status: 500 }
    );
  }
}
