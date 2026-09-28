import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { notes } from "@/db/local/schema";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { removeNote, updateNote } from "@/lib/services/notes";
import { userOwnsNotebook } from "@/lib/services/notebooks";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

async function ownedNote(db: ReturnType<typeof getLocalContext>["db"], noteId: string, userId: string) {
  const [note] = await db.select({ notebookId: notes.notebookId }).from(notes).where(eq(notes.id, noteId)).limit(1);
  if (!note) return false;
  return userOwnsNotebook(db, userId, note.notebookId);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });
  const { id } = await params;
  const { db } = getLocalContext();
  if (!(await ownedNote(db, id, user.id))) {
    return NextResponse.json({ error: "Notiz nicht gefunden" }, { status: 404 });
  }
  const { title, content } = await req.json();
  await updateNote(db, id, {
    ...(title !== undefined && { title }),
    ...(content !== undefined && { content }),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });
  const { id } = await params;
  const { db } = getLocalContext();
  if (!(await ownedNote(db, id, user.id))) {
    return NextResponse.json({ error: "Notiz nicht gefunden" }, { status: 404 });
  }
  await removeNote(db, id);
  return NextResponse.json({ ok: true });
}
