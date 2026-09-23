import { NextRequest, NextResponse } from "next/server";
import { chunkText } from "@/lib/text-extraction";

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

  // HTML — strip tags to extract text
  const titleMatch = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

  // Remove scripts, styles, nav, footer, header
  const clean = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");

  // Try to get main content first
  const mainMatch = clean.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i)
    || clean.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i)
    || clean.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  const contentHtml = mainMatch ? mainMatch[1] : clean.replace(/<head[\s\S]*?<\/head>/gi, "");

  // Strip remaining tags and normalize whitespace
  const text = contentHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, title };
}

export async function POST(req: NextRequest) {
  const { url, notebookId, ownerId, forceText, title: customTitle } = await req.json();

  if (!notebookId || !ownerId) {
    return NextResponse.json({ error: "notebookId und ownerId sind erforderlich" }, { status: 400 });
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
