import { NextRequest, NextResponse } from "next/server";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { cancelImportJob, getImportJob, retryImportJob } from "@/lib/services/import-jobs";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ jobId: string }>;
}

async function getOwnedJob(db: ReturnType<typeof getLocalContext>["db"], jobId: string, userId: string) {
  const job = await getImportJob(db, jobId);
  return job && job.ownerId === userId ? job : null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  const { jobId } = await params;
  const { db } = getLocalContext();
  const job = await getOwnedJob(db, jobId, user.id);
  if (!job) return NextResponse.json({ error: "Job nicht gefunden" }, { status: 404 });
  return NextResponse.json({ job });
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });

  const { jobId } = await params;
  const { db } = getLocalContext();
  const job = await getOwnedJob(db, jobId, user.id);
  if (!job) return NextResponse.json({ error: "Job nicht gefunden" }, { status: 404 });

  const { action } = await req.json();
  try {
    if (action === "cancel") cancelImportJob(db, jobId);
    else if (action === "retry") retryImportJob(db, jobId);
    else return NextResponse.json({ error: "action muss 'cancel' oder 'retry' sein" }, { status: 400 });
  } catch (err) {
    // Terminal-state conflicts surface as a clean 409 (Convex parity)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Aktion fehlgeschlagen" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
