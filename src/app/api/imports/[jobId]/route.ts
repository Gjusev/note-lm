import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/notebook-access";
import { convexMutation, convexQuery } from "@/lib/server/convex-api";

export const runtime = "nodejs";

interface JobDoc {
  ownerId: string;
  status: string;
}

async function getOwnedJob(jobId: string, userId: string): Promise<JobDoc | null> {
  const { value } = await convexQuery<{ value: JobDoc | null }>("importJobs:get", { jobId });
  return value && value.ownerId === userId ? value : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  const { jobId } = await params;
  const job = await getOwnedJob(jobId, user.id);
  if (!job) return NextResponse.json({ error: "Job nicht gefunden" }, { status: 404 });
  return NextResponse.json({ job });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  const { jobId } = await params;
  const job = await getOwnedJob(jobId, user.id);
  if (!job) return NextResponse.json({ error: "Job nicht gefunden" }, { status: 404 });

  const { action } = await req.json();
  const path = action === "cancel" ? "importJobs:cancel" : action === "retry" ? "importJobs:retry" : null;
  if (!path) return NextResponse.json({ error: "action muss 'cancel' oder 'retry' sein" }, { status: 400 });

  const res = await convexMutation<{ errorMessage?: string }>(path, { jobId });
  if (res.errorMessage) {
    // Convex wraps thrown errors; surface a clean 409
    return NextResponse.json({ error: res.errorMessage }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
