/**
 * Evidence matrix (docs/proposals/evidence-matrix.md, with the four contract
 * corrections): a differential view over recorded links. Rows are the
 * notebook's claims, columns the user's selected sources; each cell answers
 * ONE question - what is the recorded relationship between this statement
 * and this source? Every value is derived from real rows (anchors,
 * proposals), never inferred from content. The matrix reads; it never
 * mutates.
 *
 * Corrections this builder implements (vs. the proposal doc's ambiguities):
 * 1. an explicitly selected source ALWAYS renders as a column - with zero
 *    relations its cells are honestly `not_reviewed`, never dropped;
 * 2. resolved proposals keep their history (decision + note + resolvedAt)
 *    but NEVER keep a pending-review alert alive;
 * 3. one cell can hold evidence AND a pending review simultaneously - the
 *    status says `pending_review` while the evidence list stays filled (the
 *    UI shows both signals);
 * 4. opening is version-pinned by the CALLER: cells carry anchorId +
 *    sourceVersionId / fromVersion + toVersion so the UI opens exactly the
 *    anchored (from) version and offers the to-version as an explicit
 *    second action - v1 is never silently swapped for v2.
 *
 * `not_found_in_search` is part of MatrixCellStatus but unreachable by
 * construction: emitting it requires a performed-search provenance store,
 * and none exists yet. Unreachable-typed, not silently faked.
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import {
  sources,
  sourceVersions,
  type AnchorRelation,
  type ClaimStatus,
  type TimeRangeLocator,
} from "@/db/local/schema";
import { listClaims } from "./claims";
import { listPendingReviews } from "./change-review";

export type MatrixCellStatus =
  | "evidence"
  | "pending_review"
  | "not_reviewed"
  | "not_found_in_search";

/** One recorded anchor of the cell's claim × source pair, at ITS immutable
 *  version (correction 4: the caller opens sourceVersionId, never latest). */
export interface MatrixAnchor {
  anchorId: string;
  relation: AnchorRelation; // "supports" | "questions" - never collapsed
  sourceVersionId: string;
  version: number;
  page: number | null; // only when truly known, else null
  locator: TimeRangeLocator | null;
  quote: string;
}

/** One review proposal of the pair. Pending rows are the alert; decided rows
 *  are history only (correction 2) - `status` IS the decision. */
export interface MatrixProposal {
  proposalId: string;
  reason: "quote_moved" | "quote_missing";
  fromVersion: number;
  toVersion: number;
  status: "pending" | "accepted" | "rejected";
  detail: string | null;
  note: string | null;
  resolvedAt: number | null;
}

export interface MatrixCell {
  claimId: string;
  sourceId: string;
  status: MatrixCellStatus;
  /** Anchors of this claim pointing at ANY version of this source. */
  evidence: MatrixAnchor[];
  /** Pending proposals = the cell's alert (correction 3: may coexist with
   *  evidence - status is then pending_review with evidence non-empty). */
  pendingProposals: MatrixProposal[];
  /** Decided proposals = history, never an alert (correction 2). */
  resolvedProposals: MatrixProposal[];
}

export interface MatrixView {
  notebookId: string;
  claims: { id: string; text: string; status: ClaimStatus }[];
  sources: { id: string; fileName: string; latestVersion: number | null }[];
  /** Flat (JSON-safe) cell list; index with cellKey - the engine protocol
   *  serializes NDJSON, so a real Map cannot cross the wire. */
  cells: MatrixCell[];
}

export function cellKey(claimId: string, sourceId: string): string {
  return `${claimId}::${sourceId}`;
}

function statusOf(cell: Omit<MatrixCell, "status">): MatrixCellStatus {
  if (cell.pendingProposals.length > 0) return "pending_review";
  if (cell.evidence.length > 0) return "evidence";
  // not_found_in_search would slot in here, guarded by a performed-search
  // provenance store; none exists, so the branch is unreachable in v1.
  return "not_reviewed";
}

/** Derivation is a pure function over real links, notebook-scoped like
 *  claims.list / review.list: anchors and proposals join by sourceId only
 *  inside the notebook's sources - nothing from another notebook leaks,
 *  even if a row was written pointing across. */
export function buildMatrixView(
  db: LocalDb,
  args: { notebookId: string; claimIds?: string[]; sourceIds?: string[] }
): MatrixView {
  const claimFilter = args.claimIds ? new Set(args.claimIds) : null;

  const claimRows = listClaims(db, args.notebookId)
    .filter((c) => !claimFilter || claimFilter.has(c._id))
    .map((c) => ({ id: c._id, text: c.text, status: c.status, anchors: c.anchors }));

  // The notebook's own sources: the only legal columns (scope validation -
  // a sourceId from another notebook is dropped, not resolved).
  const notebookSources = db
    .select({ id: sources.id, fileName: sources.fileName })
    .from(sources)
    .where(eq(sources.notebookId, args.notebookId))
    .all();
  const notebookSourceIds = new Set(notebookSources.map((s) => s.id));

  // version row -> source, restricted to this notebook's sources: an anchor
  // whose version belongs elsewhere finds no entry and is skipped.
  const versionToSource = new Map(
    db
      .select({ id: sourceVersions.id, sourceId: sourceVersions.sourceId })
      .from(sourceVersions)
      .innerJoin(sources, eq(sources.id, sourceVersions.sourceId))
      .where(eq(sources.notebookId, args.notebookId))
      .all()
      .map((v) => [v.id, v.sourceId] as const)
  );

  const evidenceByPair = new Map<string, MatrixAnchor[]>();
  for (const claim of claimRows) {
    for (const a of claim.anchors) {
      const sourceId = versionToSource.get(a.sourceVersionId);
      if (!sourceId) continue; // cross-notebook anchor: never leaks
      const key = cellKey(claim.id, sourceId);
      const list = evidenceByPair.get(key) ?? [];
      list.push({
        anchorId: a.id,
        relation: a.relation,
        sourceVersionId: a.sourceVersionId,
        version: a.version,
        page: a.page,
        locator: a.locator,
        quote: a.quote,
      });
      evidenceByPair.set(key, list);
    }
  }

  const pendingByPair = new Map<string, MatrixProposal[]>();
  const resolvedByPair = new Map<string, MatrixProposal[]>();
  for (const p of listPendingReviews(db, args.notebookId, "all")) {
    if (!notebookSourceIds.has(p.sourceId)) continue; // scope: never leaks
    if (claimFilter && !claimFilter.has(p.claimId)) continue;
    const view: MatrixProposal = {
      proposalId: p.id,
      reason: p.reason as MatrixProposal["reason"],
      fromVersion: p.fromVersion,
      toVersion: p.toVersion,
      status: p.status as MatrixProposal["status"],
      detail: p.detail,
      note: p.note,
      resolvedAt: p.resolvedAt,
    };
    const key = cellKey(p.claimId, p.sourceId);
    const bucket = p.status === "pending" ? pendingByPair : resolvedByPair;
    const list = bucket.get(key) ?? [];
    list.push(view);
    bucket.set(key, list);
  }

  // Columns: the user's explicit selection always renders (correction 1);
  // without one, only sources with any recorded anchor/proposal for the
  // selected claims become columns (the matrix never adds columns silently).
  const related = new Set<string>();
  for (const key of [...evidenceByPair.keys(), ...pendingByPair.keys(), ...resolvedByPair.keys()]) {
    related.add(key.split("::").pop()!);
  }
  const columns = (
    args.sourceIds
      ? notebookSources.filter((s) => args.sourceIds!.includes(s.id))
      : notebookSources.filter((s) => related.has(s.id))
  ).sort((a, b) => a.fileName.localeCompare(b.fileName, "de"));

  const latestVersion = new Map<string, number>();
  if (columns.length > 0) {
    const rows = db
      .select({ sourceId: sourceVersions.sourceId, max: sql<number>`max(${sourceVersions.version})` })
      .from(sourceVersions)
      .where(inArray(sourceVersions.sourceId, columns.map((c) => c.id)))
      .groupBy(sourceVersions.sourceId)
      .all();
    for (const row of rows) latestVersion.set(row.sourceId, Number(row.max));
  }

  const cells: MatrixCell[] = [];
  for (const claim of claimRows) {
    for (const col of columns) {
      const key = cellKey(claim.id, col.id);
      const rest = {
        claimId: claim.id,
        sourceId: col.id,
        evidence: evidenceByPair.get(key) ?? [],
        pendingProposals: pendingByPair.get(key) ?? [],
        resolvedProposals: resolvedByPair.get(key) ?? [],
      };
      cells.push({ ...rest, status: statusOf(rest) });
    }
  }

  return {
    notebookId: args.notebookId,
    claims: claimRows.map(({ id, text, status }) => ({ id, text, status })),
    sources: columns.map((c) => ({
      id: c.id,
      fileName: c.fileName,
      latestVersion: latestVersion.get(c.id) ?? null,
    })),
    cells,
  };
}
