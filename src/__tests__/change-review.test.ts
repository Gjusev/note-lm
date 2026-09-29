// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeLocalDb } from "@/db/local";
import { getLocalContext } from "@/lib/storage/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource } from "@/lib/services/sources";
import { recordVersion, listVersions, readVersionPages } from "@/lib/services/source-versions";
import { createClaim, listClaims, resolveReview } from "@/lib/services/claims";
import { listPendingReviews, scanForStaleness } from "@/lib/services/change-review";
import { claims as claimsTable, reviewProposals as proposalsTable, learningMaterials, reviewScans as reviewScansTable } from "@/db/local/schema";
import { eq } from "drizzle-orm";

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

/* ------------------------------------------------------------------------- */
/* E1 + E2 fixture tests - eval/corpus/version-pairs-v1                       */
/*                                                                            */
/* Fixtures generated by eval/corpus/version-pairs-v1/generate-version-pairs.mjs */
/* (open-source-innovation-strategy §10 rows 1-2; NOT the PI-2 reserved set).  */
/* The corpus files are generated + validated before these tests run          */
/* (node generate-version-pairs.mjs && node validate-version-pairs.mjs).       */
/* ------------------------------------------------------------------------- */

const VERSION_PAIRS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "eval",
  "corpus",
  "version-pairs-v1"
);

interface PairClaim {
  quote: string;
  v1Page: number;
  section: string;
  v2Expected: number | "moved" | "missing";
  v2Page?: number;
}
interface PairManifest {
  pairId: string;
  category: "material-change" | "moved" | "deleted" | "format-only";
  topic: string;
  v1File: string;
  v2File: string;
  v1Pages: number;
  v2Pages: number;
  claims: PairClaim[];
  expectedProposals: { quote: string; reason: "quote_moved" | "quote_missing" }[];
}
interface CorpusManifest {
  version: number;
  corpus: string;
  roundtripPairs: string[];
  totals: { pairs: number; claims: number; expectedProposals: number };
  pairs: PairManifest[];
}

const corpus: CorpusManifest = JSON.parse(
  fs.readFileSync(path.join(VERSION_PAIRS_DIR, "manifest.json"), "utf8")
);
/** Collected per-pair outcomes for the E2 grading test (same-file module scope). */
const runLog = new Map<string, { expected: number; got: number; reasons: string[] }>();

/** Real services end to end for one corpus pair: source + v1 PDF import + one
 * claim per manifest quote (anchors carry the v1 sidecar page) + v2 PDF import
 * (recordVersion itself triggers scanForStaleness). Returns handles for assertions. */
async function importPair(pair: PairManifest) {
  const ctx = getLocalContext();
  const sourceId = await createSource(ctx.db, {
    ownerId: "local",
    notebookId,
    fileName: `${pair.pairId}.pdf`,
    fileType: "application/pdf",
    fileSize: 1,
  });
  const v1Bytes = fs.readFileSync(path.join(VERSION_PAIRS_DIR, pair.v1File));
  const v1Stored = await ctx.store.save(v1Bytes, { fileName: `${pair.pairId}.pdf`, contentType: "application/pdf" });
  const v1 = await recordVersion(ctx.db, ctx.store, {
    sourceId,
    storageId: v1Stored.id,
    contentType: "application/pdf",
    buffer: v1Bytes,
  });

  const claimIds: string[] = [];
  for (const c of pair.claims) {
    const claim = await createClaim(ctx.db, {
      notebookId,
      ownerId: "local",
      text: `Feststellung zu ${pair.pairId}: ${c.quote}`,
      origin: "user",
      anchors: [{ sourceId, page: c.v1Page, quote: c.quote }],
    });
    claimIds.push(claim.id);
  }

  const v2Bytes = fs.readFileSync(path.join(VERSION_PAIRS_DIR, pair.v2File));
  const v2Stored = await ctx.store.save(v2Bytes, { fileName: `${pair.pairId}-v2.pdf`, contentType: "application/pdf" });
  const v2 = await recordVersion(ctx.db, ctx.store, {
    sourceId,
    storageId: v2Stored.id,
    contentType: "application/pdf",
    buffer: v2Bytes,
  });
  return { ctx, sourceId, v1, v2, v1StoredId: v1Stored.id, claimIds };
}

/** Expected proposal set for a pair, keyed by claimId. */
function expectedByClaim(pair: PairManifest, claimIds: string[]) {
  return new Map(
    pair.claims.map((c, i) => {
      const exp = pair.expectedProposals.find((e) => e.quote === c.quote);
      return [claimIds[i], exp?.reason ?? null] as const;
    })
  );
}

describe("E2 change-review quality (fixture corpus version-pairs-v1)", () => {
  it("manifest shape: 20 pairs, >=4 per category, one roundtrip pair per category", () => {
    expect(corpus.totals.pairs).toBe(20);
    const byCat: Record<string, number> = {};
    for (const p of corpus.pairs) byCat[p.category] = (byCat[p.category] ?? 0) + 1;
    for (const cat of ["material-change", "moved", "deleted", "format-only"]) {
      expect(byCat[cat]).toBeGreaterThanOrEqual(4);
    }
    expect(corpus.roundtripPairs).toHaveLength(4);
    for (const id of corpus.roundtripPairs) {
      expect(corpus.pairs.some((p) => p.pairId === id)).toBe(true);
    }
    expect(corpus.totals.expectedProposals).toBe(15);
  });

  it.each(corpus.pairs)("$pairId [$category]", async (pair) => {
    const { ctx, sourceId, v1, v2, claimIds } = await importPair(pair);

    // deterministic propagation: v2 import lands exactly the expected proposals
    const pending = listPendingReviews(ctx.db, notebookId);
    const expected = expectedByClaim(pair, claimIds);
    const want = [...expected].filter(([, reason]) => reason !== null).sort((a, b) => a[0].localeCompare(b[0]));
    const got = pending.map((p) => [p.claimId, p.reason] as const).sort((a, b) => a[0].localeCompare(b[0]));
    expect(got).toEqual(want);
    for (const p of pending) {
      expect(p).toMatchObject({ sourceId, fromVersion: 1, toVersion: 2, status: "pending" });
    }

    // deterministic + idempotent: a re-scan of the same (source, target) adds nothing
    await scanForStaleness(ctx.db, ctx.store, { sourceId, fromVersion: v1.version, toVersionId: v2.id });
    expect(listPendingReviews(ctx.db, notebookId)).toHaveLength(want.length);

    // E1: no page invention - every anchor still carries its v1 page and version
    // (listClaims returns newest-first, so match rows by anchor quote)
    const rows = listClaims(ctx.db, notebookId);
    for (const c of pair.claims) {
      const row = rows.find((r) => r.anchors[0].quote === c.quote)!;
      expect(row.anchors).toHaveLength(1);
      expect(row.anchors[0]).toMatchObject({
        sourceVersionId: v1.id,
        version: 1,
        page: c.v1Page,
      });
    }

    runLog.set(pair.pairId, { expected: want.length, got: got.length, reasons: got.map(([, r]) => r) });
  });

  it("E2 grading: precision >= 90%, recall >= 80%, 20/20 deterministic (writes eval/reports/e1-e2-run.json)", async () => {
    expect(runLog.size).toBe(20);

    // grade MATERIAL warnings per claim across the whole corpus
    let tp = 0, fp = 0, fn = 0, tn = 0;
    const perPair = corpus.pairs.map((pair) => {
      const run = runLog.get(pair.pairId)!;
      const want = pair.expectedProposals.length;
      const gotN = run.got;
      const hits = Math.min(want, gotN); // manifest has <=1 proposal per claim; 1:1 match asserted in the pair tests
      tp += hits;
      fn += want - hits;
      fp += gotN - hits;
      tn += pair.claims.length - hits - (want - hits) - (gotN - hits);
      return {
        pairId: pair.pairId,
        category: pair.category,
        expected: want,
        got: gotN,
        ok: want === gotN && run.reasons.every((r, i) => r === pair.expectedProposals[i]?.reason),
        expectedReasons: pair.expectedProposals.map((e) => e.reason),
        gotReasons: run.reasons,
      };
    });

    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
    expect(precision).toBeGreaterThanOrEqual(0.9);
    expect(recall).toBeGreaterThanOrEqual(0.8);
    expect(perPair.every((p) => p.ok)).toBe(true); // exact per-pair outcome: 20/20

    fs.mkdirSync(path.resolve(VERSION_PAIRS_DIR, "..", "..", "reports"), { recursive: true });
    fs.writeFileSync(
      path.resolve(VERSION_PAIRS_DIR, "..", "..", "reports", "e1-e2-run.json"),
      JSON.stringify(
        {
          corpus: corpus.corpus,
          graded: "claims",
          totals: { pairs: 20, claims: corpus.totals.claims, expectedProposals: corpus.totals.expectedProposals },
          confusion: { tp, fp, fn, tn },
          precision,
          recall,
          criteria: { precisionMin: 0.9, recallMin: 0.8, met: true },
          deterministicPropagation: { expectedExactPairs: 20, ok: perPair.filter((p) => p.ok).length },
          perPair,
        },
        null,
        2
      ) + "\n"
    );
  });
});

describe("E1 anchor safety (fixture corpus version-pairs-v1)", () => {
  it("format-only pairs: zero proposals and untouched anchors after importing v2", async () => {
    for (const pair of corpus.pairs.filter((p) => p.category === "format-only")) {
      const { ctx, v1 } = await importPair(pair);
      expect(listPendingReviews(ctx.db, notebookId)).toHaveLength(0);
      const rows = listClaims(ctx.db, notebookId);
      for (const c of pair.claims) {
        const row = rows.find((r) => r.anchors[0].quote === c.quote)!;
        expect(row.anchors[0]).toMatchObject({ sourceVersionId: v1.id, version: 1, page: c.v1Page });
      }
    }
  });

  it("after importing v2, anchors still open the v1 bytes via evidence.open (no silent version switch)", async () => {
    const rtId = corpus.roundtripPairs.find((id) => corpus.pairs.find((p) => p.pairId === id)!.category === "moved")!;
    const movedPair = corpus.pairs.find((p) => p.pairId === rtId)!;
    const { ctx, v1, v1StoredId, claimIds } = await importPair(movedPair);
    const anchorId = listClaims(ctx.db, notebookId).find((c) => c._id === claimIds[2])!.anchors[0].id;

    const { handleEngineRequest } = await import("@/engine/dispatch");
    const opened = await handleEngineRequest("evidence.open", { anchorId });
    expect(opened).toEqual({
      ok: true,
      result: {
        fileName: `${movedPair.pairId}.pdf`,
        page: movedPair.claims[2].v1Page,
        locator: null, // time-range anchors only

        quote: movedPair.claims[2].quote,
        storageId: v1StoredId,
        absolutePath: expect.stringContaining(v1StoredId),
      },
    });
  });
  it("accept re-anchors to the confirmed version only when the quote is really found there", async () => {
    const byId = (id: string) => corpus.pairs.find((p) => p.pairId === id)!;
    // moved roundtrip pair: accept moves the anchor to the v2 sidecar page
    const movedPair = byId("vp06-moved");
    const m = await importPair(movedPair);
    const movedProposal = listPendingReviews(m.ctx.db, notebookId).find((p) => p.reason === "quote_moved")!;
    await resolveReview(m.ctx.db, m.ctx.store, { proposalId: movedProposal.id, decision: "accepted", note: "umgezogen" });
    const movedAnchor = listClaims(m.ctx.db, notebookId).find((c) => c._id === movedProposal.claimId)!.anchors[0];
    expect(movedAnchor.sourceVersionId).toBe(m.v2.id);
    // re-anchor used the page the quote really sits on in the v2 sidecar
    expect(movedAnchor.page).toBe(movedPair.claims[2].v2Page);

    // material-change roundtrip pair: quote absent in v2 -> accept must NOT invent a page;
    // the anchor stays resolvable on the old v1 bytes
    const materialPair = byId("vp01-material-change");
    const mc = await importPair(materialPair);
    const missingProposal = listPendingReviews(mc.ctx.db, notebookId).find((p) => p.reason === "quote_missing")!;
    await resolveReview(mc.ctx.db, mc.ctx.store, { proposalId: missingProposal.id, decision: "accepted", note: "uebernommen" });
    const materialAnchor = listClaims(mc.ctx.db, notebookId).find((c) => c._id === missingProposal.claimId)!.anchors[0];
    expect(materialAnchor.sourceVersionId).toBe(mc.v1.id);
    expect(materialAnchor.page).toBe(materialPair.claims[0].v1Page);
  });
});

describe("E2 accept/reject roundtrip (fixture corpus version-pairs-v1)", () => {
  const rtPairs = corpus.roundtripPairs.map((id) => corpus.pairs.find((p) => p.pairId === id)!);

  it.each(rtPairs)("$pairId [$category]", async (pair) => {
    const a = await importPair(pair); // reject path on source A
    const pendingA = listPendingReviews(a.ctx.db, notebookId);

    if (pair.category === "format-only") {
      // nothing to decide: zero proposals, anchors stay on v1
      expect(pendingA).toHaveLength(0);
      const rows = listClaims(a.ctx.db, notebookId);
      for (const c of pair.claims) {
        const row = rows.find((r) => r.anchors[0].quote === c.quote)!;
        expect(row.anchors[0]).toMatchObject({ version: 1, page: c.v1Page });
      }
      return;
    }

    expect(pendingA).toHaveLength(1);
    await resolveReview(a.ctx.db, a.ctx.store, { proposalId: pendingA[0].id, decision: "rejected", note: "So gewollt." });
    const [rejectedProposal] = a.ctx.db.select().from(proposalsTable).all().filter((p) => p.id === pendingA[0].id);
    expect(rejectedProposal.status).toBe("rejected");
    expect(rejectedProposal.note).toBe("So gewollt."); // human notes kept verbatim
    expect(rejectedProposal.resolvedAt).not.toBeNull();
    const rejectedClaim = listClaims(a.ctx.db, notebookId).find((c) => c._id === pendingA[0].claimId)!;
    expect(rejectedClaim.status).toBe("active");
    expect(rejectedClaim.anchors[0]).toMatchObject({ sourceVersionId: a.v1.id, version: 1 });

    const b = await importPair(pair); // accept path on source B (same pair, fresh source)
    const pendingB = listPendingReviews(b.ctx.db, notebookId).filter((p) => b.claimIds.includes(p.claimId));
    expect(pendingB).toHaveLength(1);
    await resolveReview(b.ctx.db, b.ctx.store, { proposalId: pendingB[0].id, decision: "accepted", note: "Akzeptiert nach Prüfung." });

    const acceptedAnchor = listClaims(b.ctx.db, notebookId).find((c) => c._id === pendingB[0].claimId)!.anchors[0];
    const expectedV2Page = pair.claims.find((c) => c.quote === pair.expectedProposals[0].quote)!.v2Page;
    if (pair.category === "moved") {
      expect(acceptedAnchor.sourceVersionId).toBe(b.v2.id);
      expect(acceptedAnchor.page).toBe(expectedV2Page);
    } else {
      // quote_missing (material-change / deleted): nothing to re-anchor to -
      // the anchor stays on the old version bytes, nothing invented
      expect(acceptedAnchor.sourceVersionId).toBe(b.v1.id);
      expect(acceptedAnchor.page).toBe(pair.claims.find((c) => c.quote === pair.expectedProposals[0].quote)!.v1Page);
    }
    const claimAfterAccept = listClaims(b.ctx.db, notebookId).find((c) => c._id === pendingB[0].claimId)!;
    expect(claimAfterAccept.status).toBe("reviewed");

    // history survives: the proposal row keeps from/to versions + note + timestamp
    const [acceptedProposal] = b.ctx.db.select().from(proposalsTable).all().filter((p) => p.id === pendingB[0].id);
    expect(acceptedProposal.status).toBe("accepted");
    expect(acceptedProposal.fromVersion).toBe(1);
    expect(acceptedProposal.toVersion).toBe(2);
    expect(acceptedProposal.note).toBe("Akzeptiert nach Prüfung.");
    expect(acceptedProposal.resolvedAt).not.toBeNull();
  });
});

/* ------------------------------------------------------------------------- */
/* Persistent idempotent review (priority-1 fix WPB): a durable review_scans */
/* ledger plus terminal decisions - a rescan never resurrects or duplicates  */
/* a decided proposal, and reconcile fills in what a crash left missing.     */
/* ------------------------------------------------------------------------- */

describe("persistent idempotent review (priority-1 fix WPB)", () => {
  it("rescanning after accept does not recreate a proposal", async () => {
    const ctx = getLocalContext();
    const { sourceId, v1, claimId } = await seedStaleClaim("Der Kernsatz steht auf dieser Seite.");
    const v2 = await recordVersion(ctx.db, ctx.store, {
      sourceId,
      pageTexts: ["Zweite Seite mit Fülltext", "Der Kernsatz steht auf dieser Seite."],
    });
    const [proposal] = listPendingReviews(ctx.db, notebookId);
    await resolveReview(ctx.db, ctx.store, { proposalId: proposal.id, decision: "accepted" });

    // the anchor's CURRENT version (v2) is considered, not its history
    await scanForStaleness(ctx.db, ctx.store, { sourceId, fromVersion: v1.version, toVersionId: v2.id });
    expect(listPendingReviews(ctx.db, notebookId)).toHaveLength(0);
    expect(listClaims(ctx.db, notebookId).find((c) => c._id === claimId)!.anchors[0]).toMatchObject({
      sourceVersionId: v2.id,
      page: 2,
    });
  });

  it("rejecting then rescanning does not resurrect the anchor or the proposal", async () => {
    const ctx = getLocalContext();
    const { sourceId, v1, claimId } = await seedStaleClaim("Der Kernsatz steht auf der ersten Seite.");
    const v2 = await recordVersion(ctx.db, ctx.store, {
      sourceId,
      pageTexts: ["Andere erste Seite ohne den Kernsatz.", "Der Kernsatz steht auf der ersten Seite."],
    });
    const [proposal] = listPendingReviews(ctx.db, notebookId);
    await resolveReview(ctx.db, ctx.store, { proposalId: proposal.id, decision: "rejected", note: "So gewollt." });

    // the rescan is terminal: the rejected proposal is never recreated
    await scanForStaleness(ctx.db, ctx.store, { sourceId, fromVersion: v1.version, toVersionId: v2.id });
    expect(listPendingReviews(ctx.db, notebookId)).toHaveLength(0);
    const all = ctx.db.select().from(proposalsTable).all();
    expect(all).toHaveLength(1); // no duplicate, the decision stands
    expect(all[0]).toMatchObject({ status: "rejected" });
    // and the anchor is untouched: it still resolves the v1 bytes
    expect(listClaims(ctx.db, notebookId).find((c) => c._id === claimId)!.anchors[0]).toMatchObject({
      sourceVersionId: v1.id,
      version: 1,
    });
  });

  it("multiple anchors across multiple versions keep their provenance", async () => {
    const ctx = getLocalContext();
    const a = await seedStaleClaim("Satz der Quelle A.");
    const b = await seedStaleClaim("Satz der Quelle B.");

    // only source A is re-imported with changed content
    const a2 = await recordVersion(ctx.db, ctx.store, {
      sourceId: a.sourceId,
      pageTexts: ["Neuer Inhalt.", "Satz der Quelle A."],
    });

    // only source A's dependents get proposals; source B's anchor is untouched
    const pending = listPendingReviews(ctx.db, notebookId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ claimId: a.claimId, sourceId: a.sourceId, fromVersion: 1, toVersion: 2 });

    await scanForStaleness(ctx.db, ctx.store, { sourceId: a.sourceId, fromVersion: 1, toVersionId: a2.id });
    expect(listPendingReviews(ctx.db, notebookId)).toHaveLength(1); // still exactly one
    const bClaim = listClaims(ctx.db, notebookId).find((c) => c._id === b.claimId)!;
    expect(bClaim.anchors).toHaveLength(1);
    expect(bClaim.anchors[0]).toMatchObject({ sourceVersionId: b.v1.id, version: 1 });
  });

  it("resolveReview of an old proposal never rewinds an anchor to an older version", async () => {
    const ctx = getLocalContext();
    const { sourceId, claimId } = await seedStaleClaim("Der Kernsatz steht auf dieser Seite.");
    const v2 = await recordVersion(ctx.db, ctx.store, {
      sourceId,
      pageTexts: ["Zweite Seite mit Fülltext", "Der Kernsatz steht auf dieser Seite."],
    });
    const [proposal] = listPendingReviews(ctx.db, notebookId);
    await resolveReview(ctx.db, ctx.store, { proposalId: proposal.id, decision: "accepted", note: "geprüft" });

    // anchor now sits on v2 page 2
    const anchorAfterAccept = listClaims(ctx.db, notebookId).find((c) => c._id === claimId)!.anchors[0];
    expect(anchorAfterAccept).toMatchObject({ sourceVersionId: v2.id, page: 2 });
    const anchorId = anchorAfterAccept.id;

    // craft a v0->v1 era proposal for the SAME anchor: resolving it must not rewind
    const now = Date.now();
    ctx.db.insert(proposalsTable).values({
      id: "stale-v01", claimId, sourceId, fromVersion: 0, toVersion: 1,
      reason: "quote_moved", detail: "veraltet", anchorId, status: "pending", createdAt: now,
    }).run();

    const staleOutcome = await resolveReview(ctx.db, ctx.store, { proposalId: "stale-v01", decision: "accepted" });
    expect(staleOutcome).toEqual({ status: "conflict", anchorVersion: 2 });
    // anchor NOT rewound, stale proposal stays pending for an honest manual reject
    expect(listClaims(ctx.db, notebookId).find((c) => c._id === claimId)!.anchors[0]).toMatchObject({
      sourceVersionId: v2.id,
      page: 2,
    });

    // a proposal whose target IS the current version is already resolved
    ctx.db.insert(proposalsTable).values({
      id: "already-v2", claimId, sourceId, fromVersion: 1, toVersion: 2,
      reason: "quote_moved", detail: "doppelt", anchorId, status: "pending", createdAt: now,
    }).run();
    const alreadyOutcome = await resolveReview(ctx.db, ctx.store, { proposalId: "already-v2", decision: "accepted" });
    expect(alreadyOutcome).toEqual({ status: "already_resolved" });
    expect(listClaims(ctx.db, notebookId).find((c) => c._id === claimId)!.anchors[0]).toMatchObject({ sourceVersionId: v2.id });
  });

  it("a partially failed scan leaves no half-applied decision", async () => {
    const ctx = getLocalContext();
    const sourceId = await createSource(ctx.db, {
      ownerId: "local", notebookId, fileName: "zwei-quellen.txt", fileType: "text/plain", fileSize: 10,
    });
    await recordVersion(ctx.db, ctx.store, { sourceId, pageTexts: ["Erster Satz.", "Zweiter Satz."] });
    for (const quote of ["Erster Satz.", "Zweiter Satz."]) {
      await createClaim(ctx.db, {
        notebookId, ownerId: "local", text: `Behauptung: ${quote}`, origin: "user",
        anchors: [{ sourceId, quote }],
      });
    }
    // a healthy scan lands both proposals + one ledger row
    const v2 = await recordVersion(ctx.db, ctx.store, {
      sourceId,
      pageTexts: ["Zweite Seite mit Fülltext", "Erster Satz.", "Zweiter Satz."],
    });

    // simulate a crash AFTER one proposal: delete the second one and rewind
    // the ledger row into the stuck 'pending' state the crash would leave
    const after = ctx.db.select().from(proposalsTable).all();
    expect(after).toHaveLength(2);
    ctx.db.delete(proposalsTable).where(eq(proposalsTable.id, after[1].id)).run();
    // one ledger row per appended version (v1 scan + v2 scan); rewind the v2
    // row into the stuck 'pending' state a mid-scan crash leaves behind
    const ledger = ctx.db.select().from(reviewScansTable).all();
    expect(ledger).toHaveLength(2);
    const v2Row = ledger.find((row) => row.toVersionId === v2.id)!;
    ctx.db.update(reviewScansTable)
      .set({ status: "pending", createdAt: Date.now() - 61_000 })
      .where(eq(reviewScansTable.id, v2Row.id))
      .run();

    // reconcile re-runs the scan: missing proposal filled in, existing one NOT duplicated
    const { reconcileReviewScans } = await import("@/lib/services/change-review");
    const { rescanned } = await reconcileReviewScans(ctx.db, ctx.store);
    expect(rescanned).toBe(1);
    expect(ctx.db.select().from(proposalsTable).all()).toHaveLength(2);

    // second reconcile: the ledger row is 'ok' now, nothing left to do
    expect((await reconcileReviewScans(ctx.db, ctx.store)).rescanned).toBe(0);
    expect(ctx.db.select().from(proposalsTable).all()).toHaveLength(2);
  });

  it("concurrent reimports do not mix files/chunks/versions", async () => {
    const ctx = getLocalContext();
    const sourceId = await createSource(ctx.db, {
      ownerId: "local", notebookId, fileName: "paralelo.txt", fileType: "text/plain", fileSize: 20,
    });

    // two racing recordVersion calls with DIFFERENT buffers: the max(version)
    // query and the insert are adjacent (no await between), so the sync
    // driver serializes them and the UNIQUE(source_id, version) holds
    const [a, b] = await Promise.all([
      recordVersion(ctx.db, ctx.store, { sourceId, pageTexts: ["Fassung Alpha."] }),
      recordVersion(ctx.db, ctx.store, { sourceId, pageTexts: ["Fassung Beta."] }),
    ]);

    const all = listVersions(ctx.db, sourceId);
    expect(all.map((v) => v.version)).toEqual([1, 2]);
    expect(all.map((v) => v.id).sort()).toEqual([a.id, b.id].sort());

    // no file mixing: each version's sidecar carries exactly its own content
    const pa = await readVersionPages(ctx.store, a.id);
    const pb = await readVersionPages(ctx.store, b.id);
    const texts = [pa![0].text, pb![0].text].sort();
    expect(texts).toEqual(["Fassung Alpha.", "Fassung Beta."]);

    // exactly one scan-ledger row per appended version, both finished ok
    const scans = ctx.db.select().from(reviewScansTable).all();
    expect(scans).toHaveLength(2);
    expect(new Set(scans.map((s) => s.toVersionId))).toEqual(new Set([a.id, b.id]));
    expect(scans.every((s) => s.status === "ok")).toBe(true);
  });
});

