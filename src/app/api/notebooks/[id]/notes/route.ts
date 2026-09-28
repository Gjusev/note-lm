import { NextRequest, NextResponse } from "next/server";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { createNote, listNotesByNotebook } from "@/lib/services/notes";
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
  return NextResponse.json(await listNotesByNotebook(db, id));
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
  const { title, content } = await req.json();
  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "Titel ist erforderlich" }, { status: 400 });
  }
  const noteId = await createNote(db, {
    ownerId: user.id,
    notebookId: id,
    title,
    content: content ?? "",
  });
  return NextResponse.json({ id: noteId });
}
