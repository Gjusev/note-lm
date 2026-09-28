import { NextRequest, NextResponse } from "next/server";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { getSource, removeSource } from "@/lib/services/sources";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const { id } = await params;
  const { db } = getLocalContext();
  const source = await getSource(db, id);
  if (!source || source.ownerId !== user.id) {
    return NextResponse.json({ error: "Quelle nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json(source);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });
  const { id } = await params;
  const { db, store } = getLocalContext();
  const source = await getSource(db, id);
  if (!source || source.ownerId !== user.id) {
    return NextResponse.json({ error: "Quelle nicht gefunden" }, { status: 404 });
  }
  await removeSource(db, store, id);
  return NextResponse.json({ ok: true });
}
