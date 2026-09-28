import { NextRequest, NextResponse } from "next/server";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { getMaterial, removeMaterial } from "@/lib/services/learning-materials";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const { id } = await params;
  const { db } = getLocalContext();
  const material = await getMaterial(db, id);
  if (!material || material.ownerId !== user.id) {
    return NextResponse.json({ error: "Material nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json(material);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });
  const { id } = await params;
  const { db, store } = getLocalContext();
  const material = await getMaterial(db, id);
  if (!material || material.ownerId !== user.id) {
    return NextResponse.json({ error: "Material nicht gefunden" }, { status: 404 });
  }
  await removeMaterial(db, store, id);
  return NextResponse.json({ ok: true });
}
