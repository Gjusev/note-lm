import { NextRequest, NextResponse } from "next/server";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { userOwnsNotebook } from "@/lib/services/notebooks";
import { createImportJob, listImportJobsByNotebook } from "@/lib/services/import-jobs";
import { classifyUrl, providerEnabled } from "@/lib/ingestion/identify";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });

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

  const { db } = getLocalContext();
  if (!(await userOwnsNotebook(db, user.id, notebookId))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }

  const { jobId, deduped } = createImportJob(db, {
    ownerId: user.id,
    notebookId,
    url,
    provider: classified.provider,
    kind: classified.kind,
    resourceKey: classified.resourceKey,
    ...(classified.externalId && { externalId: classified.externalId }),
    ...(classified.canonicalUrl && { canonicalUrl: classified.canonicalUrl }),
  });

  return NextResponse.json({ jobId, deduped, provider: classified.provider }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  const notebookId = new URL(req.url).searchParams.get("notebookId");
  if (!notebookId) {
    return NextResponse.json({ error: "notebookId ist erforderlich" }, { status: 400 });
  }
  const { db } = getLocalContext();
  if (!(await userOwnsNotebook(db, user.id, notebookId))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }

  return NextResponse.json({ jobs: await listImportJobsByNotebook(db, notebookId) });
}
