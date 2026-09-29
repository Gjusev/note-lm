// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { AddressInfo } from "node:net";

// local http test server → allow the loopback fetch through the SSRF policy
process.env.INGEST_ALLOW_PRIVATE = "1";

import { openLocalDb, closeLocalDb, rawClient, type LocalDb } from "@/db/local";
import { LocalStore, type LocalContext } from "@/lib/storage/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource } from "@/lib/services/sources";
import { createImportJob, claimImportJob } from "@/lib/services/import-jobs";
import { enqueueProcessingJob, claimProcessingJob } from "@/lib/services/processing-jobs";
import {
  recordVersion,
  listVersions,
  getLatestVersion,
  readVersionPages,
} from "@/lib/services/source-versions";
import { runImportJob } from "@/engine/imports";
import { runProcessingJob } from "@/engine/processing";

/** Two-page PDF with a recognizable text line per page (pdf-lib, devDep). */
async function makePdf(pageTexts: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of pageTexts) {
    const page = doc.addPage([420, 595]);
    page.drawText(line, { x: 40, y: 500, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

let dir: string;
let db: LocalDb;
let ctx: LocalContext;
let notebookId: string;
let server: http.Server;
let baseUrl = "";

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-source-versions-"));
  db = openLocalDb(dir);
  ctx = { db, store: new LocalStore(db, dir), dataDir: dir };
  notebookId = await createNotebook(db, { ownerId: "local", title: "Versionen" });

  server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<html><head><title>Testseite</title></head><body>
<h1>Kapitel eins</h1><p>${"Lorem ipsum dolor sit amet, consetetur sadipscing elitr. ".repeat(40)}</p>
</body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/artikel`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A persisted source row to hang versions off. */
async function makeSource(fileName: string, contentType: string, buffer: Buffer): Promise<string> {
  const stored = await ctx.store.save(buffer, { fileName, contentType });
  return createSource(db, {
    ownerId: "local",
    notebookId,
    fileName,
    fileType: contentType,
    fileSize: buffer.length,
    storageId: stored.id,
  });
}

describe("source versioning (open-source-innovation-strategy 5A/5B)", () => {
  it("first import records version 1 with a pages sidecar", async () => {
    const sourceId = await makeSource("skript.pdf", "application/pdf", await makePdf(["Seite eins", "Seite zwei"]));
    const storageId = rawClient(db)
      .prepare(`SELECT storage_id AS id FROM sources WHERE id = ?`)
      .get(sourceId) as { id: string };

    const doc = await recordVersion(db, ctx.store, {
      sourceId,
      storageId: storageId.id,
      fileName: "skript.pdf",
      contentType: "application/pdf",
      buffer: await makePdf(["Seite eins", "Seite zwei"]),
    });

    expect(doc.version).toBe(1);
    expect(doc.unchanged).toBeUndefined();
    expect(doc.pageCount).toBe(2);
    expect(doc.fileHash).toMatch(/^[0-9a-f]{64}$/);
    const rows = listVersions(db, sourceId);
    expect(rows).toHaveLength(1);
    // sidecar lives under <dataDir>/files/versions/<versionId>.json
    const sidecarPath = path.join(dir, "files", "versions", `${doc.id}.json`);
    expect(fs.existsSync(sidecarPath)).toBe(true);
    const pages = await readVersionPages(ctx.store, doc.id);
    expect(pages).not.toBeNull();
    expect(pages).toHaveLength(2);
    expect(pages![0]).toMatchObject({ page: 1 });
    expect(pages!.map((p) => p.text).join(" ")).toContain("Seite eins");
    expect(pages!.map((p) => p.text).join(" ")).toContain("Seite zwei");
  });

  it("re-importing identical bytes dedupes to the same version (unchanged)", async () => {
    const sourceId = await makeSource("notizen.txt", "text/plain", Buffer.from("gleicher Inhalt"));
    const same = Buffer.from("gleicher Inhalt");

    const v1 = await recordVersion(db, ctx.store, {
      sourceId, fileName: "notizen.txt", contentType: "text/plain", buffer: same,
    });
    const again = await recordVersion(db, ctx.store, {
      sourceId, fileName: "notizen.txt", contentType: "text/plain", buffer: same,
    });

    expect(again.unchanged).toBe(true);
    expect(again.id).toBe(v1.id);
    expect(again.version).toBe(1);
    expect(listVersions(db, sourceId)).toHaveLength(1); // nothing appended, nothing written
    const sidecarCount = fs.readdirSync(path.join(dir, "files", "versions")).length;
    expect(sidecarCount).toBe(1);
  });

  it("re-importing changed bytes appends version 2 and keeps version 1 readable", async () => {
    const sourceId = await makeSource("notizen.txt", "text/plain", Buffer.from("alte Fassung"));

    const v1 = await recordVersion(db, ctx.store, {
      sourceId, fileName: "notizen.txt", contentType: "text/plain", buffer: Buffer.from("alte Fassung"),
    });
    const v2 = await recordVersion(db, ctx.store, {
      sourceId, fileName: "notizen.txt", contentType: "text/plain", buffer: Buffer.from("neue Fassung"),
    });

    expect(v2.version).toBe(2);
    expect(v2.unchanged).toBeUndefined();
    const all = listVersions(db, sourceId);
    expect(all.map((v) => v.version)).toEqual([1, 2]);
    const latest = getLatestVersion(db, sourceId);
    expect(latest?.version).toBe(2);
    // both versions stay readable — old bytes/pages are never destroyed
    const p1 = await readVersionPages(ctx.store, v1.id);
    const p2 = await readVersionPages(ctx.store, v2.id);
    expect(p1![0].text).toContain("alte Fassung");
    expect(p2![0].text).toContain("neue Fassung");
  });

  it("missing sidecar resolves to null, not invented pages", async () => {
    const sourceId = await makeSource("notizen.txt", "text/plain", Buffer.from("Inhalt"));
    const doc = await recordVersion(db, ctx.store, {
      sourceId, fileName: "notizen.txt", contentType: "text/plain", buffer: Buffer.from("Inhalt"),
    });

    fs.rmSync(path.join(dir, "files", "versions", `${doc.id}.json`));

    expect(await readVersionPages(ctx.store, doc.id)).toBeNull();
  });

  it("records a byteless version (honest unresolvable) when the original was not persisted", async () => {
    const sourceId = await makeSource("web.html", "text/html", Buffer.from("<p>x</p>"));
    const doc = await recordVersion(db, ctx.store, { sourceId });

    expect(doc.version).toBe(1);
    expect(doc.storageId).toBeNull();
    expect(doc.fileHash).toBeNull();
    expect(doc.pageCount).toBeNull();
    expect(listVersions(db, sourceId)).toHaveLength(1);
  });

  it("the engine import flow records a source_versions row on the real completion path", async () => {
    const jobId = createImportJob(db, {
      ownerId: "local",
      notebookId,
      url: baseUrl,
      provider: "web",
      kind: "page",
      resourceKey: `web:${baseUrl}`,
    }).jobId;
    const job = claimImportJob(db);
    expect(job?._id).toBe(jobId);

    const outcome = await runImportJob(ctx, job!);
    expect(outcome).toBe("completed");

    const sourceId = rawClient(db)
      .prepare(`SELECT source_id AS id FROM import_jobs WHERE id = ?`)
      .get(jobId) as { id: string };
    const rows = rawClient(db)
      .prepare(`SELECT version, storage_id, file_hash, page_count FROM source_versions WHERE source_id = ?`)
      .all(sourceId.id) as Array<{ version: number; storage_id: string | null; file_hash: string | null; page_count: number | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].storage_id).not.toBeNull(); // original bytes were persisted
    expect(rows[0].file_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].page_count).toBe(1); // html → single pseudo-page
  });

  it("the upload processing flow records a version of the persisted original bytes", async () => {
    const upload = Buffer.from("Hochgeladene Vorlesungsnotizen\nzweite Zeile");
    const sourceId = await makeSource("notizen.txt", "text/plain", upload);
    enqueueProcessingJob(db, { ownerId: "local", sourceId, notebookId });
    const job = claimProcessingJob(db);
    expect(job).not.toBeNull();
    const jobId = job!.id;

    const outcome = await runProcessingJob(ctx, jobId, job!.leaseToken!, job!.sourceId);
    expect(outcome).toBe("completed");

    const rows = rawClient(db)
      .prepare(`SELECT file_hash, page_count, storage_id FROM source_versions WHERE source_id = ?`)
      .all(sourceId) as Array<{ file_hash: string; page_count: number | null; storage_id: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].file_hash).toBe(createHash("sha256").update(upload).digest("hex"));
    expect(rows[0].page_count).toBe(1);
    expect(rows[0].storage_id).not.toBeNull();
    const pages = await readVersionPages(ctx.store, (listVersions(db, sourceId))[0].id);
    expect(pages![0].text).toContain("Hochgeladene Vorlesungsnotizen");
  });
});
