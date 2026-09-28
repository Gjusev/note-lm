import { NextRequest, NextResponse } from "next/server";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser, assertSameOrigin } from "@/lib/server/local-user";
import { createSource } from "@/lib/services/sources";
import { userOwnsNotebook } from "@/lib/services/notebooks";
import { enqueueProcessingJob } from "@/lib/services/processing-jobs";

export const runtime = "nodejs";
export const maxDuration = 60; // only the upload itself; processing runs in the worker queue

const MAX_FILE_SIZE: Record<string, number> = {
  "application/pdf": (parseInt(process.env.MAX_PDF_MB || "20")) * 1024 * 1024,
  "text/plain": (parseInt(process.env.MAX_TEXT_MB || "5")) * 1024 * 1024,
  "text/markdown": (parseInt(process.env.MAX_TEXT_MB || "5")) * 1024 * 1024,
};

const AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/mp4", "audio/webm", "audio/ogg", "audio/flac"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"];

function getMaxSizeForType(fileType: string): number {
  if (MAX_FILE_SIZE[fileType]) return MAX_FILE_SIZE[fileType];
  if (AUDIO_TYPES.includes(fileType)) return (parseInt(process.env.MAX_AUDIO_MB || "50")) * 1024 * 1024;
  if (VIDEO_TYPES.includes(fileType)) return (parseInt(process.env.MAX_VIDEO_MB || "100")) * 1024 * 1024;
  return 5 * 1024 * 1024;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Ursprung nicht erlaubt" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const notebookId = formData.get("notebookId") as string | null;

  if (!file || !notebookId) {
    return NextResponse.json({ error: "file und notebookId sind erforderlich" }, { status: 400 });
  }

  const { db, store } = getLocalContext();
  if (!(await userOwnsNotebook(db, user.id, notebookId))) {
    return NextResponse.json({ error: "Notizbuch nicht gefunden" }, { status: 404 });
  }

  const rawType = file.type || "";
  const ext = file.name.split(".").pop()?.toLowerCase() || "";

  const EXT_MIME: Record<string, string> = {
    pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
    webm: "audio/webm", ogg: "audio/ogg", flac: "audio/flac",
    mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
  };
  const fileType = (rawType && rawType !== "application/octet-stream")
    ? rawType
    : (EXT_MIME[ext] || "application/octet-stream");
  const maxSize = getMaxSizeForType(fileType);

  if (file.size > maxSize) {
    return NextResponse.json(
      { error: `Datei zu groß. Maximal ${Math.round(maxSize / 1024 / 1024)} MB für diesen Dateityp.` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  console.log(`[UPLOAD] ${file.name} | rawType=${rawType} | resolved=${fileType} | size=${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

  // Bytes go to the local store; the source row points at them. If the DB
  // steps fail, the orphaned bytes are removed again.
  const stored = await store.save(buffer, { fileName: file.name, contentType: fileType });
  try {
    const sourceId = await createSource(db, {
      ownerId: user.id,
      notebookId,
      fileName: file.name,
      fileType,
      fileSize: file.size,
      storageId: stored.id,
    });

    // Extraction/transcription runs in the worker queue, not in this request.
    await enqueueProcessingJob(db, { ownerId: user.id, sourceId, notebookId });

    return NextResponse.json({ sourceId, processing: true });
  } catch (err) {
    await store.delete(stored.id);
    throw err;
  }
}
