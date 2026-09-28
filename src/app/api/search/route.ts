import { NextRequest, NextResponse } from "next/server";
import { chunkText } from "@/lib/text-extraction";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { createSource, replaceChunks, updateSourceStatus } from "@/lib/services/sources";
import { userOwnsNotebook } from "@/lib/services/notebooks";
import { searchChunks } from "@/lib/services/search";

export const runtime = "nodejs";

const SEAR_ENDPOINT = process.env.SEAR_ENDPOINT;

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
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });

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

// Notebook-scoped local search (FTS5/BM25) — always available, no provider.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  const query = req.nextUrl.searchParams.get("q");
  const notebookId = req.nextUrl.searchParams.get("notebookId");
  if (!query) {
    return NextResponse.json({ error: "Suchbegriff erforderlich (?q=...)" }, { status: 400 });
  }

  const { db } = getLocalContext();

  if (notebookId) {
    if (!(await userOwnsNotebook(db, user.id, notebookId))) {
      return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
    }
    const hits = searchChunks(db, notebookId, query, 20);
    const results = hits.map((h) => ({
      chunkIndex: h.chunkIndex,
      sourceId: h.sourceId,
      content: h.content,
    }));
    return NextResponse.json({ results, scope: "notebook" });
  }

  // Web search is optional: it needs an explicit SearXNG endpoint
  if (!SEAR_ENDPOINT) {
    return NextResponse.json(
      { error: "Websuche ist nicht konfiguriert (SEAR_ENDPOINT fehlt). Die Notizbuch-Suche funktioniert mit ?notebookId= lokal." },
      { status: 501 }
    );
  }

  try {
    return NextResponse.json(await searchSear(query));
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Suche fehlgeschlagen" },
      { status: 500 }
    );
  }
}

// Web search + add selected results as sources to a notebook (optional provider)
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });

  const { query, notebookId, addResults } = await req.json();
  if (!query) {
    return NextResponse.json({ error: "Suchbegriff erforderlich" }, { status: 400 });
  }
  if (!SEAR_ENDPOINT) {
    return NextResponse.json(
      { error: "Websuche ist nicht konfiguriert (SEAR_ENDPOINT fehlt)." },
      { status: 501 }
    );
  }

  try {
    const data = await searchSear(query);

    if (!addResults || !notebookId) {
      return NextResponse.json(data);
    }
    const { db } = getLocalContext();
    if (!(await userOwnsNotebook(db, user.id, notebookId))) {
      return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
    }

    const results = data.results || [];
    const created: string[] = [];

    for (const result of results.slice(0, 5)) {
      const text = result.content || result.snippet || "";
      if (text.length < 30) continue;

      const sourceId = await createSource(db, {
        ownerId: user.id,
        notebookId,
        fileName: result.title || new URL(result.url).hostname,
        fileType: "text/html",
        fileSize: text.length,
        url: result.url,
      });

      await updateSourceStatus(db, sourceId, { status: "processing" });
      replaceChunks(db, { ownerId: user.id, sourceId, notebookId }, chunkText(text));
      await updateSourceStatus(db, sourceId, { status: "completed" });
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
