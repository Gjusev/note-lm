import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { openLocalDb, resolveDataDir } from "@/db/local";
import { files } from "@/db/local/schema";

/**
 * Local file storage: metadata rows in SQLite + bytes on disk under
 * <dataDir>/files/. Writes go to tmp/ first and are renamed into place, so a
 * crash never leaves a half-written file visible under its final id.
 *
 * ponytail: buffers in memory for saves (uploads cap at ~100 MB today); stream
 * to disk with a size cap if large uploads become common.
 */

export interface StoredFile {
  id: string;
  path: string; // relative, POSIX separators
  fileName: string;
  contentType: string;
  size: number;
  createdAt: number;
}

const EXT_RE = /^[\w-]{1,16}$/;

export class LocalStore {
  constructor(
    private readonly db: LocalDb,
    private readonly dataDir: string
  ) {}

  private abs(relPath: string): string {
    const abs = path.resolve(this.dataDir, relPath);
    if (abs !== this.dataDir && !abs.startsWith(this.dataDir + path.sep)) {
      throw new Error("Ungültiger Dateipfad");
    }
    return abs;
  }

  async save(
    data: Buffer,
    opts: { fileName: string; contentType: string }
  ): Promise<StoredFile> {
    const id = randomUUID();
    const ext = opts.fileName.includes(".")
      ? opts.fileName.split(".").pop()!.toLowerCase()
      : "";
    const rel = path.posix.join("files", ext && EXT_RE.test(ext) ? `${id}.${ext}` : id);
    const abs = this.abs(rel);
    const tmpAbs = path.join(this.dataDir, "tmp", `${id}.part`);

    await fs.writeFile(tmpAbs, data);
    try {
      await fs.rename(tmpAbs, abs);
    } catch (err) {
      await fs.rm(tmpAbs, { force: true }).catch(() => {});
      throw err;
    }

    const row: StoredFile = {
      id,
      path: rel,
      fileName: opts.fileName,
      contentType: opts.contentType,
      size: data.length,
      createdAt: Date.now(),
    };
    await this.db.insert(files).values(row);
    return row;
  }

  async get(fileId: string): Promise<StoredFile | null> {
    const [row] = await this.db.select().from(files).where(eq(files.id, fileId)).limit(1);
    return row ?? null;
  }

  /** Full-file buffer — for processing pipelines (extraction/transcription). */
  async read(fileId: string): Promise<{ buffer: Buffer; row: StoredFile } | null> {
    const row = await this.get(fileId);
    if (!row) return null;
    const buffer = await fs.readFile(this.abs(row.path));
    return { buffer, row };
  }

  /** Stream a byte range for HTTP serving (audio/video players send Range). */
  createStream(row: StoredFile, range?: { start: number; end: number }) {
    return createReadStream(this.abs(row.path), range);
  }

  /** Disk + row removal; tolerant when either side is already gone. */
  async delete(fileId: string): Promise<void> {
    const row = await this.get(fileId);
    if (row) {
      await fs.rm(this.abs(row.path), { force: true }).catch(() => {});
      await this.db.delete(files).where(eq(files.id, fileId));
    }
  }

  /** Public URL served by the app (opaque id, range-capable). */
  url(fileId: string): string {
    return `/api/files/${fileId}`;
  }
}

/** db + store + dataDir together, keyed by the resolved data dir. */
export interface LocalContext {
  db: LocalDb;
  store: LocalStore;
  dataDir: string;
}

export function getLocalContext(): LocalContext {
  const g = globalThis as { __notelmCtx?: LocalContext };
  const dataDir = resolveDataDir();
  if (g.__notelmCtx && g.__notelmCtx.dataDir === dataDir) return g.__notelmCtx;
  const db = openLocalDb(dataDir);
  const ctx: LocalContext = { db, store: new LocalStore(db, dataDir), dataDir };
  g.__notelmCtx = ctx;
  return ctx;
}
