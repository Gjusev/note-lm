import { NextRequest, NextResponse } from "next/server";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { clearMessagesByNotebook, createMessage, listMessagesByNotebook } from "@/lib/services/messages";
import { userOwnsNotebook } from "@/lib/services/notebooks";

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
  return NextResponse.json(await listMessagesByNotebook(db, id));
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
  const { role, content } = await req.json();
  if (!content || (role !== "user" && role !== "assistant")) {
    return NextResponse.json({ error: "role und content sind erforderlich" }, { status: 400 });
  }
  const messageId = await createMessage(db, { ownerId: user.id, notebookId: id, role, content });
  return NextResponse.json({ id: messageId });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });
  const { id } = await params;
  const { db } = getLocalContext();
  if (!(await userOwnsNotebook(db, user.id, id))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }
  await clearMessagesByNotebook(db, id);
  return NextResponse.json({ ok: true });
}
