// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { closeLocalDb, rawClient } from "@/db/local";
import { getLocalContext } from "@/lib/storage/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createClaim, listClaims } from "@/lib/services/claims";
import { listPendingReviews } from "@/lib/services/change-review";
import { listVersions, readVersionPages, readVersionSheet } from "@/lib/services/source-versions";
import { claimProcessingJob } from "@/lib/services/processing-jobs";
import { runProcessingJob } from "@/engine/processing";

/**
 * File re-import as version + csv pipeline (one coherent slice):
 * - sources.reimportVersion: a changed local file re-runs processing on the
 *   same source and lands a new immutable version + staleness proposals via
 *   the recordVersion hook; a byte-identical file is a no-op.
 * - csv: sources.importFile completes processing, the hook passes the csv
 *   contentType through, so a {kind:'sheet'} sidecar lands and
 *   calculations.run works over it — the e2e the calculations slice could
 *   not cover through a real import.
 */

let dir: string;
let ctx: ReturnType<typeof getLocalContext>;
let notebookId: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-source-reimport-"));
  process.env.NOTELM_DATA_DIR = dir;
  ctx = getLocalContext();
  notebookId = await createNotebook(ctx.db, { ownerId: "local", title: "Neuimport" });
});

afterEach(async () => {
  const { getLocalContext } = await import("@/lib/storage/local");
  const { closeLocalDb } = await import("@/db/local");
  closeLocalDb(getLocalContext().db); // releases WAL locks on Windows
  fs.rmSync(dir, { recursive: true, force: true });
});

/** One-page PDF with one recognizable line (pdf-lib, devDep). */
async function makePdf(line: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([420, 595]);
  page.drawText(line, { x: 40, y: 500, size: 12, font });
  return Buffer.from(await doc.save());
}

/** Absolute path of a temp file the engine ops can read. */
function writeTemp(name: string, bytes: Buffer): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
}

/** Engine op round trip; asserts ok and unwraps the result. */
async function dispatch(op: string, args: unknown): Promise<any> {
  const { handleEngineRequest } = await import("@/engine/dispatch");
  const res = await handleEngineRequest(op, args);
  expect(res.ok).toBe(true);
  return (res as any).result;
}

/** Claim + run every pending processing job (the engine loop's work, in-test). */
async function drainProcessing(): Promise<void> {
  for (;;) {
    const job = claimProcessingJob(ctx.db);
    if (!job) return;
    const outcome = await runProcessingJob(ctx, job.id, job.leaseToken!, job.sourceId);
    expect(outcome).toBe("completed");
  }
}

/** Import a file through the engine op and drive its processing to completion. */
async function importAndProcess(filePath: string, fileName: string, fileType: string): Promise<string> {
  const res = (await dispatch("sources.importFile", {
    path: filePath,
    notebookId,
    fileName,
    fileType,
  })) as { sourceId: string };
  await drainProcessing();
  return res.sourceId;
}

describe("csv pipeline end to end (importFile -> processing -> sheet sidecar -> calculation)", () => {
  it("a real csv upload completes processing, stores a sheet sidecar and the calculation runs over it", async () => {
    const csv = "name,mass\nalpha,10\nbeta,5\ngamma,20\n";
    const csvPath = writeTemp("messwerte.csv", Buffer.from(csv, "utf-8"));

    const sourceId = await importAndProcess(csvPath, "messwerte.csv", "text/csv");

    const source = rawClient(ctx.db)
      .prepare(`SELECT status FROM sources WHERE id = ?`)
      .get(sourceId) as { status: string };
    expect(source.status).toBe("completed");

    const versions = listVersions(ctx.db, sourceId);
    expect(versions).toHaveLength(1);
    expect(await readVersionSheet(ctx.store, versions[0].id)).toEqual([
      ["name", "mass"],
      ["alpha", "10"],
      ["beta", "5"],
      ["gamma", "20"],
    ]);
    // a sheet is not pages: honest null, never invented page texts
    expect(await readVersionPages(ctx.store, versions[0].id)).toBeNull();

    // full-pipeline e2e: the calculation runs over the sidecar the import produced
    const ran = (await dispatch("calculations.run", {
      notebookId,
      sourceId,
      op: "sum",
      column: "mass",
    })) as { operation: string; result: string; status: string };
    expect(ran).toMatchObject({ operation: "sum", result: "35", status: "ok" });
  });
});

describe("sources.reimportVersion (file re-import as a new version)", () => {
  it("re-importing changed bytes appends version 2 on the SAME source, keeps v1 resolvable and raises a staleness proposal", async () => {
    const v1Path = writeTemp("studie-v1.pdf", await makePdf("Der Wirkstoff kostet 14 Euro pro Packung."));
    const sourceId = await importAndProcess(v1Path, "studie.pdf", "application/pdf");

    const claim = await createClaim(ctx.db, {
      notebookId,
      ownerId: "local",
      text: "Der Wirkstoff kostet 14 Euro.",
      origin: "user",
      anchors: [{ sourceId, page: 1, quote: "Der Wirkstoff kostet 14 Euro pro Packung." }],
    });
    expect(claim.anchorCount).toBe(1);

    const v2Path = writeTemp("studie-v2.pdf", await makePdf("Der Wirkstoff kostet 9 Euro pro Packung."));
    const res = (await dispatch("sources.reimportVersion", {
      sourceId,
      path: v2Path,
      fileName: "studie-v2.pdf",
    })) as { jobId: string; unchanged: boolean };
    expect(res.jobId).toBeTruthy();
    expect(res.unchanged).toBe(false);
    await drainProcessing();

    // the SAME source row gains version 2 — no second source was created
    const versions = listVersions(ctx.db, sourceId);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    const nbSources = rawClient(ctx.db)
      .prepare(`SELECT COUNT(*) AS n FROM sources WHERE notebook_id = ?`)
      .get(notebookId) as { n: number };
    expect(nbSources.n).toBe(1);

    // v1 anchors still resolve to v1's bytes (never a silent version switch)
    const anchor = listClaims(ctx.db, notebookId).find((c) => c._id === claim.id)!.anchors[0];
    expect(anchor.sourceVersionId).toBe(versions[0].id);
    expect(await readVersionPages(ctx.store, anchor.sourceVersionId)).toEqual([
      expect.objectContaining({ page: 1, text: expect.stringContaining("14 Euro") }),
    ]);

    // staleness scan fired through the recordVersion hook: quote gone in v2
    const pending = listPendingReviews(ctx.db, notebookId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      claimId: claim.id,
      sourceId,
      fromVersion: 1,
      toVersion: 2,
      reason: "quote_missing",
    });
  });

  it("re-importing identical bytes answers unchanged: no new version, no job, no proposals", async () => {
    const v1Path = writeTemp("notizen.txt", Buffer.from("Ein Text mit dem Kernsatz."));
    const sourceId = await importAndProcess(v1Path, "notizen.txt", "text/plain");
    await createClaim(ctx.db, {
      notebookId,
      ownerId: "local",
      text: "Kernsatz-Behauptung",
      origin: "user",
      anchors: [{ sourceId, quote: "Ein Text mit dem Kernsatz." }],
    });

    const res = (await dispatch("sources.reimportVersion", { sourceId, path: v1Path })) as { unchanged: boolean };
    expect(res.unchanged).toBe(true);

    expect(listVersions(ctx.db, sourceId)).toHaveLength(1);
    expect(listPendingReviews(ctx.db, notebookId)).toHaveLength(0);
    const jobs = rawClient(ctx.db)
      .prepare(`SELECT COUNT(*) AS n FROM processing_jobs`)
      .get() as { n: number };
    expect(jobs.n).toBe(1); // only the original import job — nothing was enqueued
  });

  it("a re-import of a missing source answers a typed not_found", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const existing = writeTemp("egal.txt", Buffer.from("x"));
    const res = await handleEngineRequest("sources.reimportVersion", {
      sourceId: "fabricated-source-id",
      path: existing,
    });
    expect(res).toEqual({
      ok: false,
      error: { code: "not_found", message: expect.any(String) },
    });
  });
});
