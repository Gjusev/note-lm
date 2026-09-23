import { NextRequest, NextResponse } from "next/server";
import { extractTextFromFile, chunkText } from "@/lib/text-extraction";
import { extractAudioFromVideo } from "@/lib/ffmpeg";
import { transcribeAudio } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 600; // 10 minutes for transcription/ffmpeg

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;
const INTERNAL_KEY = process.env.INTERNAL_API_KEY!;

function log(step: string, sourceId: string, extra?: string) {
  console.log(`[PROCESS][${sourceId.slice(0, 8)}] ${step}${extra ? ` — ${extra}` : ""}`);
}

async function convexMutation(path: string, args: Record<string, unknown>) {
  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify({ path, args }),
  });
  return res.json();
}

async function convexQuery(path: string, args: Record<string, unknown>) {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify({ path, args }),
  });
  return res.json();
}

async function getConvexFile(storageId: string): Promise<Buffer> {
  const { value: url } = await convexQuery("sources:getDownloadUrl", { storageId });
  const res = await fetch(url);
  return Buffer.from(await res.arrayBuffer());
}

function resolveFileType(fileType: string, fileName: string): string {
  if (fileType && fileType !== "application/octet-stream") return fileType;
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const EXT_MIME: Record<string, string> = {
    pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
    webm: "audio/webm", ogg: "audio/ogg", flac: "audio/flac",
    mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
  };
  return EXT_MIME[ext] || fileType;
}

export async function POST(req: NextRequest) {
  const { sourceId, notebookId, ownerId, fileType } = await req.json();

  if (!sourceId || !notebookId || !ownerId || !fileType) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const t0 = Date.now();
  log("START", sourceId, `type=${fileType}`);

  try {
    await convexMutation("sources:updateStatus", { sourceId, status: "processing" });
    log("STATUS → processing", sourceId);

    let text: string;

    const sourceData = (await convexQuery("sources:get", { sourceId })).value;
    const resolvedType = resolveFileType(fileType, sourceData?.fileName || "");
    log("RESOLVED TYPE", sourceId, `${fileType} → ${resolvedType}`);

    const isAudio = resolvedType.startsWith("audio/");
    const isVideo = resolvedType.startsWith("video/");
    const isDocument =
      resolvedType === "application/pdf" ||
      resolvedType === "text/plain" ||
      resolvedType === "text/markdown" ||
      resolvedType === "application/markdown";

    if (isDocument) {
      const buffer = sourceData?.storageId
        ? await getConvexFile(sourceData.storageId)
        : Buffer.alloc(0);
      log("FILE DOWNLOADED", sourceId, `${(buffer.length / 1024).toFixed(0)} KB`);
      text = await extractTextFromFile(buffer, resolvedType);
      log("TEXT EXTRACTED", sourceId, `${text.length} chars, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } else if (isAudio) {
      const buffer = sourceData?.storageId
        ? await getConvexFile(sourceData.storageId)
        : Buffer.alloc(0);
      const originalName = sourceData?.fileName || "audio.wav";
      const ext = originalName.split(".").pop()?.toLowerCase() || "wav";
      const supportedFormats = ["mp3", "wav", "m4a", "mp4", "webm", "ogg", "flac"];
      log("FILE DOWNLOADED", sourceId, `${originalName} ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
      if (supportedFormats.includes(ext)) {
        text = await transcribeAudio(buffer, originalName);
      } else {
        log("FFMPEG CONVERT", sourceId);
        const audioBuffer = await extractAudioFromVideo(buffer);
        text = await transcribeAudio(audioBuffer, "audio.mp3");
      }
      log("TRANSCRIPTION DONE", sourceId, `${text.length} chars, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } else if (isVideo) {
      const buffer = sourceData?.storageId
        ? await getConvexFile(sourceData.storageId)
        : Buffer.alloc(0);
      log("FILE DOWNLOADED", sourceId, `${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
      log("FFMPEG EXTRACT AUDIO", sourceId);
      const audioBuffer = await extractAudioFromVideo(buffer);
      log("FFMPEG DONE", sourceId, `${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB audio`);
      text = await transcribeAudio(audioBuffer, "audio.mp3");
      log("TRANSCRIPTION DONE", sourceId, `${text.length} chars, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } else {
      await convexMutation("sources:updateStatus", {
        sourceId, status: "error",
        errorMessage: `Nicht unterstützter Dateityp: ${resolvedType}`,
      });
      log("UNSUPPORTED TYPE", sourceId, resolvedType);
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    const chunks = chunkText(text);
    log("CHUNKING", sourceId, `${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
      await convexMutation("chunks:create", {
        ownerId, sourceId, notebookId,
        content: chunks[i], chunkIndex: i,
        embeddingId: `emb_${sourceId}_${i}`,
      });
    }
    log("CHUNKS SAVED", sourceId, `${chunks.length} chunks to Convex`);

    await convexMutation("sources:updateStatus", { sourceId, status: "completed" });
    log("DONE", sourceId, `total ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    return NextResponse.json({ success: true, chunksCreated: chunks.length });
  } catch (error) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[PROCESS][${sourceId.slice(0, 8)}] FAILED after ${elapsed}s:`, error);
    await convexMutation("sources:updateStatus", {
      sourceId, status: "error",
      errorMessage: error instanceof Error ? error.message : "Unbekannter Fehler",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 },
    );
  }
}
