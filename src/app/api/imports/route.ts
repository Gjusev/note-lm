import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, userOwnsNotebook } from "@/lib/server/notebook-access";
import { convexMutation, convexQuery } from "@/lib/server/convex-api";
import { classifyUrl, providerEnabled } from "@/lib/ingestion/identify";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  const { url, notebookId } = await req.json();
  if (!url || !notebookId) {
    return NextResponse.json({ error: "url und notebookId sind erforderlich" }, { status: 400 });
  }

  let classified;
  try {
    classified = classifyUrl(url);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ungültige URL" },
      { status: 400 }
    );
  }

  if (!providerEnabled(classified.provider)) {
    return NextResponse.json({ error: `Anbieter '${classified.provider}' ist deaktiviert` }, { status: 400 });
  }

  if (!(await userOwnsNotebook(user.id, notebookId))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }

  const { value } = await convexMutation<{ value: { jobId: string; deduped: boolean } }>("importJobs:create", {
    ownerId: user.id,
    notebookId,
    url,
    provider: classified.provider,
    resourceKey: classified.resourceKey,
    ...(classified.externalId && { externalId: classified.externalId }),
    ...(classified.canonicalUrl && { canonicalUrl: classified.canonicalUrl }),
  });

  return NextResponse.json({ jobId: value.jobId, deduped: value.deduped, provider: classified.provider }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  const notebookId = new URL(req.url).searchParams.get("notebookId");
  if (!notebookId) {
    return NextResponse.json({ error: "notebookId ist erforderlich" }, { status: 400 });
  }
  if (!(await userOwnsNotebook(user.id, notebookId))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }

  const { value } = await convexQuery<{ value: unknown[] }>("importJobs:listByNotebook", { notebookId });
  return NextResponse.json({ jobs: value ?? [] });
}
