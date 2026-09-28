import { NextRequest, NextResponse } from "next/server";
import { chunkText } from "@/lib/text-extraction";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { createSource, replaceChunks, updateSourceStatus } from "@/lib/services/sources";
import { userOwnsNotebook } from "@/lib/services/notebooks";
import { extractTextFromHtml, extractTitleFromHtml } from "@/lib/ingestion/html-extract";

export const runtime = "nodejs";

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
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });

  const { url, notebookId, forceText, title: customTitle } = await req.json();

  if (!notebookId) {
    return NextResponse.json({ error: "notebookId ist erforderlich" }, { status: 400 });
  }
  const { db } = getLocalContext();
  if (!(await userOwnsNotebook(db, user.id, notebookId))) {
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

    const sourceId = await createSource(db, {
      ownerId: user.id,
      notebookId,
      fileName: title,
      fileType: forceText ? "text/plain" : "text/html",
      fileSize: text.length,
      ...(url && !forceText ? { url } : {}),
    });

    await updateSourceStatus(db, sourceId, { status: "processing" });
    try {
      const chunks = chunkText(text);
      replaceChunks(db, { ownerId: user.id, sourceId, notebookId }, chunks);
      await updateSourceStatus(db, sourceId, { status: "completed" });
      return NextResponse.json({ sourceId, title, chunksCreated: chunks.length });
    } catch (err) {
      await updateSourceStatus(db, sourceId, {
        status: "error",
        errorMessage: err instanceof Error ? err.message : "Verarbeitung fehlgeschlagen",
      });
      throw err;
    }
  } catch (error) {
    console.error("URL fetch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Quelle konnte nicht geladen werden" },
      { status: 500 }
    );
  }
}
