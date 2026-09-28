/**
 * Notebook export/restore (phase 6): a self-contained directory —
 * notebook.json (all rows, citations and ids preserved) + files/ (originals,
 * transcripts, generated audio). Restore into a fresh data dir reproduces
 * the notebook with references intact; restoring over an existing id fails
 * loudly instead of merging.
 */
import fs from "node:fs";
import path from "node:path";
import type { LocalDb } from "@/db/local";
import { rawClient } from "@/db/local";
import type { LocalStore } from "@/lib/storage/local";

interface ExportedNotebook {
  format: 1;
  exportedAt: number;
  notebook: Record<string, unknown>;
  sources: Array<Record<string, unknown>>;
  chunks: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  learningMaterials: Array<Record<string, unknown>>;
  importJobs: Array<Record<string, unknown>>;
  files: Array<{ id: string; fileName: string; contentType: string }>;
}

function all(sqlite: ReturnType<typeof rawClient>, table: string, where: string, arg: string) {
  return sqlite.prepare(`SELECT * FROM ${table} WHERE ${where} = ?`).all(arg) as Array<Record<string, unknown>>;
}

export async function exportNotebook(
  db: LocalDb,
  store: LocalStore,
  notebookId: string,
  targetDir: string
): Promise<{ documents: number; files: number }> {
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

  // referenced file ids (originals, transcripts, material audio)
  const fileIds = new Set<string>();
  for (const s of sources) {
    for (const key of ["storage_id", "transcript_storage_id"]) {
      if (typeof s[key] === "string") fileIds.add(s[key] as string);
    }
  }
  for (const m of materials) {
    if (typeof m["audio_file_id"] === "string") fileIds.add(m["audio_file_id"] as string);
  }

  fs.mkdirSync(path.join(targetDir, "files"), { recursive: true });
  const files: ExportedNotebook["files"] = [];
  for (const id of fileIds) {
    const row = await store.get(id);
    if (!row) continue; // already missing at export time — reported by absence
    fs.copyFileSync(path.resolve(storeDirOf(store), row.path), path.join(targetDir, "files", `${id}${path.extname(row.path)}`));
    files.push({ id, fileName: row.fileName, contentType: row.contentType });
  }

  const payload: ExportedNotebook = {
    format: 1,
    exportedAt: Date.now(),
    notebook,
    sources,
    chunks,
    messages,
    notes,
    learningMaterials: materials,
    importJobs: jobs,
    files,
  };
  fs.writeFileSync(path.join(targetDir, "notebook.json"), JSON.stringify(payload, null, 2));
  return { documents: sources.length, files: files.length };
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
): Promise<{ notebookId: string; documents: number; messagesWithCitations: number }> {
  const sqlite = rawClient(db);
  const payload = JSON.parse(
    fs.readFileSync(path.join(sourceDir, "notebook.json"), "utf8")
  ) as ExportedNotebook;
  if (payload.format !== 1) throw new Error("Unbekanntes Exportformat");

  const notebookId = payload.notebook["id"] as string;
  const exists = sqlite.prepare(`SELECT 1 FROM notebooks WHERE id = ?`).get(notebookId);
  if (exists) throw new Error("Notizbuch existiert bereits — Zusammenführen ist nicht erlaubt");

  // restore file bytes first (rows keep their ids)
  for (const f of payload.files) {
    const match = fs
      .readdirSync(path.join(sourceDir, "files"))
      .find((n) => n.startsWith(f.id));
    if (!match) continue;
    const bytes = fs.readFileSync(path.join(sourceDir, "files", match));
    const ext = path.extname(match);
    const rel = `files/${f.id}${ext}`;
    const dataDir = storeDirOf(store);
    fs.mkdirSync(path.join(dataDir, "files"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, rel), bytes);
    sqlite
      .prepare(
        `INSERT INTO files (id, path, file_name, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(f.id, rel, f.fileName, f.contentType, bytes.length, Date.now());
  }

  const insertRows = (table: string, rows: Array<Record<string, unknown>>) => {
    for (const row of rows) {
      const keys = Object.keys(row);
      sqlite
        .prepare(
          `INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(", ")})
           VALUES (${keys.map(() => "?").join(", ")})`
        )
        .run(...keys.map((k) => row[k]));
    }
  };

  insertRows("notebooks", [payload.notebook]);
  insertRows("sources", payload.sources);
  insertRows("chunks", payload.chunks);
  insertRows("messages", payload.messages);
  insertRows("notes", payload.notes);
  insertRows("learning_materials", payload.learningMaterials);
  insertRows("import_jobs", payload.importJobs);

  return {
    notebookId,
    documents: payload.sources.length,
    messagesWithCitations: payload.messages.filter((m) => m["citations"]).length,
  };
}
