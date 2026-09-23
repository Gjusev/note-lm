import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for large file uploads

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
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const notebookId = formData.get("notebookId") as string | null;
  const ownerId = formData.get("ownerId") as string | null;

  if (!file || !notebookId || !ownerId) {
    return NextResponse.json({ error: "file, notebookId und ownerId sind erforderlich" }, { status: 400 });
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

  // Upload to Convex storage via internal API
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;
  const uploadUrlRes = await fetch(`${convexUrl}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": process.env.INTERNAL_API_KEY!,
    },
    body: JSON.stringify({
      path: "sources:generateUploadUrl",
      args: {},
    }),
  });

  if (!uploadUrlRes.ok) {
    return NextResponse.json({ error: "Upload-URL konnte nicht generiert werden" }, { status: 500 });
  }

  const { value: uploadUrl } = await uploadUrlRes.json();

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": fileType },
    body: buffer,
  });

  if (!uploadRes.ok) {
    return NextResponse.json({ error: "Datei konnte nicht hochgeladen werden" }, { status: 500 });
  }

  const { storageId } = await uploadRes.json();

  // Create source record via internal API
  const sourceRes = await fetch(`${convexUrl}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": process.env.INTERNAL_API_KEY!,
    },
    body: JSON.stringify({
      path: "sources:create",
      args: {
        ownerId,
        notebookId,
        fileName: file.name,
        fileType,
        fileSize: file.size,
        storageId,
      },
    }),
  });

  if (!sourceRes.ok) {
    return NextResponse.json({ error: "Quelle konnte nicht erstellt werden" }, { status: 500 });
  }

  const { value: sourceId } = await sourceRes.json();

  // Trigger processing in the background (fire-and-forget)
  const host = req.headers.get("host") || `localhost:${process.env.PORT || 3000}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || `http://${host}`;
  console.log(`[UPLOAD] Triggering process: ${appUrl}/api/process | sourceId=${sourceId}`);
  fetch(`${appUrl}/api/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, notebookId, ownerId, fileType }),
  }).catch((err) => {
    console.error("Processing trigger failed:", err);
  });

  return NextResponse.json({
    sourceId,
    storageId,
    processing: true,
  });
}
