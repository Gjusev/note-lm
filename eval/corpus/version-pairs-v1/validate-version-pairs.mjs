/**
 * version-pairs-v1 validator
 *
 * Asserts the manifest expectations against the generated PDFs, searching
 * quotes with the SAME normalization as findQuotePage in
 * src/lib/services/change-review.ts (whitespace collapsed, case-insensitive,
 * punctuation preserved). The pages come from pdf-parse - the same extraction
 * engine recordVersion uses - so what is validated here is what the scan sees.
 *
 * Run:  node validate-version-pairs.mjs   (exit code 0 = all checks pass)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Replicated 1:1 from src/lib/services/change-review.ts (findQuotePage). */
const findQuotePage = (pages, quote) => {
  const needle = String(quote).replace(/\s+/g, " ").trim().toLowerCase();
  if (!needle) return null;
  for (const candidate of pages) {
    if (candidate.text.replace(/\s+/g, " ").toLowerCase().includes(needle)) {
      return candidate.page;
    }
  }
  return null;
};

async function extractPages(file) {
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(file)) });
  try {
    const r = await parser.getText();
    return r.pages.map((p, i) => ({ page: i + 1, text: p.text })); // 1-based, as recordVersion does
  } finally {
    await parser.destroy?.();
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "manifest.json"), "utf8"));

  let errors = 0;
  const fail = (msg) => {
    errors++;
    console.error("FAIL " + msg);
  };

  /* ------------------------------------------------------ manifest shape */
  if (manifest.corpus !== "version-pairs-v1") fail(`corpus id ${manifest.corpus}`);
  if (manifest.totals.pairs !== 20) fail(`totals.pairs ${manifest.totals.pairs} != 20`);
  for (const cat of ["material-change", "moved", "deleted", "format-only"]) {
    if ((manifest.categoryCounts[cat] || 0) < 4) fail(`category ${cat}: fewer than 4 pairs`);
  }
  const wantRoundtrip = { "material-change": 1, moved: 1, deleted: 1, "format-only": 1 };
  if (manifest.roundtripPairs?.length !== 4) fail("roundtripPairs must list one pair per category");
  const catOf = new Map(manifest.pairs.map((p) => [p.pairId, p.category]));
  for (const id of manifest.roundtripPairs ?? []) {
    if (!catOf.has(id)) fail(`roundtripPairs: unknown pairId ${id}`);
  }
  if (new Set(manifest.roundtripPairs ?? []).size !== 4) fail("roundtripPairs: duplicates");

  /* ------------------------------------------------- per-pair expectations */
  let claimsChecked = 0;
  for (const pair of manifest.pairs) {
    if (!fs.existsSync(path.join(HERE, pair.v1File))) fail(`${pair.pairId}: missing ${pair.v1File}`);
    if (!fs.existsSync(path.join(HERE, pair.v2File))) fail(`${pair.pairId}: missing ${pair.v2File}`);
    if (pair.claims.length < 3) fail(`${pair.pairId}: fewer than 3 claims`);
    const wantReason = { "material-change": "quote_missing", moved: "quote_moved", deleted: "quote_missing", "format-only": null };
    const expected = pair.expectedProposals;
    if (pair.category === "format-only" && expected.length !== 0) {
      fail(`${pair.pairId}: format-only pairs must expect no proposals`);
    }
    for (const e of expected) {
      if (e.reason !== wantReason[pair.category]) {
        fail(`${pair.pairId}: expected reason ${e.reason} does not match category ${pair.category}`);
      }
      if (!pair.claims.some((c) => c.quote === e.quote)) fail(`${pair.pairId}: proposal quote not among claims`);
    }
    const nExpect = expected.length;
    if (pair.category !== "format-only" && nExpect !== 1) fail(`${pair.pairId}: expected exactly one proposal`);

    const v1 = await extractPages(path.join(HERE, pair.v1File));
    const v2 = await extractPages(path.join(HERE, pair.v2File));
    if (v1.length !== pair.v1Pages) fail(`${pair.pairId}: v1 has ${v1.length} pages, manifest says ${pair.v1Pages}`);
    if (v2.length !== pair.v2Pages) fail(`${pair.pairId}: v2 has ${v2.length} pages, manifest says ${pair.v2Pages}`);

    for (const c of pair.claims) {
      claimsChecked++;
      const v1Found = findQuotePage(v1, c.quote);
      if (v1Found !== c.v1Page) {
        fail(`${pair.pairId}: v1 quote page ${v1Found} != expected ${c.v1Page}: "${c.quote.slice(0, 50)}..."`);
        continue;
      }
      const v2Found = findQuotePage(v2, c.quote);
      if (c.v2Expected === "missing") {
        if (v2Found !== null) fail(`${pair.pairId}: quote must be ABSENT in v2 but found on p${v2Found}: "${c.quote.slice(0, 50)}..."`);
      } else if (c.v2Expected === "moved") {
        if (v2Found === null) fail(`${pair.pairId}: moved quote not found in v2 at all`);
        else if (v2Found !== c.v2Page) fail(`${pair.pairId}: moved quote on v2 p${v2Found}, expected p${c.v2Page}`);
        else if (v2Found === c.v1Page) fail(`${pair.pairId}: moved quote did not actually move`);
      } else if (typeof c.v2Expected === "number") {
        if (v2Found !== c.v2Expected) fail(`${pair.pairId}: v2 quote on p${v2Found}, expected p${c.v2Expected}`);
      } else {
        fail(`${pair.pairId}: unsupported v2Expected ${c.v2Expected}`);
      }
      // sidecar consistency: the drawn-text sidecar agrees with pdf-parse page counts
      const sidecar = JSON.parse(fs.readFileSync(path.join(HERE, pair.v1File.replace(/\.pdf$/, ".json")), "utf8"));
      if (!Array.isArray(sidecar.pages) || sidecar.pages.length !== v1.length) {
        fail(`${pair.pairId}: v1 sidecar page count mismatch`);
      }
    }
  }

  /* ------------------------------------------------------------- summary */
  const totalExpected = manifest.pairs.reduce((n, p) => n + p.expectedProposals.length, 0);
  console.log(`pairs: ${manifest.pairs.length}, claims checked: ${claimsChecked}`);
  console.log(`categories: ${JSON.stringify(manifest.categoryCounts)}`);
  console.log(`expected proposals: ${totalExpected}`);
  if (errors) {
    console.error(`\n${errors} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nALL CHECKS PASSED");
}

main().catch((err) => {
  console.error("validation crashed:", err);
  process.exit(1);
});
