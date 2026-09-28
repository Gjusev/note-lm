import { NextRequest, NextResponse } from "next/server";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { listMaterialsByNotebook, requestGeneration } from "@/lib/services/learning-materials";
import { userOwnsNotebook } from "@/lib/services/notebooks";
import type { MaterialType } from "@/db/local/schema";

export const runtime = "nodejs";

const MATERIAL_TYPES: MaterialType[] = [
  "summary", "flashcards", "quiz", "studyGuide", "keyInsights", "podcastSummary", "slides",
];

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const { id } = await params;
  const { db } = getLocalContext();
  if (!(await userOwnsNotebook(db, user.id, id))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json(await listMaterialsByNotebook(db, id));
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });
  const { id } = await params;
  const { db } = getLocalContext();
  if (!(await userOwnsNotebook(db, user.id, id))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }
  const { type } = await req.json();
  if (!MATERIAL_TYPES.includes(type)) {
    return NextResponse.json({ error: `Unbekannter Materialtyp: ${type}` }, { status: 400 });
  }
  const materialId = await requestGeneration(db, { ownerId: user.id, notebookId: id, type });
  return NextResponse.json({ id: materialId });
}
