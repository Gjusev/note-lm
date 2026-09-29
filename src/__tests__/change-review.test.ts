// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { closeLocalDb } from "@/db/local";
import { getLocalContext } from "@/lib/storage/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource } from "@/lib/services/sources";
import { recordVersion } from "@/lib/services/source-versions";
import { createClaim, listClaims, resolveReview } from "@/lib/services/claims";
import { listPendingReviews } from "@/lib/services/change-review";
import { claims as claimsTable, reviewProposals as proposalsTable, learningMaterials } from "@/db/local/schema";

let dir: string;
let notebookId: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-change-review-"));
  process.env.NOTELM_DATA_DIR = dir;
  const ctx = getLocalContext();
  notebookId = await createNotebook(ctx.db, { ownerId: "local", title: "Revisionen" });
});

afterEach(async () => {
  const { getLocalContext } = await import("@/lib/storage/local");
  const { closeLocalDb } = await import("@/db/local");
  closeLocalDb(getLocalContext().db); // releases WAL locks on Windows
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Source with version 1 + a claim anchored to a quote on its first page. */
async function seedStaleClaim(quote: string) {
  const ctx = getLocalContext();
  const sourceId = await createSource(ctx.db, {
    ownerId: "local",
    notebookId,
    fileName: "quelle.txt",
    fileType: "text/plain",
    fileSize: 100,
  });
  const v1 = await recordVersion(ctx.db, ctx.store, {
    sourceId,
    pageTexts: [`Erste Seite: ${quote}`, "Zweite Seite mit Fülltext"],
  });
  const claim = await createClaim(ctx.db, {
    notebookId,
    ownerId: "local",
    text: `Die Quelle sagt: ${quote}`,
    origin: "user",
    anchors: [{ sourceId, quote }],
  });
  const anchor = listClaims(ctx.db, notebookId).find((c) => c._id === claim.id)!.anchors[0];
  return { sourceId, v1, claimId: claim.id, anchorId: anchor.id };
}

describe("change review (open-source-innovation-strategy 5B)", () => {
  it("identical re-import creates no proposals", async () => {
    const ctx = getLocalContext();
    const sourceId = await createSource(ctx.db, {
      ownerId: "local", notebookId, fileName: "gleich.txt", fileType: "text/plain", fileSize: 100,
    });
    const text = "Ein Text mit dem Kernsatz.";
    const stored = await ctx.store.save(Buffer.from(text), { fileName: "gleich.txt", contentType: "text/plain" });
    await recordVersion(ctx.db, ctx.store, { sourceId, storageId: stored.id, contentType: "text/plain", buffer: Buffer.from(text), pageTexts: [text] });
    await createClaim(ctx.db, {
      notebookId, ownerId: "local", text: "Behauptung zum Kernsatz", origin: "user",
      anchors: [{ sourceId, quote: text }],
    });

    const again = await recordVersion(ctx.db, ctx.store, { sourceId, storageId: stored.id, contentType: "text/plain", buffer: Buffer.from(text), pageTexts: [text] });
    expect(again.unchanged).toBe(true); // dedupe path: no scan, nothing appended
    expect(listPendingReviews(ctx.db, notebookId)).toHaveLength(0);
  });

  it("moved quote proposes quote_moved with from/to versions", async () => {
    const ctx = getLocalContext();
    const { sourceId, v1, claimId } = await seedStaleClaim("Der Kernsatz steht auf dieser Seite.");

    // materials with provenance get flagged, legacy rows (no provenance) stay untouched
    const now = Date.now();
    ctx.db.insert(learningMaterials).values({
      id: "mat-with-provenance", ownerId: "local", notebookId, type: "summary", status: "completed",
      content: "x", provenance: JSON.stringify({ [sourceId]: v1.id }), createdAt: now, updatedAt: now,
    }).run();
    ctx.db.insert(learningMaterials).values({
      id: "mat-legacy", ownerId: "local", notebookId, type: "summary", status: "completed",
      content: "y", provenance: null, createdAt: now, updatedAt: now,
    }).run();

    await recordVersion(ctx.db, ctx.store, {
      sourceId,
      pageTexts: ["Zweite Seite mit Fülltext", "Der Kernsatz steht auf dieser Seite."],
    });

    const pending = listPendingReviews(ctx.db, notebookId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      claimId, sourceId, fromVersion: 1, toVersion: 2, reason: "quote_moved", status: "pending",
    });
    expect(pending[0].detail).toContain("Seite 1");
    expect(pending[0].detail).toContain("Seite 2");
    const mats = ctx.db.select().from(learningMaterials).all();
    expect(mats.find((m) => m.id === "mat-with-provenance")!.needsReview).toBe(1);
    expect(mats.find((m) => m.id === "mat-legacy")!.needsReview).toBe(0);
  });

  it("missing quote proposes quote_missing", async () => {
    const ctx = getLocalContext();
    const { sourceId, claimId } = await seedStaleClaim("Der Kernsatz steht auf dieser Seite.");
    await recordVersion(ctx.db, ctx.store, {
      sourceId,
      pageTexts: ["Komplett neuer Inhalt."],
    });

    const pending = listPendingReviews(ctx.db, notebookId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      claimId, fromVersion: 1, toVersion: 2, reason: "quote_missing", status: "pending",
    });
    // the detail names the claim + the anchor quote snippet
    expect(pending[0].detail).toContain("Die Quelle sagt");
    expect(pending[0].detail).toContain("Kernsatz");
  });

  it("accepting quote_moved re-anchors to the new version and keeps history", async () => {
    const ctx = getLocalContext();
    const { sourceId, v1, claimId } = await seedStaleClaim("Der Kernsatz steht auf dieser Seite.");
    const v2 = await recordVersion(ctx.db, ctx.store, {
      sourceId,
      pageTexts: ["Zweite Seite mit Fülltext", "Der Kernsatz steht auf dieser Seite. Und noch etwas Kontext."],
    });

    const pending = listPendingReviews(ctx.db, notebookId);
    expect(pending).toHaveLength(1);
    const proposalId = pending[0].id;

    await resolveReview(ctx.db, ctx.store, { proposalId, decision: "accepted", note: "Neue Seite geprüft." });

    // the anchor moved to the confirmed new version + page
    const anchor = listClaims(ctx.db, notebookId).find((c) => c._id === claimId)!.anchors[0];
    expect(anchor.sourceVersionId).toBe(v2.id);
    expect(anchor.page).toBe(2);
    expect(anchor.quote).toBe("Der Kernsatz steht auf dieser Seite."); // quote text never rewritten

    // history stays in the proposal row, the claim is marked reviewed
    expect(listPendingReviews(ctx.db, notebookId)).toHaveLength(0);
    const [proposal] = ctx.db.select().from(proposalsTable).all();
    expect(proposal).toMatchObject({
      id: proposalId, status: "accepted", fromVersion: 1, toVersion: 2, note: "Neue Seite geprüft.",
    });
    expect(proposal.resolvedAt).not.toBeNull();
    const [claimRow] = ctx.db.select().from(claimsTable).all();
    expect(claimRow.status).toBe("reviewed");
  });

  it("rejecting keeps the anchor on the old version", async () => {
    const ctx = getLocalContext();
    const { sourceId, v1, claimId } = await seedStaleClaim("Der Kernsatz steht auf der ersten Seite.");
    await recordVersion(ctx.db, ctx.store, {
      sourceId,
      pageTexts: ["Andere erste Seite ohne den Kernsatz.", "Der Kernsatz steht auf der ersten Seite."],
    });

    const pending = listPendingReviews(ctx.db, notebookId);
    expect(pending).toHaveLength(1);
    await resolveReview(ctx.db, ctx.store, { proposalId: pending[0].id, decision: "rejected", note: "So gewollt." });

    const anchor = listClaims(ctx.db, notebookId).find((c) => c._id === claimId)!.anchors[0];
    expect(anchor.sourceVersionId).toBe(v1.id);
    expect(anchor.version).toBe(1); // old bytes stay resolvable through the version row
    const [proposal] = ctx.db.select().from(proposalsTable).all();
    expect(proposal).toMatchObject({ status: "rejected", note: "So gewollt." });
    const [claimRow] = ctx.db.select().from(claimsTable).all();
    expect(claimRow.status).toBe("active");
  });

  it("sidecar-less new version skips scanning without proposals", async () => {
    const ctx = getLocalContext();
    const { sourceId } = await seedStaleClaim("Der Kernsatz steht auf dieser Seite.");
    const byteless = await recordVersion(ctx.db, ctx.store, { sourceId }); // original never persisted
    expect(byteless.pageCount).toBeNull();
    expect(listPendingReviews(ctx.db, notebookId)).toHaveLength(0);
  });
});
