import { NextRequest, NextResponse } from "next/server";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { getNotebook, removeNotebook, updateNotebook, userOwnsNotebook } from "@/lib/services/notebooks";

export const runtime = "nodejs";

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
  const notebook = await getNotebook(db, id);
  return NextResponse.json(notebook);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });
  const { id } = await params;
  const { db } = getLocalContext();
  if (!(await userOwnsNotebook(db, user.id, id))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }
  const { title, description } = await req.json();
  await updateNotebook(db, id, {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });
  const { id } = await params;
  const { db, store } = getLocalContext();
  if (!(await userOwnsNotebook(db, user.id, id))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }
  await removeNotebook(db, store, id);
  return NextResponse.json({ ok: true });
}
