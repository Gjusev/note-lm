import { NextRequest, NextResponse } from "next/server";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser } from "@/lib/server/local-user";
import { getChunksBySource, getSource } from "@/lib/services/sources";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const { id } = await params;
  const { db } = getLocalContext();
  const source = await getSource(db, id);
  if (!source || source.ownerId !== user.id) {
    return NextResponse.json({ error: "Quelle nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json(await getChunksBySource(db, id));
}
