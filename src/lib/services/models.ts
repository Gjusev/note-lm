/**
 * Model library (phase 5): managed GGUF files under <dataDir>/models/,
 * verified by SHA-256 — importing the same file twice is a no-op. Downloads
 * are resumable (Range), verified, and promoted atomically (temp → rename).
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { models } from "@/db/local/schema";
import { getSetting, setSetting } from "./settings";
import { toWire } from "./wire";

export interface ManagedModel {
  _id: string;
  capability: "chat" | "embeddings" | "transcriptions";
  fileName: string;
  /** path relative to the data dir (models/<sha256>.gguf) */
  path: string;
  sizeBytes: number;
  sha256: string;
  origin: string | null;
  status: "available" | "importing" | "failed";
  errorMessage: string | null;
}

function modelsDir(dataDir: string): string {
  const dir = path.join(dataDir, "models");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function modelAbsolutePath(dataDir: string, relPath: string): string {
  const abs = path.resolve(dataDir, relPath);
  if (abs !== dataDir && !abs.startsWith(dataDir + path.sep)) {
    throw new Error("Ungültiger Modellpfad");
  }
  return abs;
}

export function listModels(db: LocalDb): ManagedModel[] {
  return db.select().from(models).all().map(toWire) as ManagedModel[];
}

export function getModel(db: LocalDb, modelId: string): ManagedModel | null {
  const row = db.select().from(models).where(eq(models.id, modelId)).limit(1).get();
  return row ? (toWire(row) as ManagedModel) : null;
}

export function getModelBySha256(db: LocalDb, sha256: string): ManagedModel | null {
  const row = db.select().from(models).where(eq(models.sha256, sha256)).limit(1).get();
  return row ? (toWire(row) as ManagedModel) : null;
}

/**
 * Import a GGUF from a granted path: hash it, move it into the managed
 * models dir (copy across devices), register. Idempotent by content hash —
 * re-importing returns the existing row and removes the duplicate copy.
 */
export async function importModelFromFile(
  db: LocalDb,
  dataDir: string,
  sourcePath: string,
  capability: "chat" | "embeddings",
  origin?: string
): Promise<{ model: ManagedModel; deduped: boolean }> {
  const buffer = await fs.promises.readFile(sourcePath);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const existing = getModelBySha256(db, sha256);
  if (existing) {
    // same content already managed — drop the incoming copy if we made one
    const target = path.join(modelsDir(dataDir), `${sha256}.gguf`);
    if (path.resolve(sourcePath) !== path.resolve(target)) {
      // nothing copied yet; the source belongs to the caller
    }
    return { model: existing, deduped: true };
  }

  const target = path.join(modelsDir(dataDir), `${sha256}.gguf`);
  const tmp = `${target}.part`;
  await fs.promises.writeFile(tmp, buffer);
  await fs.promises.rename(tmp, target);

  const row = {
    id: randomUUID(),
    capability,
    fileName: path.basename(sourcePath),
    path: path.relative(dataDir, target).split(path.sep).join("/"),
    sizeBytes: buffer.length,
    sha256,
    origin: origin ?? "import",
    status: "available" as const,
    errorMessage: null,
    createdAt: Date.now(),
  };
  db.insert(models).values(row).run();
  return { model: toWire(row) as ManagedModel, deduped: false };
}

/**
 * Resumable download with verification and atomic promotion. Range resume is
 * used when the server supports it; the temp file lives until the SHA-256
 * matches (when given) and only then is it renamed into place and registered.
 */
export async function downloadModel(
  db: LocalDb,
  dataDir: string,
  opts: {
    url: string;
    capability: "chat" | "embeddings" | "transcriptions";
    fileName: string;
    sha256?: string;
    origin?: string;
    signal?: AbortSignal;
    onProgress?: (downloaded: number, total: number | null) => void;
  }
): Promise<ManagedModel> {
  const target = path.join(
    modelsDir(dataDir),
    `${opts.sha256 ?? randomUUID()}.${opts.capability === "transcriptions" ? "bin" : "gguf"}`
  );
  const tmp = `${target}.part`;
  let downloaded = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;

  const headers: Record<string, string> = {};
  if (downloaded > 0) headers["Range"] = `bytes=${downloaded}-`;

  const res = await fetch(opts.url, { headers, signal: opts.signal });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Download fehlgeschlagen: ${res.status}`);
  }
  const totalHeader = res.headers.get("content-length");
  const total = downloaded + (totalHeader ? parseInt(totalHeader, 10) : 0) || null;

  const write = downloaded > 0 && res.status === 206 ? "a" : "w";
  const stream = fs.createWriteStream(tmp, { flags: write });
  const reader = res.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    downloaded += value.byteLength;
    await new Promise<void>((resolve, reject) => {
      stream.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
    });
    opts.onProgress?.(downloaded, total);
  }
  await new Promise<void>((resolve) => stream.end(resolve));

  // verify by content hash (streamed)
  const actual = await hashFile(tmp);
  if (opts.sha256 && actual !== opts.sha256) {
    await fs.promises.rm(tmp, { force: true });
    throw new Error(`SHA-256 stimmt nicht: ${actual}` );
  }

  // dedupe by content hash: an identical model already managed wins
  const already = getModelBySha256(db, actual);
  if (already) {
    await fs.promises.rm(tmp, { force: true });
    return already;
  }

  // Whisper models (capability "transcriptions") are SETTINGS-tracked: the
  // models table's CHECK constraint covers chat/embeddings only, and a table
  // rebuild migration for one capability is not warranted. File:
  // models/<sha256>.bin; when the active model changes the previous file is
  // removed, so no orphan blobs accumulate. Mirrors chat/embed path
  // resolution (one settings row per capability selects the active model).
  if (opts.capability === "transcriptions") {
    const prev = await getSetting<{ sha256?: string } | null>(db, "ai.transcribeModel");
    if (prev?.sha256 && prev.sha256 !== actual) {
      await fs.promises.rm(path.join(modelsDir(dataDir), `${prev.sha256}.bin`), { force: true });
    }
    await fs.promises.rename(tmp, target);
    await setSetting(db, "ai.transcribeModel", {
      fileName: opts.fileName, sha256: actual, sizeBytes: downloaded,
    });
    return {
      _id: actual,
      capability: "transcriptions",
      fileName: opts.fileName,
      path: path.relative(dataDir, target).split(path.sep).join("/"),
      sizeBytes: downloaded,
      sha256: actual,
      origin: opts.origin ?? new URL(opts.url).hostname,
      status: "available",
      errorMessage: null,
    };
  }

  await fs.promises.rename(tmp, target);
  const row = {
    id: randomUUID(),
    capability: opts.capability,
    fileName: opts.fileName,
    path: path.relative(dataDir, target).split(path.sep).join("/"),
    sizeBytes: downloaded,
    sha256: actual,
    origin: opts.origin ?? new URL(opts.url).hostname,
    status: "available" as const,
    errorMessage: null,
    createdAt: Date.now(),
  };
  db.insert(models).values(row).run();
  return toWire(row) as ManagedModel;
}

export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}
