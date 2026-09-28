import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import path from "node:path";
import { getLocalContext } from "@/lib/storage/local";
import { getSessionUser } from "@/lib/server/local-user";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Serve stored files by opaque id: originals, transcripts, generated audio.
 * Range-capable so <audio>/<video> players can seek (same-origin requests
 * carry the session cookie). Ids are immutable, so responses cache forever.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Ungültige Datei-ID" }, { status: 400 });
  }
  const { store, dataDir } = getLocalContext();
  const row = await store.get(id);
  if (!row) return NextResponse.json({ error: "Datei nicht gefunden" }, { status: 404 });

  const abs = path.resolve(dataDir, row.path);
  if (abs !== dataDir && !abs.startsWith(dataDir + path.sep)) {
    return NextResponse.json({ error: "Ungültiger Dateipfad" }, { status: 400 });
  }

  let size: number;
  try {
    size = (await fs.stat(abs)).size;
  } catch {
    return NextResponse.json({ error: "Datei nicht auf der Platte" }, { status: 410 });
  }

  const download = req.nextUrl.searchParams.get("download") === "1";
  // Active content types are never inlined: an imported HTML/SVG must not run
  // script on the app's origin. nosniff stops content-type sniffing games.
  const activeType = /^(text\/html|image\/svg|application\/xhtml|text\/xml|application\/xml)/i.test(row.contentType);
  const disposition =
    download || activeType
      ? `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName)}`
      : `inline; filename*=UTF-8''${encodeURIComponent(row.fileName)}`;

  const rangeHeader = req.headers.get("range");
  const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);

  if (match && (match[1] !== "" || match[2] !== "")) {
    let start = match[1] === "" ? size - Number(match[2]) : Number(match[1]);
    let end = match[2] === "" ? size - 1 : Number(match[2]);
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    if (match[1] === "") { start = Math.max(0, size - Number(match[2])); end = size - 1; }
    const stream = store.createStream(row, { start, end });
    return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": row.contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": disposition,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const stream = store.createStream(row);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": row.contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": disposition,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
