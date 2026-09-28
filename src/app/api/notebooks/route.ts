import { NextRequest, NextResponse } from "next/server";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { createNotebook, listNotebooks } from "@/lib/services/notebooks";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const { db } = getLocalContext();
  return NextResponse.json(await listNotebooks(db, user.id));
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });

  const { title, description } = await req.json();
  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "Titel ist erforderlich" }, { status: 400 });
  }
  const { db } = getLocalContext();
  const id = await createNotebook(db, {
    ownerId: user.id,
    title: title.trim(),
    ...(description ? { description } : {}),
  });
  return NextResponse.json({ id });
}
