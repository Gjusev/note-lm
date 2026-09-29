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
 *
 * Import hardening (reliability B): manifest relPaths are confined lexically
 * to the package dir (separators normalized first, absolute paths, drive
 * letters and `..` escapes rejected with a typed NotebookImportError) BEFORE
 * any hash is verified. Files are copied into a staging dir, then placed into
 * the data dir and all rows written inside ONE BEGIN IMMEDIATE transaction —
 * a mid-restore failure rolls the rows back atomically and removes every file
 * the import already placed (plus the dirs it created), so a package either
 * restores fully or leaves the data dir untouched. Imported import_jobs rows
 * are restored only as historical records: status 'cancelled' with a German
 * note, unclaimable by the worker loop (provenance story keeps the history).
 * processing_jobs are not part of the transfer format (v1 or v2) — the
 * manifest cannot carry them and the restore inserts none, so no imported
 * package can enqueue processing work.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
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

/** Typed failure for a rejected package: a manifest relPath that is not a
 *  safe relative path inside the package dir. The UI can distinguish it from
 *  generic I/O errors; the message names the offending entry (German). */
export class NotebookImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotebookImportError";
  }
}

/**
 * Lexical path confinement for a manifest relPath. Separators are normalized
 * FIRST (a backslash trick must fail on every OS), absolute paths and drive
 * letters are rejected outright, and the result must resolve INSIDE
 * packageDir — no `..` escape survives. Lexical only: the package tree is
 * copied byte-wise, never followed through symlinks, so no realpath is
 * needed. Returns the confined absolute path plus the normalized relative
 * form for filesystem targets.
 */
function confineRelPath(packageDir: string, relPath: string): { abs: string; rel: string } {
  const fail = (reason: string): never => {
    throw new NotebookImportError(`Unsicheres Paket: der Pfad "${relPath}" ${reason}`);
  };
  if (typeof relPath !== "string" || relPath.trim() === "") fail("ist kein gültiger Dateipfad.");
  // backslashes are separators in every package (Windows round-trip)
  const unified = relPath.replace(/[\\/]+/g, path.sep);
  if (path.isAbsolute(unified) || /^[A-Za-z]:/.test(unified)) {
    fail("ist kein relativer Pfad (absolut oder mit Laufwerksbuchstaben).");
  }
  const abs = path.normalize(path.join(packageDir, unified));
  // strictly inside: "." or "files/.." resolving to the package dir itself is
  // also rejected
  if (!abs.startsWith(packageDir + path.sep)) fail("verlässt das Paketverzeichnis.");
  return { abs, rel: unified };
}

/** Imported URL-import jobs are historical records only: cancelled so no
 *  worker loop can ever claim them, with a German note for the user. */
const IMPORTED_JOB_NOTE = "Importiert – nicht ausführen";

function neutralizeImportedJob(job: Row): Row {
  return {
    ...job,
    status: "cancelled",
    error_code: "imported",
    error_message: IMPORTED_JOB_NOTE,
    lease_token: null,
    lease_expires_at: null,
  };
}

/**
 * Best-effort removal of everything this import already placed in the data
 * dir (called after the row-restore transaction rolled back). Files go first
 * (reverse order), then the dirs the import created — rmdir fails on a
 * non-empty dir, so we can never delete data we did not create ourselves.
 */
function rollbackFiles(written: string[], createdDirs: string[]): void {
  for (const abs of [...written].reverse()) {
    try {
      fs.rmSync(abs, { force: true });
    } catch {
      // rows are rolled back already; a leftover orphan file beats masking
      // the original error
    }
  }
  for (const dir of [...createdDirs].reverse()) {
    try {
      fs.rmdirSync(dir); // fails on non-empty: only ever removes empty dirs
    } catch {
      // non-empty or already gone — leave it, rows are rolled back anyway
    }
  }
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

  const packageDir = path.resolve(sourceDir);

  // 1. path confinement BEFORE hashing: a hostile relPath must not even be
  //    read. Order: manifest schema -> paths -> hashes -> restore.
  for (const f of payload.files) {
    if (!f.relPath) continue; // legacy format-1 entries carry ids only
    confineRelPath(packageDir, f.relPath);
  }

  // 2. verify every packaged file BEFORE restoring anything (strategy 8:
  //    hash check at import). A missing or mismatched file fails loudly with
  //    NOTHING written. Legacy entries (no sha256) cannot be verified.
  for (const f of payload.files) {
    if (!f.sha256 || !f.relPath) continue; // legacy format-1 entry
    const abs = confineRelPath(packageDir, f.relPath).abs;
    if (!fs.existsSync(abs)) {
      throw new Error(`Paket unvollständig: Datei "${f.relPath}" fehlt.`);
    }
    const actual = sha256hex(fs.readFileSync(abs));
    if (f.sha256 !== actual) {
      throw new Error(`Paket beschädigt: Datei "${f.relPath}" stimmt nicht mit dem Manifest-Hash überein.`);
    }
  }

  // 3. stage every packaged file in a temp dir first (os-independent), so the
  //    data dir is only touched inside the restore transaction below.
  const dataDir = storeDirOf(store);
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-import-"));
  // tracked for rollback: every path written into the data dir
  const written: string[] = [];
  const createdDirs: string[] = [];
  /** mkdir that remembers what IT created (rollback only removes those) */
  const ensureDir = (abs: string): void => {
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(abs, { recursive: true });
      createdDirs.push(abs);
    }
  };

  try {
    const stagedFiles: Array<{
      rel: string; // normalized relative form (fs targets)
      rowPath: string; // manifest relPath, byte-exact for the files row
      stagingAbs: string;
      sidecar: boolean;
      entry: ExportedFileEntry;
    }> = [];
    for (const f of payload.files) {
      if (!f.relPath) continue; // legacy format-1: handled inside the txn
      const confined = confineRelPath(packageDir, f.relPath);
      const stagingAbs = path.join(stagingDir, confined.rel);
      fs.mkdirSync(path.dirname(stagingAbs), { recursive: true });
      fs.copyFileSync(confined.abs, stagingAbs);
      stagedFiles.push({
        rel: confined.rel,
        rowPath: f.relPath,
        stagingAbs,
        sidecar: confined.rel.replace(/\\/g, "/").startsWith("files/versions/"),
        entry: f,
      });
    }

    // 4. atomic restore: ONE BEGIN IMMEDIATE transaction wraps file placement
    //    AND every row insert (sync callbacks, better-sqlite3). Files are not
    //    transactional — they are tracked and removed if anything throws.
    const restoreAll = sqlite.transaction((): void => {
      for (const s of stagedFiles) {
        const dataAbs = path.join(dataDir, s.rel);
        ensureDir(path.dirname(dataAbs));
        fs.copyFileSync(s.stagingAbs, dataAbs);
        written.push(dataAbs);
        if (!s.sidecar) {
          insertFileRow(sqlite, s.entry.id!, s.rowPath, s.entry.fileName!, s.entry.contentType!, s.entry.bytes);
        }
      }

      // legacy format-1 packages: files match by id prefix, as before — same
      // tracking, same transaction
      for (const f of payload.files) {
        if (f.relPath) continue;
        const match = fs
          .readdirSync(path.join(packageDir, "files"))
          .find((n) => n.startsWith(f.id!));
        if (!match) continue;
        const bytes = fs.readFileSync(path.join(packageDir, "files", match));
        const ext = path.extname(match);
        const rel = `files/${f.id}${ext}`;
        const dataAbs = path.join(dataDir, "files", `${f.id}${ext}`);
        ensureDir(path.dirname(dataAbs));
        fs.writeFileSync(dataAbs, bytes);
        written.push(dataAbs);
        insertFileRow(sqlite, f.id!, rel, f.fileName!, f.contentType!, bytes.length);
      }

      // rows in foreign-key order (import dbs run with foreign_keys = ON);
      // a throw anywhere in here rolls the WHOLE phase back
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
      // imported jobs ride along ONLY as history: cancelled, never claimable
      insertRows(sqlite, "import_jobs", payload.importJobs.map(neutralizeImportedJob));
      insertRows(sqlite, "claims", payload.claims ?? []);
      insertRows(sqlite, "evidence_anchors", payload.anchors ?? []);
      insertRows(sqlite, "evidence_links", payload.links ?? []);
      insertRows(sqlite, "review_proposals", payload.reviews ?? []);
      insertRows(sqlite, "calculations", payload.calculations ?? []);
    });

    try {
      restoreAll.immediate();
    } catch (err) {
      // DB rolled back atomically; now remove what the file phase placed
      rollbackFiles(written, createdDirs);
      throw err;
    }
  } finally {
    // staging is garbage either way (success: copied, failure: partial)
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

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
