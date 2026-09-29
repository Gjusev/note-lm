/**
 * Inspectable calculations (open-source-innovation-strategy 5C / E4): a
 * closed set of deterministic ops (sum/avg/min/max/count) over the rows of
 * an immutable source_versions row. The number is never an LLM product; the
 * calculation row (input version + query + result + timestamp) IS the
 * reproducibility record.
 *
 * Ambiguity policy (E4: "bloquear o marcar ambiguedad", v1 blocks):
 * - a non-numeric cell blocks the op with a typed error naming the sheet
 *   row (header = row 1) and column;
 * - an EMPTY cell is ambiguous: count skips it (absence of a value), the
 *   numeric ops block - a silent zero would fake the result;
 * - sum/avg/min/max over zero included values has no honest answer and
 *   blocks with no_data (count answers "0").
 * unit stays null in v1; units carried in headers ("Masse (kg)") are a later
 * refinement - args_json keeps the exact query either way.
 */
import { randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import { calculations, sources, sourceVersions } from "@/db/local/schema";
import { readVersionSheet } from "./source-versions";
import type { LocalStore } from "@/lib/storage/local";

export type CalcOp = "sum" | "avg" | "min" | "max" | "count";

export interface CalcFilter {
  column: string | number;
  equals: string;
}

/** Typed, user-facing errors (German copy). The engine dispatch passes the
 * code through 1:1 so the UI slice can offer specific remedies. */
export class CalculationError extends Error {
  constructor(
    public code:
      | "no_header"
      | "unknown_column"
      | "not_a_number"
      | "ambiguous_cell"
      | "no_data"
      | "not_a_sheet"
      | "not_found",
    message: string
  ) {
    super(message);
    this.name = "CalculationError";
  }
}

export interface CalculationDoc {
  id: string;
  sourceVersionId: string;
  operation: string;
  argsJson: string;
  result: string | null;
  unit: string | null;
  status: string;
  error: string | null;
  createdAt: number;
}

/** Resolve a column by header name (trimmed compare) or 0-based index. */
function resolveColumn(header: string[], column: string | number): number {
  if (typeof column === "number") {
    if (!Number.isInteger(column) || column < 0 || column >= header.length) {
      throw new CalculationError(
        "unknown_column",
        `Spalte ${column} existiert nicht. Die Tabelle hat ${header.length} Spalten.`
      );
    }
    return column;
  }
  const idx = header.findIndex((h) => h.trim() === String(column).trim());
  if (idx === -1) {
    throw new CalculationError(
      "unknown_column",
      `Spalte "${column}" existiert nicht. Vorhandene Spalten: ${header.join(", ") || "keine"}.`
    );
  }
  return idx;
}

/** Strict numeric coercion: the whole trimmed cell must be a finite number. */
function toNumber(cell: string): number {
  const n = Number(cell.trim());
  if (cell.trim() === "" || !Number.isFinite(n)) {
    throw new CalculationError("not_a_number", `"${cell}" ist keine Zahl.`);
  }
  return n;
}

/** Run one deterministic op against a version's sheet rows and record it.
 * The version is the source's LATEST unless sourceVersionId pins an older
 * one (reproducibility across re-imports). Blocked ops never insert a row -
 * the typed error is the answer. */
export async function runCalculation(
  db: LocalDb,
  store: LocalStore,
  args: {
    ownerId: string;
    notebookId: string;
    sourceId?: string;
    sourceVersionId?: string;
    op: CalcOp;
    column: string | number;
    filter?: CalcFilter;
  }
): Promise<CalculationDoc> {
  // resolve the version: explicit pin wins over the source's LATEST
  let versionRow: typeof sourceVersions.$inferSelect | undefined;
  if (args.sourceVersionId) {
    versionRow = db
      .select()
      .from(sourceVersions)
      .where(eq(sourceVersions.id, args.sourceVersionId))
      .get();
  } else if (args.sourceId) {
    versionRow = db
      .select()
      .from(sourceVersions)
      .where(eq(sourceVersions.sourceId, args.sourceId))
      .orderBy(desc(sourceVersions.version))
      .get();
  }
  if (!versionRow) {
    throw new CalculationError("not_found", "Keine aufgezeichnete Version dieser Quelle gefunden.");
  }

  // the version must belong to a source of THIS notebook (no cross-notebook reads)
  const sourceRow = db
    .select({ id: sources.id, notebookId: sources.notebookId })
    .from(sources)
    .where(eq(sources.id, versionRow.sourceId))
    .get();
  if (!sourceRow || sourceRow.notebookId !== args.notebookId) {
    throw new CalculationError("not_found", "Quelle gehoert nicht zu diesem Notizbuch.");
  }

  const rows = await readVersionSheet(store, versionRow.id);
  if (!rows || rows.length === 0) {
    throw new CalculationError("not_a_sheet", "Diese Version enthaelt keine Tabelle (keine CSV-Zeilen).");
  }

  // a calculable sheet needs a header row plus at least one data row; a
  // single-row file names no columns and computes nothing
  if (rows.length < 2) {
    throw new CalculationError("no_header", "Die Tabelle hat keine Kopfzeile.");
  }
  const header = rows[0];

  const colIdx = resolveColumn(header, args.column);
  const colLabel = String(header[colIdx] ?? args.column).trim();

  let dataRows = rows.slice(1);
  if (args.filter) {
    const filterIdx = resolveColumn(header, args.filter.column);
    const target = args.filter.equals.trim();
    dataRows = dataRows.filter((r) => (r[filterIdx] ?? "").trim() === target);
  }

  const argsJson = JSON.stringify({ op: args.op, column: args.column, filter: args.filter ?? null });
  const now = Date.now();
  let result: string;

  if (args.op === "count") {
    // documented distinction: empty cells are absence - count skips them
    const n = dataRows.filter((r) => (r[colIdx] ?? "").trim() !== "").length;
    result = String(n);
  } else {
    const values: number[] = [];
    dataRows.forEach((row, i) => {
      const cell = (row[colIdx] ?? "").trim();
      const sheetRow = i + 2; // header is sheet row 1, first data row is 2
      if (cell === "") {
        throw new CalculationError(
          "ambiguous_cell",
          `Zeile ${sheetRow}, Spalte "${colLabel}": die Zelle ist leer - der Wert ist mehrdeutig und blockiert die Berechnung.`
        );
      }
      try {
        values.push(toNumber(cell));
      } catch {
        throw new CalculationError(
          "not_a_number",
          `Zeile ${sheetRow}, Spalte "${colLabel}": "${cell}" ist keine Zahl.`
        );
      }
    });
    if (values.length === 0) {
      throw new CalculationError("no_data", "Keine passenden Zeilen fuer die Berechnung gefunden.");
    }
    const sum = values.reduce((a, b) => a + b, 0);
    if (args.op === "sum") result = String(sum);
    else if (args.op === "avg") result = String(sum / values.length);
    else if (args.op === "min") result = String(Math.min(...values));
    else result = String(Math.max(...values));
  }

  const id = randomUUID();
  db.insert(calculations)
    .values({
      id,
      ownerId: args.ownerId,
      notebookId: args.notebookId,
      sourceVersionId: versionRow.id,
      operation: args.op,
      argsJson,
      result,
      unit: null, // v1: units in headers are a later refinement
      status: "ok",
      createdAt: now,
    })
    .run();

  return {
    id,
    sourceVersionId: versionRow.id,
    operation: args.op,
    argsJson,
    result,
    unit: null,
    status: "ok",
    error: null,
    createdAt: now,
  };
}

/** The append-only audit list for a notebook (oldest first). */
export function listCalculations(db: LocalDb, notebookId: string): CalculationDoc[] {
  const rows = db
    .select()
    .from(calculations)
    .where(eq(calculations.notebookId, notebookId))
    .orderBy(asc(calculations.createdAt))
    .all();
  return rows.map((r) => ({
    id: r.id,
    sourceVersionId: r.sourceVersionId,
    operation: r.operation,
    argsJson: r.argsJson,
    result: r.result,
    unit: r.unit,
    status: r.status,
    error: r.error,
    createdAt: r.createdAt,
  }));
}
