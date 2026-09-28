/**
 * PI-0 corpus validator — eval/corpus/document-trees-v1
 *
 * Extracts text from every generated PDF with pdf-parse (per page) and checks:
 *  1. every expectedEvidence quoteSnippet really appears on its claimed page
 *  2. the claimed section is one of the sidecar sectionTitles for that page
 *  3. every unanswerable probeTerm appears NOWHERE in the corpus text
 *  4. manifest, sidecars and questions.json are mutually consistent
 *
 * Run:  node validate-corpus.mjs   (exit code 0 = all checks pass)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "manifest.json"), "utf8"));
  const qfile = JSON.parse(fs.readFileSync(path.join(HERE, "questions.json"), "utf8"));
  const questions = qfile.questions;

  let errors = 0;
  const fail = (msg) => { errors++; console.error("FAIL " + msg); };

  /* ---------------------------------------------- extract all PDFs (pages) */
  const pageText = new Map(); // docId -> Map(pageIndex -> normalized text)
  for (const d of manifest.docs) {
    const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(path.join(HERE, d.fileName))) });
    try {
      const r = await parser.getText();
      const pages = new Map();
      for (const p of r.pages) pages.set(p.num, norm(p.text));
      if (pages.size !== d.pages) fail(`${d.docId}: pdf has ${pages.size} pages, manifest says ${d.pages}`);
      pageText.set(d.docId, pages);
    } finally {
      await parser.destroy();
    }
  }

  /* --------------------------------------------------- sidecar consistency */
  for (const d of manifest.docs) {
    const sidecar = JSON.parse(fs.readFileSync(path.join(HERE, d.fileName.replace(/\.pdf$/, ".json")), "utf8"));
    if (sidecar.docId !== d.docId || sidecar.fileName !== d.fileName) fail(`${d.docId}: sidecar id mismatch`);
    if (sidecar.pages.length !== d.pages) fail(`${d.docId}: sidecar page count mismatch`);
    if (sidecar.toc !== d.toc) fail(`${d.docId}: sidecar toc flag mismatch`);
    if (sidecar.pageLabels.length !== d.pages) fail(`${d.docId}: pageLabels length mismatch`);
    for (const p of sidecar.pages) {
      if (!p.sectionTitles?.length) fail(`${d.docId} p${p.pageIndex}: no sectionTitles`);
      if (!p.firstWords) fail(`${d.docId} p${p.pageIndex}: no firstWords`);
    }
  }

  /* --------------------------------------------------------- schema checks */
  const docIds = new Set(manifest.docs.map((d) => d.docId));
  const countBy = (fn) => questions.reduce((m, q) => ((m[fn(q)] = (m[fn(q)] || 0) + 1), m), {});
  const bySubset = countBy((q) => q.subset);
  const byType = countBy((q) => q.type);
  if (questions.length !== 80) fail(`questions: ${questions.length} != 80`);
  if (bySubset.dev !== 30 || bySubset.eval !== 50) fail(`subsets: ${JSON.stringify(bySubset)}`);
  const want = { "exact-fact": 25, "within-doc-xref": 15, "cross-section-comparison": 10, "cross-document-comparison": 10, unanswerable: 20 };
  for (const [t, n] of Object.entries(want)) if ((byType[t] || 0) < n) fail(`type ${t}: ${byType[t] || 0} < required ${n}`);
  const seenIds = new Set();
  for (const q of questions) {
    if (seenIds.has(q.id)) fail(`duplicate question id ${q.id}`);
    seenIds.add(q.id);
    if (q.type === "unanswerable") {
      if (q.docIds.length) fail(`${q.id}: unanswerable must have empty docIds`);
      if (q.expectedEvidence.length) fail(`${q.id}: unanswerable must have empty expectedEvidence`);
      if (!q.probeTerm) fail(`${q.id}: unanswerable missing probeTerm`);
      continue;
    }
    for (const id of q.docIds) if (!docIds.has(id)) fail(`${q.id}: unknown docId ${id}`);
    if (q.type === "cross-document-comparison" && new Set(q.docIds).size < 2) fail(`${q.id}: cross-document needs >= 2 docs`);
    if (!q.expectedEvidence.length) fail(`${q.id}: answerable question without expectedEvidence`);
  }

  /* --------------------------------------------------- quote-on-page checks */
  let checked = 0;
  for (const q of questions) {
    for (const ev of q.expectedEvidence) {
      checked++;
      const pages = pageText.get(ev.docId);
      if (!pages) { fail(`${q.id}: evidence docId ${ev.docId} not in manifest`); continue; }
      const text = pages.get(ev.page);
      if (text === undefined) { fail(`${q.id}: page ${ev.page} does not exist in ${ev.docId}`); continue; }
      const quote = norm(ev.quoteSnippet);
      if (!text.includes(quote)) fail(`${q.id}: quote not found on ${ev.docId} p${ev.page}: "${ev.quoteSnippet}"`);
      const sidecar = JSON.parse(fs.readFileSync(path.join(HERE, manifest.docs.find((d) => d.docId === ev.docId).fileName.replace(/\.pdf$/, ".json")), "utf8"));
      const titles = sidecar.pages[ev.page - 1].sectionTitles.map(norm);
      if (!titles.includes(norm(ev.section))) fail(`${q.id}: section "${ev.section}" not on ${ev.docId} p${ev.page} (has: ${titles.join(", ")})`);
    }
  }

  /* ------------------------------------------------ unanswerable probe scan */
  const allText = [...pageText.values()].flatMap((m) => [...m.values()]).join(" ");
  for (const q of questions.filter((x) => x.type === "unanswerable")) {
    if (q.probeTerm && allText.includes(norm(q.probeTerm))) {
      fail(`${q.id}: probeTerm "${q.probeTerm}" DOES appear in corpus - question is answerable`);
    }
  }

  /* ------------------------------------------------------------- manifest */
  const langs = {};
  let total = 0;
  for (const d of manifest.docs) {
    langs[d.language] = (langs[d.language] || 0) + 1;
    total += d.pages;
    if (!fs.existsSync(path.join(HERE, d.fileName))) fail(`missing pdf: ${d.fileName}`);
  }
  if (manifest.docs.length < 20) fail("fewer than 20 docs in manifest");
  if (manifest.totals.pages !== total) fail(`manifest totals.pages ${manifest.totals.pages} != ${total}`);
  if (JSON.stringify(manifest.languageCounts) !== JSON.stringify(langs)) fail("manifest languageCounts mismatch");

  /* -------------------------------------------------------------- summary */
  console.log(`docs: ${manifest.docs.length} (${total} pages), languages: ${JSON.stringify(langs)}`);
  console.log(`questions: ${questions.length} (dev ${bySubset.dev} / eval ${bySubset.eval})`);
  console.log(`types: ${JSON.stringify(byType)}`);
  console.log(`evidence quotes checked: ${checked}`);
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
