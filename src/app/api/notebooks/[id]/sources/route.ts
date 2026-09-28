import { NextRequest, NextResponse } from "next/server";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser } from "@/lib/server/local-user";
import { listSourcesByNotebook } from "@/lib/services/sources";
import { userOwnsNotebook } from "@/lib/services/notebooks";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const { id } = await params;
  const { db } = getLocalContext();
  if (!(await userOwnsNotebook(db, user.id, id))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json(await listSourcesByNotebook(db, id));
}
