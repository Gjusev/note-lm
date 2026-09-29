// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLocalDb, closeLocalDb, rawClient, type LocalDb } from "@/db/local";
import { LocalStore } from "@/lib/storage/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource, replaceChunks, updateSourceStatus, updateSourceStorage } from "@/lib/services/sources";
import { createMessage } from "@/lib/services/messages";
import { createNote } from "@/lib/services/notes";
import { exportNotebook, importNotebook, NotebookImportError } from "@/lib/services/notebook-transfer";
import { createImportJob, claimImportJob } from "@/lib/services/import-jobs";
import { recordVersion, readVersionPages, readVersionSheet, listVersions } from "@/lib/services/source-versions";
import { createClaim, listClaims, resolveReview } from "@/lib/services/claims";
import { listPendingReviews } from "@/lib/services/change-review";
import { runCalculation, listCalculations } from "@/lib/services/calculations";
import { requestGeneration, updateMaterial } from "@/lib/services/learning-materials";

let dir: string;
let db: LocalDb;
let store: LocalStore;
let exportDir: string;
let restoreDir: string;
let notebookId: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-xfer-"));
  db = openLocalDb(dir);
  store = new LocalStore(db, dir);
  exportDir = path.join(dir, "export");
  restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-xfer-restore-"));

  notebookId = await createNotebook(db, { ownerId: "local", title: "Export Buch" });
  const sourceId = await createSource(db, {
    ownerId: "local", notebookId, fileName: "doc.txt", fileType: "text/plain", fileSize: 10,
  });
  replaceChunks(db, { ownerId: "local", sourceId, notebookId }, ["Zitronenbaum Inhalt"]);
  await updateSourceStatus(db, sourceId, { status: "completed" });
  await createMessage(db, {
    ownerId: "local", notebookId, role: "assistant", content: "Antwort [1].",
    citations: [{ sourceId, chunkIndex: 0, text: "Zitronenbaum Inhalt" }],
  });
  await createNote(db, { ownerId: "local", notebookId, title: "N", content: "C" });
});

afterEach(() => {
  closeLocalDb(db);
  // Windows can hold WAL handles a beat after close; cleanup must never mask
  // a test failure
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* retried on next run */ }
  try { fs.rmSync(restoreDir, { recursive: true, force: true }); } catch { /* retried on next run */ }
});

describe("notebook export/restore (phase 6)", () => {
  it("roundtrips a notebook with citations, notes and file bytes intact", async () => {
    // attach an original file to the source so bytes travel too
    const { updateSourceStatus: upd } = await import("@/lib/services/sources");
    const file = await store.save(Buffer.from("original bytes"), {
      fileName: "doc.txt", contentType: "text/plain",
    });
    await upd(db, (await import("@/lib/services/sources")).listSourcesByNotebook(db, notebookId)[0]._id, {
      status: "completed", transcriptStorageId: file.id,
    });

    const exported = await exportNotebook(db, store, notebookId, exportDir);
    expect(exported.documents).toBe(1);
    expect(exported.files).toBe(1);
    expect(fs.existsSync(path.join(exportDir, "notebook.json"))).toBe(true);

    // restore into a FRESH data dir
    const db2 = openLocalDb(restoreDir);
    const store2 = new LocalStore(db2, restoreDir);
    const restored = await importNotebook(db2, store2, exportDir);
    expect(restored.notebookId).toBe(notebookId);
    expect(restored.documents).toBe(1);
    expect(restored.messagesWithCitations).toBe(1);

    const { listMessagesByNotebook } = await import("@/lib/services/messages");
    const messages = await listMessagesByNotebook(db2, notebookId);
    expect(messages[0].citations?.[0].text).toBe("Zitronenbaum Inhalt");
    const { listNotesByNotebook } = await import("@/lib/services/notes");
    expect((await listNotesByNotebook(db2, notebookId))[0].title).toBe("N");
    // file bytes came across and resolve through the store
    const read = await store2.read(file.id);
    expect(read?.buffer.toString()).toBe("original bytes");

    // restoring the same export twice into the same db fails loudly
    await expect(importNotebook(db2, store2, exportDir)).rejects.toThrow(/existiert bereits/);
    closeLocalDb(db2);
  });
});

// ── I4: portable research package (manifest formatVersion 2) ───────────────

interface Fixture {
  sourceA: string; sourceB: string; sourceC: string;
  claimA: string; claimB: string;
  vA1: string; vA2: string; vB1: string; vB2: string; vC1: string; vC2: string;
  fileA1: string; fileA2: string; fileB1: string; fileB2: string; fileC1: string; fileC2: string;
  calcId: string; materialId: string;
}

const TEXT_A1 = Buffer.from("Erste Fassung: der Zitronenbaum steht im Garten.");
const TEXT_A2 = Buffer.from("Zweite Fassung ohne die Referenz.");
const TEXT_B1 = Buffer.from("Version eins erwaehnt den Kaufvertrag von 1994.");
const TEXT_B2 = Buffer.from("Version zwei ohne den Begriff.");
const CSV1 = Buffer.from("Stadt,Einwohner\nBerlin,30\nHamburg,12\n");
const CSV2 = Buffer.from("Stadt,Einwohner\nBerlin,50\nHamburg,12\n");

/** Rich notebook: two versions per source, a claim bound to the specific v1,
 * one pending (quote_missing) and one accepted review proposal, a calculation
 * pinned to the csv v1 and a material with provenance. */
async function seedResearchNotebook(): Promise<Fixture> {
  const ownerId = "local";
  const mk = async (fileName: string, fileType: string, content: Buffer, contentType: string) => {
    const sourceId = await createSource(db, { ownerId, notebookId, fileName, fileType, fileSize: content.length });
    const file = await store.save(content, { fileName, contentType });
    await updateSourceStorage(db, sourceId, { storageId: file.id });
    const version = await recordVersion(db, store, {
      sourceId, storageId: file.id, fileName, contentType, buffer: content,
    });
    return { sourceId, fileId: file.id, versionId: version.id };
  };
  const advance = async (sourceId: string, fileName: string, contentType: string, content: Buffer) => {
    const file = await store.save(content, { fileName, contentType });
    await updateSourceStorage(db, sourceId, { storageId: file.id });
    const version = await recordVersion(db, store, {
      sourceId, storageId: file.id, fileName, contentType, buffer: content,
    });
    return { fileId: file.id, versionId: version.id };
  };

  const a = await mk("brief.txt", "text/plain", TEXT_A1, "text/plain");
  const claimA = await createClaim(db, {
    notebookId, ownerId, text: "Der Baum steht im Garten.", origin: "user",
    anchors: [{ sourceId: a.sourceId, quote: "Zitronenbaum" }],
  });
  const a2 = await advance(a.sourceId, "brief.txt", "text/plain", TEXT_A2);

  const b = await mk("vertrag.txt", "text/plain", TEXT_B1, "text/plain");
  const claimB = await createClaim(db, {
    notebookId, ownerId, text: "Der Kaufvertrag stammt von 1994.", origin: "user",
    anchors: [{ sourceId: b.sourceId, quote: "Kaufvertrag" }],
  });
  const b2 = await advance(b.sourceId, "vertrag.txt", "text/plain", TEXT_B2);
  const pendingB = listPendingReviews(db, notebookId).find((p) => p.claimId === claimB.id);
  await resolveReview(db, store, {
    proposalId: pendingB!.id, decision: "accepted", note: "V2 geprüft: Begriff entfernt",
  });

  const c = await mk("tabelle.csv", "text/csv", CSV1, "text/csv");
  const calc = await runCalculation(db, store, {
    ownerId, notebookId, sourceVersionId: c.versionId, op: "sum", column: "Einwohner",
  });
  const c2 = await advance(c.sourceId, "tabelle.csv", "text/csv", CSV2);

  const materialId = await requestGeneration(db, { ownerId, notebookId, type: "summary" });
  await updateMaterial(db, materialId, {
    status: "completed", content: "Zusammenfassung",
    provenance: JSON.stringify({ [a.sourceId]: a2.versionId }),
  });

  return {
    sourceA: a.sourceId, sourceB: b.sourceId, sourceC: c.sourceId,
    claimA: claimA.id, claimB: claimB.id,
    vA1: a.versionId, vA2: a2.versionId, vB1: b.versionId, vB2: b2.versionId, vC1: c.versionId, vC2: c2.versionId,
    fileA1: a.fileId, fileA2: a2.fileId, fileB1: b.fileId, fileB2: b2.fileId, fileC1: c.fileId, fileC2: c2.fileId,
    calcId: calc.id, materialId,
  };
}

describe("portable research package (I4, formatVersion 2)", () => {
  it("roundtrips versions, sidecars, version-bound anchors, review history, a pinned calculation and material provenance", async () => {
    const f = await seedResearchNotebook();
    const exported = await exportNotebook(db, store, notebookId, exportDir);
    expect(exported.versions).toBe(6);
    expect(exported.files).toBe(12); // 6 blobs + 6 sidecars
    expect(exported.claims).toBe(2);

    const db2 = openLocalDb(restoreDir);
    const store2 = new LocalStore(db2, restoreDir);
    const restored = await importNotebook(db2, store2, exportDir);
    expect(restored.notebookId).toBe(notebookId);
    expect(restored.versions).toBe(6);

    // versions keep ids, hashes and bytes
    expect(listVersions(db2, f.sourceA).map((v) => v.id)).toEqual([f.vA1, f.vA2]);
    expect(listVersions(db2, f.sourceA).map((v) => v.version)).toEqual([1, 2]);
    expect((await store2.read(f.fileA1))?.buffer.toString()).toBe(TEXT_A1.toString());
    expect((await store2.read(f.fileA2))?.buffer.toString()).toBe(TEXT_A2.toString());
    expect(await readVersionPages(store2, f.vA1)).toEqual([{ page: 1, text: TEXT_A1.toString() }]);
    expect(await readVersionSheet(store2, f.vC1)).toEqual([["Stadt", "Einwohner"], ["Berlin", "30"], ["Hamburg", "12"]]);

    // the claim anchor is still bound to the SPECIFIC version id
    const claims = listClaims(db2, notebookId);
    expect(claims.find((c) => c._id === f.claimA)!.anchors[0].sourceVersionId).toBe(f.vA1);
    expect(claims.find((c) => c._id === f.claimB)!.anchors[0].sourceVersionId).toBe(f.vB1);

    // review proposals ride along with from/to history and the human note
    const proposals = rawClient(db2).prepare("SELECT * FROM review_proposals").all() as Array<Record<string, unknown>>;
    expect(proposals).toHaveLength(2);
    const pending = proposals.find((p) => p["status"] === "pending")!;
    expect(pending["from_version"]).toBe(1);
    expect(pending["to_version"]).toBe(2);
    const accepted = proposals.find((p) => p["status"] === "accepted")!;
    expect(accepted["note"]).toBe("V2 geprüft: Begriff entfernt");
    expect(accepted["resolved_at"]).toBeGreaterThan(0);

    // the calculation is still pinned to the csv v1 (its result stays honest)
    const calcs = listCalculations(db2, notebookId);
    expect(calcs).toHaveLength(1);
    expect(calcs[0].id).toBe(f.calcId);
    expect(calcs[0].sourceVersionId).toBe(f.vC1);
    expect(calcs[0].result).toBe("42");

    // material provenance rides along
    const matRow = rawClient(db2).prepare("SELECT provenance FROM learning_materials WHERE id = ?").get(f.materialId) as { provenance: string };
    expect(matRow.provenance).toBe(JSON.stringify({ [f.sourceA]: f.vA2 }));
  });

  it("fails loudly on a tampered file and restores nothing", async () => {
    await seedResearchNotebook();
    await exportNotebook(db, store, notebookId, exportDir);
    const manifest = JSON.parse(fs.readFileSync(path.join(exportDir, "notebook.json"), "utf8"));
    const blob = manifest.files.find((e: { relPath: string }) =>
      e.relPath.startsWith("files/") && !e.relPath.startsWith("files/versions/")
    );
    const tamperPath = path.join(exportDir, blob.relPath);
    fs.writeFileSync(tamperPath, Buffer.concat([fs.readFileSync(tamperPath), Buffer.from("TAMPERED")]));

    const db2 = openLocalDb(restoreDir);
    const store2 = new LocalStore(db2, restoreDir);
    await expect(importNotebook(db2, store2, exportDir)).rejects.toThrow(/Hash/);
    const counts = rawClient(db2).prepare(
      "SELECT (SELECT COUNT(*) FROM notebooks) AS n, (SELECT COUNT(*) FROM sources) AS s, (SELECT COUNT(*) FROM source_versions) AS v"
    ).get() as { n: number; s: number; v: number };
    expect(counts.n).toBe(0);
    expect(counts.s).toBe(0);
    expect(counts.v).toBe(0);
    closeLocalDb(db2);
  });

  it("exports metadata-only packages that import cleanly and invent nothing", async () => {
    const f = await seedResearchNotebook();
    const exported = await exportNotebook(db, store, notebookId, exportDir, { includeOriginals: false });
    expect(exported.files).toBe(0);
    expect(fs.existsSync(path.join(exportDir, "files"))).toBe(false);

    const db2 = openLocalDb(restoreDir);
    const store2 = new LocalStore(db2, restoreDir);
    const restored = await importNotebook(db2, store2, exportDir);
    expect(restored.notebookId).toBe(notebookId);

    // rows are all there, honest nulls everywhere
    expect(listVersions(db2, f.sourceA).map((v) => v.id)).toEqual([f.vA1, f.vA2]);
    expect(await store2.read(f.fileA1)).toBeNull();
    expect(await readVersionPages(store2, f.vA1)).toBeNull();
    expect(await readVersionSheet(store2, f.vC1)).toBeNull();

    // provenance rows survive and joins still resolve without originals
    const claimA = listClaims(db2, notebookId).find((c) => c._id === f.claimA)!;
    expect(claimA.anchors[0].sourceVersionId).toBe(f.vA1);
    const matRow = rawClient(db2).prepare("SELECT provenance FROM learning_materials WHERE id = ?").get(f.materialId) as { provenance: string };
    expect(matRow.provenance).toBe(JSON.stringify({ [f.sourceA]: f.vA2 }));
    closeLocalDb(db2);
  });

  it("writes a formatVersion-2 manifest with an exclusion note and no credential material", async () => {
    await seedResearchNotebook();
    await exportNotebook(db, store, notebookId, exportDir);
    const raw = fs.readFileSync(path.join(exportDir, "notebook.json"), "utf8");
    const manifest = JSON.parse(raw) as {
      formatVersion: number; createdAt: number; excluded: string[];
      files: Array<{ relPath: string; sha256: string; bytes: number }>;
    };
    expect(manifest.formatVersion).toBe(2);
    expect(typeof manifest.createdAt).toBe("number");
    expect(Array.isArray(manifest.excluded)).toBe(true);
    expect(manifest.excluded.length).toBeGreaterThan(0);
    expect(manifest.excluded.join(" ")).toContain("provider_runs");
    // no credential material anywhere in the manifest (crude but effective)
    expect(raw).not.toMatch(/apiKey|secret/i);
    // every included file is hash-stamped
    expect(manifest.files.length).toBeGreaterThan(0);
    for (const entry of manifest.files) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof entry.bytes).toBe("number");
      expect(typeof entry.relPath).toBe("string");
    }
  });
});

describe("notebook transfer via dispatch ops (I4)", () => {
  it("passes includeOriginals through notebook.export and roundtrips into a fresh data dir via notebook.import", async () => {
    const dispatchDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-xfer-dispatch-"));
    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-xfer-dispatch-import-"));
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-xfer-dispatch-export-"));
    const { getLocalContext } = await import("@/lib/storage/local");
    const { closeLocalDb } = await import("@/db/local");
    let ctx2: { db: LocalDb } | null = null;
    process.env.NOTELM_DATA_DIR = dispatchDir;
    try {
      const { handleEngineRequest } = await import("@/engine/dispatch");
      const ctx1 = getLocalContext();
      const nb = await createNotebook(ctx1.db, { ownerId: "local", title: "Dispatch Buch" });
      const src = await createSource(ctx1.db, { ownerId: "local", notebookId: nb, fileName: "d.txt", fileType: "text/plain", fileSize: 5 });
      const file = await ctx1.store.save(Buffer.from("Dispatch Bytes"), { fileName: "d.txt", contentType: "text/plain" });
      await updateSourceStorage(ctx1.db, src, { storageId: file.id });
      await recordVersion(ctx1.db, ctx1.store, {
        sourceId: src, storageId: file.id, fileName: "d.txt", contentType: "text/plain",
        buffer: Buffer.from("Dispatch Bytes"),
      });

      const res = await handleEngineRequest("notebook.export", { notebookId: nb, targetDir, includeOriginals: false });
      expect(res.ok, JSON.stringify(res)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, "notebook.json"), "utf8")) as { formatVersion: number; files: unknown[] };
      expect(manifest.formatVersion).toBe(2);
      expect(manifest.files).toHaveLength(0);
      closeLocalDb(ctx1.db); // release WAL locks before switching dirs

      // restore into a FRESH data dir, like a recipient would
      process.env.NOTELM_DATA_DIR = importDir;
      ctx2 = getLocalContext();
      const res2 = await handleEngineRequest("notebook.import", { sourceDir: targetDir });
      expect(res2.ok, JSON.stringify(res2)).toBe(true);
      expect((res2 as { result: { notebookId: string } }).result.notebookId).toBe(nb);
    } finally {
      if (ctx2) closeLocalDb(ctx2.db);
      fs.rmSync(dispatchDir, { recursive: true, force: true });
      fs.rmSync(importDir, { recursive: true, force: true });
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });
});

// ── package import hardening (reliability B) ────────────────────────────────

function readManifest(): { files: Array<{ relPath?: string; sha256: string; bytes: number }> } {
  return JSON.parse(fs.readFileSync(path.join(exportDir, "notebook.json"), "utf8"));
}

describe("package import hardening (reliability B)", () => {
  it("a relPath escaping the package dir fails the import before anything is written", async () => {
    await seedResearchNotebook();
    await exportNotebook(db, store, notebookId, exportDir);
    const manifest = readManifest();
    manifest.files.push({ relPath: "..\\..\\evil.bin", sha256: manifest.files[0].sha256, bytes: 4 });
    fs.writeFileSync(path.join(exportDir, "notebook.json"), JSON.stringify(manifest));

    const db2 = openLocalDb(restoreDir);
    const store2 = new LocalStore(db2, restoreDir);
    const err = await importNotebook(db2, store2, exportDir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotebookImportError);
    expect((err as Error).message).toContain("evil.bin");
    expect((err as Error).message).toMatch(/Paketverzeichnis/);
    // data dir untouched: no new files, no rows anywhere
    expect(fs.readdirSync(path.join(restoreDir, "files"))).toEqual([]);
    const counts = rawClient(db2).prepare(
      "SELECT (SELECT COUNT(*) FROM notebooks) AS n, (SELECT COUNT(*) FROM sources) AS s, (SELECT COUNT(*) FROM claims) AS c"
    ).get() as { n: number; s: number; c: number };
    expect(counts).toEqual({ n: 0, s: 0, c: 0 });
    closeLocalDb(db2);
  });

  it("an absolute or drive-letter relPath is rejected", async () => {
    await seedResearchNotebook();
    await exportNotebook(db, store, notebookId, exportDir);
    const db2 = openLocalDb(restoreDir);
    const store2 = new LocalStore(db2, restoreDir);
    for (const bad of ["/etc/passwd", "C:\\Windows\\evil.txt"]) {
      const manifest = readManifest();
      manifest.files.push({ relPath: bad, sha256: manifest.files[0].sha256, bytes: 1 });
      fs.writeFileSync(path.join(exportDir, "notebook.json"), JSON.stringify(manifest));
      const err = await importNotebook(db2, store2, exportDir).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotebookImportError);
      expect((err as Error).message).toContain(bad);
      manifest.files.pop();
      fs.writeFileSync(path.join(exportDir, "notebook.json"), JSON.stringify(manifest));
    }
    expect(fs.readdirSync(path.join(restoreDir, "files"))).toEqual([]);
    closeLocalDb(db2);
  });

  it("a mid-restore DB failure rolls back files and rows", async () => {
    await seedResearchNotebook();
    await exportNotebook(db, store, notebookId, exportDir);

    const db2 = openLocalDb(restoreDir);
    const store2 = new LocalStore(db2, restoreDir);
    // deterministic injection: the claims INSERT explodes mid-restore — after
    // files were already placed and most rows were written
    const sqlite = rawClient(db2);
    const origPrepare = sqlite.prepare.bind(sqlite);
    (sqlite as unknown as { prepare?: unknown }).prepare = (sql: string) => {
      if (sql.includes("INSERT INTO claims")) throw new Error("Injektion: Einfügen fehlgeschlagen");
      return origPrepare(sql);
    };
    await expect(importNotebook(db2, store2, exportDir)).rejects.toThrow(/Injektion/);
    delete (sqlite as unknown as { prepare?: unknown }).prepare;

    // nothing landed: no rows ...
    const counts = rawClient(db2).prepare(
      "SELECT (SELECT COUNT(*) FROM notebooks) AS n, (SELECT COUNT(*) from sources) AS s, (SELECT COUNT(*) FROM claims) AS c, (SELECT COUNT(*) FROM source_versions) AS v"
    ).get() as Record<string, number>;
    expect(counts).toEqual({ n: 0, s: 0, c: 0, v: 0 });
    // ... and no files left in the data dir
    expect(fs.readdirSync(path.join(restoreDir, "files"))).toEqual([]);
    closeLocalDb(db2);
  });

  it("imported jobs are restored as cancelled and never execute", async () => {
    await createImportJob(db, {
      ownerId: "local", notebookId,
      url: "https://example.org/artikel", provider: "url", kind: "webpage",
      resourceKey: "example.org/artikel",
    });
    await exportNotebook(db, store, notebookId, exportDir);

    const db2 = openLocalDb(restoreDir);
    const store2 = new LocalStore(db2, restoreDir);
    await importNotebook(db2, store2, exportDir);
    const job = rawClient(db2).prepare(
      "SELECT status, error_code, error_message, lease_token, lease_expires_at FROM import_jobs"
    ).get() as { status: string; error_code: string; error_message: string; lease_token: string | null };
    expect(job.status).toBe("cancelled");
    expect(job.error_code).toBe("imported");
    expect(job.error_message).toMatch(/nicht ausführen/);
    expect(job.lease_token).toBeNull();
    // the worker loop can never claim it
    expect(claimImportJob(db2)).toBeNull();
    closeLocalDb(db2);
  });
});
