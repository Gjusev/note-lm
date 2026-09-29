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
import { createClaim, resolveReview } from "@/lib/services/claims";
import { listPendingReviews } from "@/lib/services/change-review";
import { buildMatrixView, cellKey } from "@/lib/services/evidence-matrix";

let dir: string;
let notebookId: string;
let otherNotebookId: string;

const QUOTE = "Die Dosierung ist im untersuchten Bereich wirksam.";

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-matrix-"));
  process.env.NOTELM_DATA_DIR = dir;
  const ctx = getLocalContext();
  notebookId = await createNotebook(ctx.db, { ownerId: "local", title: "Matrix" });
  otherNotebookId = await createNotebook(ctx.db, { ownerId: "local", title: "Fremd" });
});

afterEach(async () => {
  const { getLocalContext } = await import("@/lib/storage/local");
  const { closeLocalDb } = await import("@/db/local");
  closeLocalDb(getLocalContext().db); // releases WAL locks on Windows
  fs.rmSync(dir, { recursive: true, force: true });
});

async function makeSource(nb: string, fileName: string): Promise<string> {
  const { db } = getLocalContext();
  return createSource(db, { ownerId: "local", notebookId: nb, fileName, fileType: "text/plain", fileSize: 100 });
}

/** The core scenario: one claim anchored to v1 of a source, then a re-import
 *  appends v2 with the quote moved - the deterministic staleness scan raises
 *  one pending quote_moved proposal for the pair. */
async function seedAnchoredClaim(text = QUOTE) {
  const { db, store } = getLocalContext();
  const sourceId = await makeSource(notebookId, "kaffee-studie.txt");
  const v1 = await recordVersion(db, store, {
    sourceId,
    pageTexts: [QUOTE + " Seite eins.", "unveränderter zweiter Abschnitt."],
  });
  const claim = await createClaim(db, {
    notebookId,
    ownerId: "local",
    text,
    origin: "user",
    anchors: [{ sourceId, versionId: v1.id, page: 1, quote: QUOTE }],
  });
  return { sourceId, v1, claimId: claim.id };
}

describe("evidence matrix (docs/proposals/evidence-matrix.md + 4 corrections)", () => {
  it("renders an explicitly selected source as a column even with zero relations - its cells are not_reviewed (correction 1)", async () => {
    const { db } = getLocalContext();
    const { sourceId } = await seedAnchoredClaim();
    const unrelated = await makeSource(notebookId, "bericht-url.txt");

    const view = buildMatrixView(db, { notebookId, sourceIds: [unrelated] });
    expect(view.sources.map((s) => s.id)).toEqual([unrelated]);
    expect(view.claims).toHaveLength(1);
    // the selected column exists and its one cell is the honest default
    const cell = view.cells[0];
    expect(cell).toMatchObject({
      claimId: view.claims[0].id,
      sourceId: unrelated,
      status: "not_reviewed",
      evidence: [],
      pendingProposals: [],
      resolvedProposals: [],
    });
    expect(cell.status).not.toBe("not_found_in_search");

    // default (no sourceIds): only sources with recorded relations are
    // columns - the matrix never silently adds columns
    const def = buildMatrixView(db, { notebookId });
    expect(def.sources.map((s) => s.id)).toEqual([sourceId]);
  });

  it("an evidence cell carries its anchors joined by sourceId, at their own immutable version", async () => {
    const { db } = getLocalContext();
    const { sourceId, v1, claimId } = await seedAnchoredClaim();

    const view = buildMatrixView(db, { notebookId });
    const cell = view.cells.find((c) => c.claimId === claimId && c.sourceId === sourceId)!;
    expect(cell.status).toBe("evidence");
    expect(cell.evidence).toHaveLength(1);
    expect(cell.evidence[0]).toMatchObject({
      sourceVersionId: v1.id,
      version: 1,
      page: 1,
      relation: "supports",
      quote: QUOTE,
    });
    expect(cell.evidence[0].anchorId).toBeTruthy();
    // the column reports the source's latest recorded version
    expect(view.sources[0]).toMatchObject({ id: sourceId, latestVersion: 1 });
  });

  it("a re-imported source yields one cell holding evidence AND a pending review (correction 3)", async () => {
    const { db, store } = getLocalContext();
    const { sourceId, claimId } = await seedAnchoredClaim();
    await recordVersion(db, store, {
      sourceId,
      pageTexts: ["neue Einleitung", QUOTE + " jetzt auf Seite zwei.", "dritte Seite"],
    });

    const view = buildMatrixView(db, { notebookId });
    const cell = view.cells.find((c) => c.claimId === claimId && c.sourceId === sourceId)!;
    // simultaneity rule: the status names the pending review while the
    // evidence list stays filled - the UI shows both signals
    expect(cell.status).toBe("pending_review");
    expect(cell.evidence).toHaveLength(1);
    expect(cell.pendingProposals).toHaveLength(1);
    expect(cell.pendingProposals[0]).toMatchObject({ reason: "quote_moved", fromVersion: 1, toVersion: 2 });
    expect(view.sources[0].latestVersion).toBe(2);
  });

  it("resolving keeps the history but never keeps a pending alert alive (correction 2)", async () => {
    const { db, store } = getLocalContext();
    const { sourceId, claimId } = await seedAnchoredClaim();
    await recordVersion(db, store, {
      sourceId,
      pageTexts: ["neue Einleitung", QUOTE + " jetzt auf Seite zwei."],
    });
    const [proposal] = listPendingReviews(db, notebookId, "pending");
    await resolveReview(db, store, { proposalId: proposal.id, decision: "accepted", note: "Neuer Ort bestätigt." });

    const view = buildMatrixView(db, { notebookId });
    const cell = view.cells.find((c) => c.claimId === claimId && c.sourceId === sourceId)!;
    expect(cell.pendingProposals).toEqual([]); // no alert survives the decision
    expect(cell.resolvedProposals).toHaveLength(1);
    expect(cell.resolvedProposals[0]).toMatchObject({
      status: "accepted",
      note: "Neuer Ort bestätigt.",
      resolvedAt: expect.any(Number),
    });
    // acceptance re-anchored the quote: evidence (not an alert) carries the cell
    expect(cell.evidence).toHaveLength(1);
    expect(cell.evidence[0].version).toBe(2);
    expect(cell.status).toBe("evidence");
  });

  it("never leaks another notebook's sources, anchors or proposals (scope rule)", async () => {
    const { db, store } = getLocalContext();
    const { sourceId } = await seedAnchoredClaim();

    // a second notebook with its own anchored claim
    const otherSource = await makeSource(otherNotebookId, "fremde-studie.txt");
    const otherV1 = await recordVersion(db, store, { sourceId: otherSource, pageTexts: ["fremder Satz."] });
    await createClaim(db, {
      notebookId: otherNotebookId,
      ownerId: "local",
      text: "Fremde Aussage.",
      origin: "user",
      anchors: [{ sourceId: otherSource, versionId: otherV1.id, page: 1, quote: "fremder Satz." }],
    });

    // asking for the foreign source explicitly: dropped, not resolved
    const explicit = buildMatrixView(db, { notebookId, sourceIds: [otherSource, sourceId] });
    expect(explicit.sources.map((s) => s.id)).toEqual([sourceId]);

    // a claim of THIS notebook whose anchor points at the foreign source
    // (createClaim does not validate the anchor's notebook): the anchor is
    // skipped - the claim row stays, all its cells stay not_reviewed
    const cross = await createClaim(db, {
      notebookId,
      ownerId: "local",
      text: "Querverweis.",
      origin: "user",
      anchors: [{ sourceId: otherSource, versionId: otherV1.id, page: 1, quote: "fremder Satz." }],
    });
    const view = buildMatrixView(db, { notebookId, claimIds: [cross.id] });
    expect(view.sources).toEqual([]);
    expect(view.cells).toEqual([]);
    const viewAll = buildMatrixView(db, { notebookId });
    expect(viewAll.cells.filter((c) => c.claimId === cross.id).every((c) => c.evidence.length === 0)).toBe(true);
  });

  it("claimIds and sourceIds subsets filter rows and columns", async () => {
    const { db } = getLocalContext();
    const { sourceId, claimId } = await seedAnchoredClaim();
    const second = await createClaim(db, { notebookId, ownerId: "local", text: "Zweite Aussage.", origin: "user" });

    const view = buildMatrixView(db, { notebookId, claimIds: [second.id] });
    expect(view.claims.map((c) => c.id)).toEqual([second.id]);
    // the second claim has no anchors: even the related source is no column
    expect(view.sources).toEqual([]);
    expect(view.cells).toEqual([]);

    const both = buildMatrixView(db, { notebookId, claimIds: [claimId, second.id], sourceIds: [sourceId] });
    expect(both.claims).toHaveLength(2);
    expect(both.cells.map((c) => c.claimId).sort()).toEqual([claimId, second.id].sort());
    expect(both.cells.find((c) => c.claimId === second.id)!.status).toBe("not_reviewed");
  });

  it("never emits not_found_in_search - no performed-search provenance store exists (typed, unreachable)", async () => {
    const { db, store } = getLocalContext();
    const { sourceId, claimId } = await seedAnchoredClaim();
    await recordVersion(db, store, { sourceId, pageTexts: ["neue Einleitung", QUOTE] });
    const unrelated = await makeSource(notebookId, "bericht-url.txt");

    for (const view of [
      buildMatrixView(db, { notebookId }),
      buildMatrixView(db, { notebookId, sourceIds: [sourceId, unrelated] }),
      buildMatrixView(db, { notebookId, claimIds: [claimId] }),
    ]) {
      for (const cell of view.cells) {
        expect(["evidence", "pending_review", "not_reviewed"]).toContain(cell.status);
      }
    }
  });

  it("answers an empty notebook with an empty view", async () => {
    const { db } = getLocalContext();
    const view = buildMatrixView(db, { notebookId });
    expect(view).toMatchObject({ notebookId, claims: [], sources: [], cells: [] });
  });

  it("cellKey is the stable cell index (claim::source)", () => {
    expect(cellKey("c1", "s1")).toBe("c1::s1");
    expect(cellKey("c1", "s1")).not.toBe(cellKey("c1", "s2"));
  });
});
