/**
 * Change review (open-source-innovation-strategy 5B): a newly appended
 * source version is a deterministic trigger, not a verdict. For every claim
 * anchored to ANY version of that source, the anchor's quote is searched in
 * the new version's pages (normalized: whitespace collapsed, case-insensi-
 * tive): same page -> quiet, different page -> quote_moved, gone ->
 * quote_missing. Findings become pending review proposals; they never claim
 * a conclusion is false. Sources without a sidecar for the new version are
 * skipped entirely - no misleading proposals.
 *
 * Materials of the notebook whose provenance references the source get
 * needs_review=1; legacy rows without provenance are skipped, honest.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like, lt, or } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import {
  claims,
  evidenceAnchors,
  evidenceLinks,
  learningMaterials,
  reviewProposals,
  reviewScans,
  sources,
  sourceVersions,
} from "@/db/local/schema";
import { readVersionPages } from "./source-versions";
import type { LocalStore } from "@/lib/storage/local";

/** Normalized quote search over a version's pages: whitespace collapsed,
 * case-insensitive. Returns the 1-based page number or null. */
export function findQuotePage(
  pages: { page: number; text: string }[],
  quote: string
): number | null {
  const needle = quote.replace(/\s+/g, " ").trim().toLowerCase();
  if (!needle) return null;
  for (const candidate of pages) {
    if (candidate.text.replace(/\s+/g, " ").toLowerCase().includes(needle)) {
      return candidate.page;
    }
  }
  return null;
}

export interface StalenessScanArgs {
  sourceId: string;
  fromVersion: number;
  toVersionId: string;
}

function quoteSnippet(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

export async function scanForStaleness(db: LocalDb, store: LocalStore, args: StalenessScanArgs): Promise<void> {
  const toVersion = db
    .select()
    .from(sourceVersions)
    .where(eq(sourceVersions.id, args.toVersionId))
    .get();
  if (!toVersion || toVersion.sourceId !== args.sourceId) return;

  // No sidecar for the new version: nothing can be compared honestly -
  // skip the whole source, no misleading proposals, nothing flagged.
  const newPages = await readVersionPages(store, toVersion.id);
  if (!newPages) return;

  // Every claim anchored to ANY version of this source depends on it (the
  // dependency chain source_version -> evidence_anchor -> claim must exist
  // before any change interpretation).
  const dependents = db
    .select({
      claimId: evidenceLinks.claimId,
      anchorId: evidenceAnchors.id,
      anchorPage: evidenceAnchors.page,
      anchorVersionId: evidenceAnchors.sourceVersionId,
      quote: evidenceAnchors.quote,
    })
    .from(evidenceAnchors)
    .innerJoin(evidenceLinks, eq(evidenceLinks.anchorId, evidenceAnchors.id))
    .innerJoin(sourceVersions, eq(sourceVersions.id, evidenceAnchors.sourceVersionId))
    .where(eq(sourceVersions.sourceId, args.sourceId))
    .all();

  // Materials whose provenance references the source get flagged: the data
  // they were built from changed. Legacy rows (provenance NULL) are skipped
  // - nothing is claimed about materials that never recorded provenance.
  const source = db
    .select({ notebookId: sources.notebookId })
    .from(sources)
    .where(eq(sources.id, args.sourceId))
    .get();
  if (source) {
    await db
      .update(learningMaterials)
      .set({ needsReview: 1 })
      .where(
        and(
          eq(learningMaterials.notebookId, source.notebookId),
          like(learningMaterials.provenance, `%"${args.sourceId}"%`)
        )
      )
      .run();
  }

  for (const dep of dependents) {
    // one proposal per anchor and target version, DECIDED or pending: an
    // accepted/rejected proposal is terminal - a rescan (import, or the
    // ledger reconcile) must never resurrect or duplicate it
    const already = db
      .select({ id: reviewProposals.id })
      .from(reviewProposals)
      .where(
        and(
          eq(reviewProposals.anchorId, dep.anchorId),
          eq(reviewProposals.toVersion, toVersion.version)
        )
      )
      .get();
    if (already) continue;

    const anchorVersion = db
      .select()
      .from(sourceVersions)
      .where(eq(sourceVersions.id, dep.anchorVersionId))
      .get();
    if (!anchorVersion) continue;

    // Locator rule: the anchor's own page when truly known, otherwise the
    // page the quote factually sits on in the anchored version's sidecar.
    // Without either there is no honest "same page" reference - skip.
    let refPage = dep.anchorPage ?? null;
    if (refPage === null) {
      const oldPages = await readVersionPages(store, anchorVersion.id);
      const derived = oldPages ? findQuotePage(oldPages, dep.quote) : null;
      if (derived === null) continue; // no honest locator: no proposal
      refPage = derived;
    }

    const newPage = findQuotePage(newPages, dep.quote);
    let reason: "quote_moved" | "quote_missing";
    if (newPage === null) {
      reason = "quote_missing";
    } else if (newPage === refPage) {
      continue; // same place: nothing stale to report
    } else {
      reason = "quote_moved";
    }

    const claimRow = db
      .select({ text: claims.text })
      .from(claims)
      .where(eq(claims.id, dep.claimId))
      .get();

    const snippet = quoteSnippet(dep.quote);
    const claimSnippet = quoteSnippet(claimRow?.text ?? "");
    const detail =
      reason === "quote_missing"
        ? `Zitat "${snippet}" fehlt in Version ${toVersion.version} (Anker der Behauptung "${claimSnippet}").`
        : `Zitat "${snippet}" ist von Seite ${refPage} auf Seite ${newPage} gerutscht (Behauptung "${claimSnippet}").`;

    await db.insert(reviewProposals).values({
      id: randomUUID(),
      claimId: dep.claimId,
      sourceId: args.sourceId,
      fromVersion: args.fromVersion,
      toVersion: toVersion.version,
      reason,
      detail,
      anchorId: dep.anchorId,
      status: "pending",
      createdAt: Date.now(),
    }).run();
  }
}

export interface ReviewProposalView {
  id: string;
  claimId: string;
  claimText: string;
  sourceId: string;
  fromVersion: number;
  toVersion: number;
  reason: string;
  detail: string | null;
  status: string;
  createdAt: number;
  /** History of a decided proposal; null while pending. `status` (accepted |
   * rejected) IS the decision - there is no separate decision field. */
  resolvedAt: number | null;
  note: string | null;
}

/** Which rows `listPendingReviews` serves: pending only (the default,
 * unchanged UI behavior), the decided ones, or everything. */
export type ReviewListStatus = "pending" | "resolved" | "all";

export function listPendingReviews(
  db: LocalDb,
  notebookId: string,
  status: ReviewListStatus = "pending"
): ReviewProposalView[] {
  const statusCond =
    status === "pending"
      ? eq(reviewProposals.status, "pending")
      : status === "resolved"
        ? inArray(reviewProposals.status, ["accepted", "rejected"])
        : undefined;
  return db
    .select({
      id: reviewProposals.id,
      claimId: reviewProposals.claimId,
      claimText: claims.text,
      sourceId: reviewProposals.sourceId,
      fromVersion: reviewProposals.fromVersion,
      toVersion: reviewProposals.toVersion,
      reason: reviewProposals.reason,
      detail: reviewProposals.detail,
      status: reviewProposals.status,
      createdAt: reviewProposals.createdAt,
      resolvedAt: reviewProposals.resolvedAt,
      note: reviewProposals.note,
    })
    .from(reviewProposals)
    .innerJoin(claims, eq(claims.id, reviewProposals.claimId))
    .where(
      statusCond ? and(eq(claims.notebookId, notebookId), statusCond) : eq(claims.notebookId, notebookId)
    )
    // oldest first: the review history is read in the order it happened
    .orderBy(asc(reviewProposals.createdAt))
    .all();
}

/** How long a ledger row must be unresolved before reconcile considers it
 * stuck: a scan running RIGHT NOW may legitimately still be pending. */
const RECONCILE_GRACE_MS = 60_000;

/** Recovery (priority-1 fix): re-run change-review scans a crashed engine
 * left stuck 'pending' or 'failed' in the review_scans ledger. The scan is
 * idempotent per (anchor, target version) - decided proposals are never
 * resurrected, missing ones are filled in - so a partially applied scan ends
 * up complete after reconcile, never double-reported. */
export async function reconcileReviewScans(
  db: LocalDb,
  store: LocalStore
): Promise<{ rescanned: number }> {
  const stuck = db
    .select()
    .from(reviewScans)
    .where(
      and(
        or(eq(reviewScans.status, "pending"), eq(reviewScans.status, "failed")),
        lt(reviewScans.createdAt, Date.now() - RECONCILE_GRACE_MS)
      )
    )
    .all();
  let rescanned = 0;
  for (const row of stuck) {
    try {
      await scanForStaleness(db, store, {
        sourceId: row.sourceId,
        fromVersion: row.fromVersion,
        toVersionId: row.toVersionId,
      });
      db.update(reviewScans)
        .set({ status: "ok", completedAt: Date.now() })
        .where(eq(reviewScans.id, row.id))
        .run();
      rescanned++;
    } catch (err) {
      db.update(reviewScans)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          completedAt: Date.now(),
        })
        .where(eq(reviewScans.id, row.id))
        .run();
    }
  }
  return { rescanned };
}
