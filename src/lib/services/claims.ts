/**
 * Claims with evidence anchors (open-source-innovation-strategy 5A/5B): a
 * claim is a human-saved or chat-saved statement; its anchors point to
 * IMMUTABLE source_versions rows plus a locator. The page is stored only
 * when truly known (an explicit citation page or a saver-given one) - never
 * invented. Re-imports append versions; existing anchors keep pointing at
 * the old version bytes, so they always stay resolvable.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { LocalDb } from "@/db/local";
import {
  claims,
  evidenceAnchors,
  evidenceLinks,
  messages,
  reviewProposals,
  sources,
  sourceVersions,
  type AnchorRelation,
  type ClaimOrigin,
  type ClaimStatus,
  type MessageCitation,
} from "@/db/local/schema";
import { getLatestVersion, readVersionPages } from "./source-versions";
import { findQuotePage } from "./change-review";
import type { LocalStore } from "@/lib/storage/local";

export interface ClaimAnchorInput {
  sourceId: string;
  page?: number | null;
  quote?: string;
  relation?: AnchorRelation;
}

export interface UnresolvedAnchor {
  sourceId: string;
  reason: string;
}

export interface ClaimDoc {
  id: string;
  anchorCount: number;
  unresolved: UnresolvedAnchor[];
}

/** Persist one anchor bound to the source's LATEST version. A citation page
 * is kept only when the saver/citation truly carries one - never invented.
 * A source without any recorded version produces an honest "unresolved"
 * entry instead of a fabricated anchor. */
async function insertAnchoredToLatest(
  db: LocalDb,
  ownerId: string,
  anchor: ClaimAnchorInput
): Promise<{ id: string } | { unresolved: UnresolvedAnchor }> {
  const latest = getLatestVersion(db, anchor.sourceId);
  if (!latest) {
    return { unresolved: { sourceId: anchor.sourceId, reason: "no version recorded" } };
  }
  const id = randomUUID();
  await db
    .insert(evidenceAnchors)
    .values({
      id,
      ownerId,
      sourceVersionId: latest.id,
      page: anchor.page ?? null,
      quote: anchor.quote ?? "",
      createdAt: Date.now(),
    })
    .run();
  return { id };
}

export async function createClaim(
  db: LocalDb,
  args: {
    notebookId: string;
    ownerId: string;
    text: string;
    origin: ClaimOrigin;
    originMessageId?: string;
    anchors?: ClaimAnchorInput[];
  }
): Promise<ClaimDoc> {
  const claimId = randomUUID();
  const now = Date.now();
  await db
    .insert(claims)
    .values({
      id: claimId,
      ownerId: args.ownerId,
      notebookId: args.notebookId,
      text: args.text,
      origin: args.origin,
      originMessageId: args.originMessageId ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  let anchorCount = 0;
  const unresolved: UnresolvedAnchor[] = [];
  for (const anchor of args.anchors ?? []) {
    const result = await insertAnchoredToLatest(db, args.ownerId, anchor);
    if ("unresolved" in result) {
      unresolved.push(result.unresolved);
      continue;
    }
    await db
      .insert(evidenceLinks)
      .values({
        claimId,
        anchorId: result.id,
        relation: anchor.relation ?? "supports",
      })
      .run();
    anchorCount++;
  }
  return { id: claimId, anchorCount, unresolved };
}

/** Save a claim from a persisted chat message: its stored citations (sourceId
 * + chunkIndex + chunk text) map to anchors; citations carry no page, so the
 * anchor page is null - never invented. Sources without any version are
 * reported as unresolved, honestly. */
export async function saveClaimFromMessage(
  db: LocalDb,
  args: { notebookId: string; messageId: string; text: string }
): Promise<ClaimDoc> {
  const message = db.select().from(messages).where(eq(messages.id, args.messageId)).get();
  if (!message || message.notebookId !== args.notebookId) {
    throw new Error("Nachricht nicht gefunden.");
  }
  const anchors: ClaimAnchorInput[] = (message.citations ?? []).map((citation: MessageCitation) => ({
    sourceId: citation.sourceId,
    quote: citation.text,
  }));
  return createClaim(db, {
    notebookId: args.notebookId,
    ownerId: message.ownerId,
    text: args.text,
    origin: "chat",
    originMessageId: args.messageId,
    anchors,
  });
}

/** A claim row joined with its anchors (doc fileName, version number, page,
 * quote) and its pending review proposals. */
export interface ClaimAnchorView {
  id: string;
  relation: AnchorRelation;
  fileName: string | null;
  version: number;
  page: number | null;
  quote: string;
  sourceVersionId: string;
}

export interface ClaimView {
  _id: string;
  text: string;
  origin: ClaimOrigin;
  originMessageId: string | null;
  status: ClaimStatus;
  createdAt: number;
  anchors: ClaimAnchorView[];
  pendingReviews: number;
  reviewReasons: string[];
}

export function listClaims(db: LocalDb, notebookId: string): ClaimView[] {
  const rows = db
    .select()
    .from(claims)
    .where(eq(claims.notebookId, notebookId))
    .orderBy(desc(claims.createdAt))
    .all();

  const pending = db
    .select({ claimId: reviewProposals.claimId, reason: reviewProposals.reason })
    .from(reviewProposals)
    .innerJoin(claims, eq(claims.id, reviewProposals.claimId))
    .where(and(eq(claims.notebookId, notebookId), eq(reviewProposals.status, "pending")))
    .all();

  return rows.map((row) => {
    const anchors = db
      .select({
        id: evidenceAnchors.id,
        relation: evidenceLinks.relation,
        fileName: sources.fileName,
        version: sourceVersions.version,
        page: evidenceAnchors.page,
        quote: evidenceAnchors.quote,
        sourceVersionId: evidenceAnchors.sourceVersionId,
      })
      .from(evidenceLinks)
      .innerJoin(evidenceAnchors, eq(evidenceAnchors.id, evidenceLinks.anchorId))
      .innerJoin(sourceVersions, eq(sourceVersions.id, evidenceAnchors.sourceVersionId))
      .innerJoin(sources, eq(sources.id, sourceVersions.sourceId))
      .where(eq(evidenceLinks.claimId, row.id))
      // rowid = link insertion order: deterministic anchor order even when
      // anchors share a created_at millisecond
      .orderBy(sql`evidence_links.rowid`)
      .all();

    const proposals = pending.filter((p) => p.claimId === row.id);
    return {
      _id: row.id,
      text: row.text,
      origin: row.origin,
      originMessageId: row.originMessageId,
      status: row.status,
      createdAt: row.createdAt,
      anchors,
      pendingReviews: proposals.length,
      reviewReasons: proposals.map((p) => p.reason),
    };
  });
}

/** Decide a review proposal. Accepting a quote_moved finding re-anchors the
 * anchor to the confirmed new version + page (the proposal row keeps
 * from/to versions, so the history of the move survives); accepting
 * quote_missing marks the claim reviewed with the human note recorded in the
 * proposal. Rejecting changes nothing - the anchor stays on the old version
 * bytes, still resolvable. Human notes are recorded verbatim, never
 * overwritten. */
export async function resolveReview(
  db: LocalDb,
  store: LocalStore,
  args: { proposalId: string; decision: "accepted" | "rejected"; note?: string }
): Promise<void> {
  const proposal = db
    .select()
    .from(reviewProposals)
    .where(eq(reviewProposals.id, args.proposalId))
    .get();
  if (!proposal) throw new Error("Revisionsvorschlag nicht gefunden.");
  if (proposal.status !== "pending") throw new Error("Revisionsvorschlag wurde bereits entschieden.");

  const now = Date.now();
  await db
    .update(reviewProposals)
    .set({
      status: args.decision,
      resolvedAt: now,
      ...(args.note !== undefined && { note: args.note }),
    })
    .where(eq(reviewProposals.id, args.proposalId))
    .run();

  if (args.decision === "rejected") {
    // nothing else changes: the anchor stays on the old version bytes
    return;
  }

  if (proposal.reason === "quote_moved" && proposal.anchorId) {
    // re-anchor to the confirmed to-version: the proposal row keeps
    // from/to versions, so the history of the move is never lost
    const versionRow = db
      .select()
      .from(sourceVersions)
      .where(
        and(
          eq(sourceVersions.sourceId, proposal.sourceId),
          eq(sourceVersions.version, proposal.toVersion)
        )
      )
      .get();
    const anchor = db
      .select()
      .from(evidenceAnchors)
      .where(eq(evidenceAnchors.id, proposal.anchorId))
      .get();
    if (versionRow && anchor) {
      const pages = await readVersionPages(store, versionRow.id);
      const page = pages ? findQuotePage(pages, anchor.quote) : null;
      if (page !== null) {
        await db
          .update(evidenceAnchors)
          .set({ sourceVersionId: versionRow.id, page })
          .where(eq(evidenceAnchors.id, anchor.id))
          .run();
      }
      // quote not findable in the confirmed version: the anchor stays on the
      // old bytes - resolvable, nothing invented
    }
  }

  // an accepted review means a human looked at it: mark the claim reviewed
  await db
    .update(claims)
    .set({ status: "reviewed", updatedAt: now })
    .where(eq(claims.id, proposal.claimId))
    .run();
}
