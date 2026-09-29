/**
 * Notebook export/restore (phase 6 + I4 portable research package): a
 * self-contained directory — notebook.json manifest (all rows, provenance
 * tables, per-file sha256, explicit exclusion note) + files/ (originals,
 * transcripts, material audio) + files/versions/ (per-version sidecars).
 * Restore into a fresh data dir reproduces the notebook with references
 * intact. Hashes are verified for every packaged file BEFORE anything is
 * written; a mismatch fails loudly with nothing restored. Restoring over an
 * existing notebook id fails loudly instead of merging.
 *
 * formatVersion 2 (extends the phase-6 format): source versions + sidecars,
 * claims/anchors/links/reviews, calculations, material provenance (columns
 * ride along with the material rows) and a metadata-only mode
 * ({includeOriginals: false}) for sources that are not redistributable —
 * rows restore, evidence paths and sidecar reads stay honest nulls, nothing
 * is invented.
 *
 * Excluded by design (the manifest's `excluded` note records it): settings
 * rows, ai.connections/capabilities (credentials never travel with a
 * package), provider_runs (machine-local telemetry), model library rows and
 * files, and derived indexes (chunks_fts / vector — rebuilt locally).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LocalDb } from "@/db/local";
import { rawClient } from "@/db/local";
import type { LocalStore } from "@/lib/storage/local";

const FORMAT_VERSION = 2;

/** Everything a package deliberately leaves behind — machine-local or
 * credential-adjacent data never travels (open-source-innovation-strategy 8). */
const EXCLUDED_NOTE = [
  "settings (app configuration)",
  "ai.connections / ai.capabilities (provider configuration and credentials)",
  "provider_runs (machine-local telemetry)",
  "models (model library rows and files)",
  "derived indexes (chunks_fts, vector indexes — rebuilt locally)",
];

type Row = Record<string, unknown>;

interface ExportedFileEntry {
  /** files-row fields (blob entries only); sidecar entries carry just the
   * relPath/sha256/bytes triple. */
  id?: string;
  fileName?: string;
  contentType?: string;
  relPath: string;
  sha256: string;
  bytes: number;
}

interface ExportedNotebook {
  /** legacy format-1 packages carry only this */
  format?: 1;
  formatVersion: 2;
  createdAt: number;
  notebook: Row;
  sources: Row[];
  chunks: Row[];
  messages: Row[];
  notes: Row[];
  learningMaterials: Row[];
  importJobs: Row[];
  sourceVersions: Array<Row & { originalsIncluded?: boolean }>;
  claims: Row[];
  anchors: Row[];
  links: Row[];
  reviews: Row[];
  calculations: Row[];
  files: ExportedFileEntry[];
  excluded: string[];
}

function all(
  sqlite: ReturnType<typeof rawClient>,
  table: string,
  where: string,
  arg: string
): Array<Record<string, unknown>> {
  return sqlite.prepare(`SELECT * FROM ${table} WHERE ${where} = ?`).all(arg) as Array<
    Record<string, unknown>
  >;
}

function sha256hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Sidecar location under the data dir (same layout the restore writes to,
 * mirrored in source-versions.ts). */
function sidecarRel(versionId: string): string {
  return path.posix.join("files", "versions", `${versionId}.json`);
}

export interface ExportNotebookOptions {
  /**
   * false: rows only. Original blobs and version sidecars stay behind (a
   * shared notebook may carry only metadata and references when its sources
   * are not redistributable, strategy 8); every sourceVersions entry then
   * records originalsIncluded: false.
   */
  includeOriginals?: boolean;
}

export async function exportNotebook(
  db: LocalDb,
  store: LocalStore,
  notebookId: string,
  targetDir: string,
  options: ExportNotebookOptions = {}
): Promise<{ documents: number; files: number; versions: number; claims: number }> {
  const includeOriginals = options.includeOriginals ?? true;
  const sqlite = rawClient(db);
  const [notebook] = sqlite
    .prepare(`SELECT * FROM notebooks WHERE id = ?`)
    .all(notebookId) as Array<Record<string, unknown>>;
  if (!notebook) throw new Error("Notizbuch nicht gefunden");

  const sources = all(sqlite, "sources", "notebook_id", notebookId);
  const chunks = all(sqlite, "chunks", "notebook_id", notebookId);
  const messages = all(sqlite, "messages", "notebook_id", notebookId);
  const notes = all(sqlite, "notes", "notebook_id", notebookId);
  const materials = all(sqlite, "learning_materials", "notebook_id", notebookId);
  const jobs = all(sqlite, "import_jobs", "notebook_id", notebookId);

  // provenance tables: versions belong to the notebook's sources; anchors,
  // links and review proposals to the notebook's claims
  const versions: Row[] = [];
  for (const s of sources) {
    versions.push(...all(sqlite, "source_versions", "source_id", String(s["id"])));
  }
  const claims = all(sqlite, "claims", "notebook_id", notebookId);
  const calculations = all(sqlite, "calculations", "notebook_id", notebookId);
  const anchors: Row[] = [];
  const links: Row[] = [];
  const reviews: Row[] = [];
  for (const c of claims) {
    anchors.push(
      ...((sqlite
        .prepare(
          `SELECT ea.* FROM evidence_anchors ea
           JOIN evidence_links el ON el.anchor_id = ea.id
           WHERE el.claim_id = ?`
        )
        .all(String(c["id"]))) as Row[])
    );
  }
  for (const c of claims) {
    links.push(...all(sqlite, "evidence_links", "claim_id", String(c["id"])));
    reviews.push(...all(sqlite, "review_proposals", "claim_id", String(c["id"])));
  }
  // dedupe anchors shared by several claims
  const seen = new Set<string>();
  const anchorsDeduped = anchors.filter((a) => {
    const id = String(a["id"]);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // referenced file ids (originals, transcripts, material audio, version blobs)
  const fileIds = new Set<string>();
  for (const s of sources) {
    for (const key of ["storage_id", "transcript_storage_id"]) {
      if (typeof s[key] === "string") fileIds.add(s[key] as string);
    }
  }
  for (const v of versions) {
    if (typeof v["storage_id"] === "string") fileIds.add(v["storage_id"] as string);
  }
  for (const m of materials) {
    if (typeof m["audio_file_id"] === "string") fileIds.add(m["audio_file_id"] as string);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const files: ExportedFileEntry[] = [];
  const hashEntry = (relPath: string): ExportedFileEntry => {
    const bytes = fs.readFileSync(path.join(targetDir, relPath));
    return { relPath, sha256: sha256hex(bytes), bytes: bytes.length };
  };

  if (includeOriginals) {
    fs.mkdirSync(path.join(targetDir, "files", "versions"), { recursive: true });
    for (const id of fileIds) {
      const row = await store.get(id);
      if (!row) continue; // already missing at export time — reported by absence
      fs.copyFileSync(path.resolve(storeDirOf(store), row.path), path.join(targetDir, row.path));
      files.push({
        id,
        fileName: row.fileName,
        contentType: row.contentType,
        ...hashEntry(row.path),
      });
    }
    for (const v of versions) {
      const rel = sidecarRel(String(v["id"]));
      const srcAbs = path.join(store.dataDir, "files", "versions", `${v["id"]}.json`);
      if (!fs.existsSync(srcAbs)) continue; // version without sidecar (storage-only version)
      fs.copyFileSync(srcAbs, path.join(targetDir, rel));
      files.push(hashEntry(rel));
    }
  }

  const payload: ExportedNotebook = {
    formatVersion: 2,
    createdAt: Date.now(),
    notebook,
    sources,
    chunks,
    messages,
    notes,
    learningMaterials: materials,
    importJobs: jobs,
    sourceVersions: includeOriginals
      ? versions
      : versions.map((v) => ({ ...v, originalsIncluded: false })),
    claims,
    anchors: anchorsDeduped,
    links,
    reviews,
    calculations,
    files,
    excluded: EXCLUDED_NOTE,
  };
  fs.writeFileSync(path.join(targetDir, "notebook.json"), JSON.stringify(payload, null, 2));
  return { documents: sources.length, files: files.length, versions: versions.length, claims: claims.length };
}

/** Store exposes no dir; derive from any file row (files always live under
 *  <dataDir>). Kept honest: storage could expose dataDir directly later. */
function storeDirOf(store: LocalStore): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (store as any).dataDir as string;
}

export async function importNotebook(
  db: LocalDb,
  store: LocalStore,
  sourceDir: string
): Promise<{ notebookId: string; documents: number; messagesWithCitations: number; versions: number; claims: number }> {
  const sqlite = rawClient(db);
  const payload = JSON.parse(
    fs.readFileSync(path.join(sourceDir, "notebook.json"), "utf8")
  ) as ExportedNotebook;
  if (payload.formatVersion !== FORMAT_VERSION && payload.format !== 1) {
    throw new Error("Unbekanntes Exportformat");
  }

  const notebookId = payload.notebook["id"] as string;
  const exists = sqlite.prepare(`SELECT 1 FROM notebooks WHERE id = ?`).get(notebookId);
  if (exists) throw new Error("Notizbuch existiert bereits — Zusammenführen ist nicht erlaubt");

  // 1. verify every packaged file BEFORE restoring anything (strategy 8:
  //    hash check at import). A missing or mismatched file fails loudly with
  //    NOTHING written. Legacy entries (no sha256) cannot be verified.
  for (const f of payload.files) {
    if (!f.sha256 || !f.relPath) continue; // legacy format-1 entry
    const abs = path.join(sourceDir, f.relPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`Paket unvollständig: Datei "${f.relPath}" fehlt.`);
    }
    const actual = sha256hex(fs.readFileSync(abs));
    if (f.sha256 !== actual) {
      throw new Error(`Paket beschädigt: Datei "${f.relPath}" stimmt nicht mit dem Manifest-Hash überein.`);
    }
  }

  // 2. restore file bytes (rows keep their ids). Sidecars (files/versions/)
  //    are copied as-is; blobs are written to the same relative path and get
  //    their files row back.
  const dataDir = storeDirOf(store);
  for (const f of payload.files) {
    if (!f.relPath) {
      // legacy format-1 package: match by id prefix, as before
      const match = fs
        .readdirSync(path.join(sourceDir, "files"))
        .find((n) => n.startsWith(f.id!));
      if (!match) continue;
      const bytes = fs.readFileSync(path.join(sourceDir, "files", match));
      const ext = path.extname(match);
      const rel = `files/${f.id}${ext}`;
      fs.mkdirSync(path.join(dataDir, "files"), { recursive: true });
      fs.writeFileSync(path.join(dataDir, rel), bytes);
      insertFileRow(sqlite, f.id!, rel, f.fileName!, f.contentType!, bytes.length);
      continue;
    }
    const srcAbs = path.join(sourceDir, f.relPath);
    if (f.relPath.startsWith("files/versions/")) {
      fs.mkdirSync(path.dirname(path.join(dataDir, f.relPath)), { recursive: true });
      fs.copyFileSync(srcAbs, path.join(dataDir, f.relPath));
      continue; // sidecar: no files row
    }
    const bytes = fs.readFileSync(srcAbs);
    fs.mkdirSync(path.dirname(path.join(dataDir, f.relPath)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, f.relPath), bytes);
    insertFileRow(sqlite, f.id!, f.relPath, f.fileName!, f.contentType!, bytes.length);
  }

  // 3. rows in foreign-key order (import dbs run with foreign_keys = ON)
  const dropFlag = (entry: Row): Row => {
    const { originalsIncluded: _flag, ...row } = entry;
    return row;
  };
  insertRows(sqlite, "notebooks", [payload.notebook]);
  insertRows(sqlite, "sources", payload.sources);
  insertRows(sqlite, "source_versions", (payload.sourceVersions ?? []).map(dropFlag));
  insertRows(sqlite, "chunks", payload.chunks);
  insertRows(sqlite, "messages", payload.messages);
  insertRows(sqlite, "notes", payload.notes);
  insertRows(sqlite, "learning_materials", payload.learningMaterials);
  insertRows(sqlite, "import_jobs", payload.importJobs);
  insertRows(sqlite, "claims", payload.claims ?? []);
  insertRows(sqlite, "evidence_anchors", payload.anchors ?? []);
  insertRows(sqlite, "evidence_links", payload.links ?? []);
  insertRows(sqlite, "review_proposals", payload.reviews ?? []);
  insertRows(sqlite, "calculations", payload.calculations ?? []);

  return {
    notebookId,
    documents: payload.sources.length,
    messagesWithCitations: payload.messages.filter((m) => m["citations"]).length,
    versions: (payload.sourceVersions ?? []).length,
    claims: (payload.claims ?? []).length,
  };
}

/** One files row from a manifest entry (id/path/metadata as recorded). */
function insertFileRow(
  sqlite: ReturnType<typeof rawClient>,
  id: string,
  rel: string,
  fileName: string,
  contentType: string,
  size: number
): void {
  sqlite
    .prepare(
      `INSERT INTO files (id, path, file_name, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, rel, fileName, contentType, size, Date.now());
}

function insertRows(sqlite: ReturnType<typeof rawClient>, table: string, rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    const keys = Object.keys(row);
    sqlite
      .prepare(
        `INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(", ")})
         VALUES (${keys.map(() => "?").join(", ")})`
      )
      .run(...keys.map((k) => row[k]));
  }
}
