import { NextRequest, NextResponse } from "next/server";
import { chunkText } from "@/lib/text-extraction";

export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;
const INTERNAL_KEY = process.env.INTERNAL_API_KEY!;
const SEAR_ENDPOINT = process.env.SEAR_ENDPOINT || "https://your-sear-instance.example.com";

async function convexMutation(path: string, args: Record<string, unknown>) {
  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify({ path, args }),
  });
  return res.json();
}

interface SearResult {
  title: string;
  url: string;
  snippet?: string;
  content?: string;
}

interface SearResponse {
  results?: SearResult[];
  answer?: string;
}

async function searchSear(query: string): Promise<SearResponse> {
  const url = `${SEAR_ENDPOINT}/search?q=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Search API Fehler: ${res.status} — ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const results: SearResult[] = (data.results || []).map((r: Record<string, unknown>) => ({
    title: (r.title as string) || "",
    url: (r.url as string) || "",
    snippet: (r.content as string) || "",
  }));

  return { results };
}

// Search-only: returns results without creating sources
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query) {
    return NextResponse.json({ error: "Suchbegriff erforderlich (?q=...)" }, { status: 400 });
  }

  try {
    const data = await searchSear(query);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Suche fehlgeschlagen" },
      { status: 500 }
    );
  }
}

// Search + add selected results as sources to a notebook
export async function POST(req: NextRequest) {
  const { query, notebookId, ownerId, addResults } = await req.json();

  if (!query) {
    return NextResponse.json({ error: "Suchbegriff erforderlich" }, { status: 400 });
  }

  try {
    const data = await searchSear(query);

    if (!addResults || !notebookId || !ownerId) {
      return NextResponse.json(data);
    }

    // Add search results as sources
    const results = data.results || [];
    const created: string[] = [];

    for (const result of results.slice(0, 5)) {
      const text = result.content || result.snippet || "";
      if (text.length < 30) continue;

      const { value: sourceId } = await convexMutation("sources:create", {
        ownerId,
        notebookId,
        fileName: result.title || new URL(result.url).hostname,
        fileType: "text/html",
        fileSize: text.length,
        url: result.url,
      });

      await convexMutation("sources:updateStatus", { sourceId, status: "processing" });

      const chunks = chunkText(text);
      for (let i = 0; i < chunks.length; i++) {
        await convexMutation("chunks:create", {
          ownerId,
          sourceId,
          notebookId,
          content: chunks[i],
          chunkIndex: i,
          embeddingId: `emb_${sourceId}_${i}`,
        });
      }

      await convexMutation("sources:updateStatus", { sourceId, status: "completed" });
      created.push(sourceId);
    }

    return NextResponse.json({ ...data, sourcesCreated: created.length });
  } catch (error) {
    console.error("Search+add error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Suche fehlgeschlagen" },
      { status: 500 }
    );
  }
}
