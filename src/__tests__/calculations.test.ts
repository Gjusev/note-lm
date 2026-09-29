// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { closeLocalDb } from "@/db/local";
import { getLocalContext } from "@/lib/storage/local";
import {
  recordVersion,
  readVersionPages,
  readVersionSheet,
} from "@/lib/services/source-versions";
import {
  CalculationError,
  runCalculation,
  listCalculations,
} from "@/lib/services/calculations";

let dir: string;
let ctx: ReturnType<typeof getLocalContext>;
let notebookId: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-calculations-"));
  process.env.NOTELM_DATA_DIR = dir;
  ctx = getLocalContext();
  const { createNotebook } = await import("@/lib/services/notebooks");
  notebookId = await createNotebook(ctx.db, { ownerId: "local", title: "Calculations" });
});

afterEach(async () => {
  const { getLocalContext } = await import("@/lib/storage/local");
  const { closeLocalDb } = await import("@/db/local");
  closeLocalDb(getLocalContext().db); // releases WAL locks on Windows
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A persisted source + its first immutable version carrying csv bytes. */
async function makeCsvSource(csv: string): Promise<{ sourceId: string; versionId: string }> {
  const { createSource } = await import("@/lib/services/sources");
  const buffer = Buffer.from(csv, "utf-8");
  const stored = await ctx.store.save(buffer, { fileName: "data.csv", contentType: "text/csv" });
  const sourceId = await createSource(ctx.db, {
    ownerId: "local",
    notebookId,
    fileName: "data.csv",
    fileType: "text/csv",
    fileSize: buffer.length,
    storageId: stored.id,
  });
  const version = await recordVersion(ctx.db, ctx.store, {
    sourceId,
    storageId: stored.id,
    fileName: "data.csv",
    contentType: "text/csv",
    buffer,
  });
  return { sourceId, versionId: version.id };
}

describe("source version sidecar for CSV (open-source-innovation-strategy 5C)", () => {
  it("a csv version stores sheet rows in its sidecar, not pages", async () => {
    const { versionId } = await makeCsvSource("item,mass\nalpha,10\nbeta,5\n");
    expect(await readVersionSheet(ctx.store, versionId)).toEqual([
      ["item", "mass"],
      ["alpha", "10"],
      ["beta", "5"],
    ]);
    // a sheet is not pages: the page reader answers null honestly
    expect(await readVersionPages(ctx.store, versionId)).toBeNull();
  });

  it("the csv source is listed through the engine dispatch like any other source", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    await makeCsvSource("item,mass\nalpha,10\n");
    const listed = await handleEngineRequest("sources.list", { notebookId });
    const sources = (listed as { result: Array<{ fileName: string }> }).result;
    expect(sources).toHaveLength(1);
    expect(sources[0].fileName).toBe("data.csv");
  });
});

describe("runCalculation (open-source-innovation-strategy 5C / E4)", () => {
  it("sum/avg/min/max/count return exact independent literals", async () => {
    // worked example: masses 10, 5, 20, 5 -> sum 40, avg 10, min 5, max 20, count 4
    const { sourceId } = await makeCsvSource("name,mass\nalpha,10\nbeta,5\ngamma,20\ndelta,5\n");
    for (const [op, expected] of [
      ["sum", "40"], ["avg", "10"], ["min", "5"], ["max", "20"], ["count", "4"],
    ] as const) {
      const doc = await runCalculation(ctx.db, ctx.store, {
        ownerId: "local", notebookId, sourceId, op, column: "mass",
      });
      expect(doc.result).toBe(expected);
    }
    // the same column works by 0-based index
    const byIndex = await runCalculation(ctx.db, ctx.store, {
      ownerId: "local", notebookId, sourceId, op: "sum", column: 1,
    });
    expect(byIndex.result).toBe("40");
  });

  it("filter variant: sum where a column equals a constant", async () => {
    // worked example: value where group=a -> 3 + 7 = 10
    const { sourceId } = await makeCsvSource("group,value\na,3\nb,10\na,7\n");
    const doc = await runCalculation(ctx.db, ctx.store, {
      ownerId: "local", notebookId, sourceId, op: "sum", column: "value",
      filter: { column: "group", equals: "a" },
    });
    expect(doc.result).toBe("10");
  });

  it("a non-numeric cell blocks with a typed error naming row and column", async () => {
    const { sourceId } = await makeCsvSource("name,value\nalpha,3\nbeta,n/a\n");
    const err = await runCalculation(ctx.db, ctx.store, {
      ownerId: "local", notebookId, sourceId, op: "sum", column: "value",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CalculationError);
    const typed = err as CalculationError;
    expect(typed.code).toBe("not_a_number");
    expect(typed.message).toContain("Zeile 3"); // sheet row 3 (header is row 1)
    expect(typed.message).toContain('"value"');
    expect(typed.message).toContain("n/a");
  });

  it("an empty cell blocks sum (ambiguous) while count skips it", async () => {
    // documented distinction: absence blocks the numeric ops, count counts values
    const { sourceId } = await makeCsvSource("name,value\nalpha,3\nbeta,\ngamma,4\n");
    const sumErr = await runCalculation(ctx.db, ctx.store, {
      ownerId: "local", notebookId, sourceId, op: "sum", column: "value",
    }).catch((e: unknown) => e);
    expect(sumErr).toBeInstanceOf(CalculationError);
    expect((sumErr as CalculationError).code).toBe("ambiguous_cell");

    const counted = await runCalculation(ctx.db, ctx.store, {
      ownerId: "local", notebookId, sourceId, op: "count", column: "value",
    });
    expect(counted.result).toBe("2");
  });

  it("validation errors: missing header and unknown column", async () => {
    const onlyData = await makeCsvSource("3,5\n");
    await expect(runCalculation(ctx.db, ctx.store, {
      ownerId: "local", notebookId, sourceId: onlyData.sourceId, op: "sum", column: 0,
    })).rejects.toMatchObject({ code: "no_header" });

    const { sourceId } = await makeCsvSource("name,mass\nalpha,10\n");
    await expect(runCalculation(ctx.db, ctx.store, {
      ownerId: "local", notebookId, sourceId, op: "sum", column: "x",
    })).rejects.toMatchObject({ code: "unknown_column" });
  });

  it("a calculation pinned to an old version keeps that version's numbers after a changed re-import", async () => {
    const { sourceId, versionId } = await makeCsvSource("name,mass\nalpha,10\nbeta,5\n");
    const onV1 = await runCalculation(ctx.db, ctx.store, {
      ownerId: "local", notebookId, sourceId, op: "sum", column: "mass",
    });
    expect(onV1.result).toBe("15");
    expect(onV1.sourceVersionId).toBe(versionId);

    // re-import with changed values appends v2; the LATEST calculation moves,
    // the v1-pinned one does not
    await recordVersion(ctx.db, ctx.store, {
      sourceId,
      fileName: "data.csv",
      contentType: "text/csv",
      buffer: Buffer.from("name,mass\nalpha,100\nbeta,200\n", "utf-8"),
    });
    const onLatest = await runCalculation(ctx.db, ctx.store, {
      ownerId: "local", notebookId, sourceId, op: "sum", column: "mass",
    });
    expect(onLatest.result).toBe("300");
    const pinned = await runCalculation(ctx.db, ctx.store, {
      ownerId: "local", notebookId, sourceVersionId: versionId, op: "sum", column: "mass",
    });
    expect(pinned.result).toBe("15");
  });

  it("the same input twice records an identical result (determinism)", async () => {
    const { sourceId, versionId } = await makeCsvSource("name,mass\nalpha,10\nbeta,5\n");
    const first = await runCalculation(ctx.db, ctx.store, {
      ownerId: "local", notebookId, sourceId, op: "sum", column: "mass",
    });
    const second = await runCalculation(ctx.db, ctx.store, {
      ownerId: "local", notebookId, sourceId, op: "sum", column: "mass",
    });
    expect(second.result).toBe(first.result);
    expect(second.argsJson).toBe(first.argsJson);
    expect(second.sourceVersionId).toBe(versionId);
    expect(listCalculations(ctx.db, notebookId)).toHaveLength(2); // append-only audit
  });

  it("a version without a sheet sidecar is rejected honestly", async () => {
    const { createSource } = await import("@/lib/services/sources");
    const sourceId = await createSource(ctx.db, {
      ownerId: "local", notebookId, fileName: "gutachten.txt", fileType: "text/plain", fileSize: 10,
    });
    const version = await recordVersion(ctx.db, ctx.store, {
      sourceId, pageTexts: ["Ein Text auf einer Seite."],
    });
    await expect(runCalculation(ctx.db, ctx.store, {
      ownerId: "local", notebookId, sourceVersionId: version.id, op: "sum", column: 0,
    })).rejects.toMatchObject({ code: "not_a_sheet" });
  });
});

describe("calculations through the engine dispatch", () => {
  it("calculations.run and calculations.list roundtrip via engine ops", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");

    const { sourceId } = await makeCsvSource("name,mass\nalpha,10\nbeta,5\ngamma,20\ndelta,5\n");
    const ran = await handleEngineRequest("calculations.run", {
      notebookId, sourceId, op: "sum", column: "mass",
    });
    // 10 + 5 + 20 + 5 = 40
    expect(ran).toMatchObject({ ok: true, result: { operation: "sum", result: "40" } });

    const listed = await handleEngineRequest("calculations.list", { notebookId });
    const rows = (listed as { result: Array<{ operation: string; result: string }> }).result;
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe("sum");
    expect(rows[0].result).toBe("40");
  });

  it("blocked ops surface the typed error code through dispatch", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const { sourceId } = await makeCsvSource("name,value\nalpha,3\nbeta,n/a\n");
    const res = await handleEngineRequest("calculations.run", {
      notebookId, sourceId, op: "sum", column: "value",
    });
    expect(res).toMatchObject({
      ok: false,
      error: { code: "not_a_number", message: expect.stringContaining("Zeile 3") },
    });
  });
});
