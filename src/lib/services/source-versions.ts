/**
 * Immutable source versions (open-source-innovation-strategy 5A/5B): every
 * completed import/upload snapshots the original bytes' hash + per-page texts
 * into a version row + sidecar JSON. Identical re-imports dedupe to the
 * latest version; changed bytes append. Older versions are never rewritten -
 * claims in later slices anchor to versions, never to the mutable source row.
 *
 * ponytail: pages re-extract via pdf-parse on every PDF recordVersion call
 * (the processing pipeline parsed the file once already); cache by file hash
 * if the double parse ever shows up in profiles.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { sourceVersions } from "@/db/local/schema";
import { PDFParse } from "pdf-parse";
import type { LocalStore } from "@/lib/storage/local";

export interface VersionPage {
  page: number; // 1-based
  text: string;
}

export interface VersionDoc {
  id: string;
  sourceId: string;
  version: number;
  storageId: string | null;
  fileHash: string | null;
  pageCount: number | null;
  createdAt: number;
  unchanged?: boolean;
}

function sha256hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Per-page texts of a PDF buffer (pdf-parse, same engine as extraction). */
async function extractPdfPages(buffer: Buffer): Promise<VersionPage[]> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.pages.map((p, i) => ({ page: i + 1, text: p.text }));
  } finally {
    await parser.destroy?.();
  }
}

/** RFC4180-ish CSV split: quoted fields with "" escapes and embedded
 * newlines; CRLF and LF both end a record. Trailing blank lines are dropped.
 * ponytail: single delimiter (comma) — semicolon/Excel dialects are a real
 * pilot file away. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (ch === "\r" && text[i + 1] === "\n") i++; // CRLF as one record end
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "");
}

/** Is this import a CSV table (sheet sidecar instead of page texts)? */
function isCsv(fileName?: string, contentType?: string): boolean {
  return (
    contentType === "text/csv" ||
    (fileName?.toLowerCase().endsWith(".csv") ?? false)
  );
}

function toDoc(row: typeof sourceVersions.$inferSelect): VersionDoc {
  return {
    id: row.id,
    sourceId: row.sourceId,
    version: row.version,
    storageId: row.storageId,
    fileHash: row.fileHash,
    pageCount: row.pageCount,
    createdAt: row.createdAt,
  };
}

/** Sidecar location: <dataDir>/files/versions/<versionId>.json */
function sidecarPath(store: LocalStore, versionId: string): string {
  return path.join(store.dataDir, "files", "versions", `${versionId}.json`);
}

/**
 * Snapshot the original bytes of a source as the next immutable version.
 * - same sha256 as the LATEST version -> return that version, unchanged, write nothing
 * - changed/new bytes -> append max(version)+1, extract pages (PDFs via
 *   pdf-parse, anything else one pseudo-page; explicit pageTexts win) and
 *   write the sidecar
 * - no bytes and no pageTexts (original never persisted) -> an honest
 *   unresolvable row: no storage, no hash, no sidecar, page_count null
 */
export async function recordVersion(
  db: LocalDb,
  store: LocalStore,
  args: {
    sourceId: string;
    storageId?: string;
    fileName?: string;
    contentType?: string;
    buffer?: Buffer;
    pageTexts?: string[];
  }
): Promise<VersionDoc> {
  const fileHash = args.buffer ? sha256hex(args.buffer) : null;

  // identical bytes as the latest version: nothing new to remember
  const latest = getLatestVersion(db, args.sourceId);
  if (latest?.fileHash && fileHash && latest.fileHash === fileHash) {
    return { ...latest, unchanged: true };
  }

  let pages: VersionPage[] | null = null;
  let sheetRows: string[][] | null = null;
  if (args.buffer && isCsv(args.fileName, args.contentType)) {
    // 5C: a csv import's sidecar is a sheet ({kind:'sheet', rows}) — the
    // calculations slice runs deterministic ops over these rows instead of
    // pretending the table was a document with page texts
    sheetRows = parseCsvRows(args.buffer.toString("utf-8"));
  } else if (args.buffer && args.contentType === "application/pdf") {
    pages = await extractPdfPages(args.buffer);
  } else if (args.pageTexts) {
    pages = args.pageTexts.map((text, i) => ({ page: i + 1, text }));
  } else if (args.buffer) {
    pages = [{ page: 1, text: args.buffer.toString("utf-8") }];
  }

  const now = Date.now();
  const id = randomUUID();
  // append after the current max: versions are numbered 1, 2, 3, ... per source
  const maxRows = db
    .select({ maxV: sql<number>`coalesce(max(version), 0)` })
    .from(sourceVersions)
    .where(eq(sourceVersions.sourceId, args.sourceId))
    .all();
  const version = (maxRows[0]?.maxV ?? 0) + 1;

  let pageCount: number | null = null;
  if (sheetRows) {
    const target = sidecarPath(store, id);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify({ kind: "sheet", rows: sheetRows }));
  } else if (pages) {
    pageCount = pages.length;
    const target = sidecarPath(store, id);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify({ pages }));
  }

  db.insert(sourceVersions)
    .values({
      id,
      sourceId: args.sourceId,
      version,
      storageId: args.storageId ?? null,
      fileHash,
      pageCount,
      createdAt: now,
    })
    .run();

  // 5B hook: a newly appended version is a deterministic trigger for change
  // review. Dynamic import breaks the module cycle (change-review reads
  // versions back); non-fatal by design - a failed scan must never fail the
  // import that just landed.
  try {
    const { scanForStaleness } = await import("./change-review");
    await scanForStaleness(db, store, {
      sourceId: args.sourceId,
      fromVersion: version - 1,
      toVersionId: id,
    });
  } catch (err) {
    console.warn(
      "[source-versions] change review skipped:",
      err instanceof Error ? err.message : err
    );
  }

  return { id, sourceId: args.sourceId, version, storageId: args.storageId ?? null, fileHash, pageCount, createdAt: now };
}

export function listVersions(db: LocalDb, sourceId: string): VersionDoc[] {
  const rows = db
    .select()
    .from(sourceVersions)
    .where(eq(sourceVersions.sourceId, sourceId))
    .orderBy(asc(sourceVersions.version))
    .all();
  return rows.map(toDoc);
}

export function getLatestVersion(db: LocalDb, sourceId: string): VersionDoc | null {
  const row = db
    .select()
    .from(sourceVersions)
    .where(eq(sourceVersions.sourceId, sourceId))
    .orderBy(desc(sourceVersions.version))
    .limit(1)
    .get();
  return row ? toDoc(row) : null;
}

/** Page texts of one version from its sidecar; null when missing or corrupt
 * (callers show "unresolvable" honestly, they never invent pages). */
export async function readVersionPages(
  store: LocalStore,
  versionId: string
): Promise<VersionPage[] | null> {
  try {
    const raw = await fs.readFile(sidecarPath(store, versionId), "utf-8");
    const parsed = JSON.parse(raw) as { pages?: VersionPage[] };
    return Array.isArray(parsed.pages) ? parsed.pages : null;
  } catch {
    return null;
  }
}

/** CSV rows of one version from its sheet sidecar; null when the sidecar is
 * missing, corrupt or a pages sidecar (callers surface this as "not a
 * table", never as an empty table). */
export async function readVersionSheet(
  store: LocalStore,
  versionId: string
): Promise<string[][] | null> {
  try {
    const raw = await fs.readFile(sidecarPath(store, versionId), "utf-8");
    const parsed = JSON.parse(raw) as { rows?: string[][] };
    return Array.isArray(parsed.rows) ? parsed.rows : null;
  } catch {
    return null;
  }
}
