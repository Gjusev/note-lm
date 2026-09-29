/**
 * T3 corpus validator — eval/multilingual-proto/corpus
 * Adapted from eval/corpus/document-trees-v1/validate-corpus.mjs.
 * Checks (exit 0 = all pass): quotes on claimed pages, sections on claimed
 * pages, probeTerm absent from corpus, manifest/sidecar/questions
 * consistency, 40/60 split, full pair coverage.
 * Run:  node validate-corpus.mjs
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

  const pageText = new Map();
  for (const d of manifest.docs) {
    const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(path.join(HERE, d.fileName))) });
    try {
      const r = await parser.getText();
      const pages = new Map();
      for (const p of r.pages) pages.set(p.num, norm(p.text));
      if (pages.size !== d.pages) fail(d.docId + ": pdf page count mismatch");
      pageText.set(d.docId, pages);
    } finally {
      await parser.destroy();
    }
  }

  for (const d of manifest.docs) {
    const sidecar = JSON.parse(fs.readFileSync(path.join(HERE, d.fileName.replace(/\.pdf$/, ".json")), "utf8"));
    if (sidecar.docId !== d.docId || sidecar.fileName !== d.fileName) fail(d.docId + ": sidecar id mismatch");
    if (sidecar.pages.length !== d.pages) fail(d.docId + ": sidecar page count mismatch");
    for (const p of sidecar.pages) {
      if (!p.sectionTitles?.length) fail(d.docId + " p" + p.pageIndex + ": no sectionTitles");
      if (!p.firstWords) fail(d.docId + " p" + p.pageIndex + ": no firstWords");
    }
  }

  const docIds = new Set(manifest.docs.map((d) => d.docId));
  if (questions.length !== 40) fail("questions: " + questions.length + " != 40");
  const bySubset = {};
  const byType = {};
  const byPair = {};
  const seen = new Set();
  for (const q of questions) {
    if (seen.has(q.id)) fail("duplicate question id " + q.id);
    seen.add(q.id);
    bySubset[q.subset] = (bySubset[q.subset] || 0) + 1;
    byType[q.type] = (byType[q.type] || 0) + 1;
    byPair[q.pair] = (byPair[q.pair] || 0) + 1;
    if (q.type === "unanswerable") {
      if (q.docIds.length) fail(q.id + ": unanswerable must have empty docIds");
      if (q.expectedEvidence.length) fail(q.id + ": unanswerable must have empty expectedEvidence");
      if (!q.probeTerm) fail(q.id + ": missing probeTerm");
      continue;
    }
    for (const id of q.docIds) if (!docIds.has(id)) fail(q.id + ": unknown docId " + id);
    if (!q.expectedEvidence.length) fail(q.id + ": answerable without expectedEvidence");
    for (const ev of q.expectedEvidence) {
      if (!docIds.has(ev.docId)) fail(q.id + ": unknown evidence docId " + ev.docId);
      const evLang = manifest.docs.find((d) => d.docId === ev.docId)?.language;
      if (q.pair !== evLang + "-" + evLang && q.pair !== q.language + "-" + evLang) {
        fail(q.id + ": pair " + q.pair + " does not match query/evidence languages");
      }
    }
  }
  if (bySubset.dev !== 16 || bySubset.eval !== 24) fail("subset split: " + JSON.stringify(bySubset));
  if (byType["exact-fact"] !== 12) fail("exact-fact count: " + byType["exact-fact"]);
  if (byType["cross-lingual-fact"] !== 20) fail("cross count: " + byType["cross-lingual-fact"]);
  if (byType["unanswerable"] !== 8) fail("unanswerable count: " + byType["unanswerable"]);
  for (const p of ["es-es", "de-de", "en-en", "es-de", "de-es", "de-en", "es-en", "en-es", "en-de"]) {
    if (!byPair[p]) fail("missing pair " + p);
  }
  if (byPair["none"] !== 8) fail("unanswerable pair count: " + byPair["none"]);

  let checked = 0;
  for (const q of questions) {
    for (const ev of q.expectedEvidence) {
      checked++;
      const pages = pageText.get(ev.docId);
      if (!pages) { fail(q.id + ": evidence docId not in manifest"); continue; }
      const text = pages.get(ev.page);
      if (text === undefined) { fail(q.id + ": page does not exist"); continue; }
      if (!text.includes(norm(ev.quoteSnippet))) {
        fail(q.id + ': quote not on ' + ev.docId + ' p' + ev.page + ': "' + ev.quoteSnippet + '"');
      }
      const d = manifest.docs.find((x) => x.docId === ev.docId);
      const sidecar = JSON.parse(fs.readFileSync(path.join(HERE, d.fileName.replace(/\.pdf$/, ".json")), "utf8"));
      const titles = (sidecar.pages[ev.page - 1]?.sectionTitles ?? []).map(norm);
      if (!titles.includes(norm(ev.section))) {
        fail(q.id + ': section "' + ev.section + '" not on ' + ev.docId + ' p' + ev.page);
      }
    }
  }

  const allText = [...pageText.values()].flatMap((m) => [...m.values()]).join(" ");
  for (const q of questions.filter((x) => x.type === "unanswerable")) {
    if (q.probeTerm && allText.includes(norm(q.probeTerm))) {
      fail(q.id + ': probeTerm "' + q.probeTerm + '" DOES appear in corpus');
    }
  }

  let total = 0;
  const langs = {};
  for (const d of manifest.docs) {
    langs[d.language] = (langs[d.language] || 0) + 1;
    total += d.pages;
    if (!fs.existsSync(path.join(HERE, d.fileName))) fail("missing pdf: " + d.fileName);
  }
  if (manifest.totals.pages !== total) fail("manifest totals mismatch");
  if (manifest.docs.length !== 12) fail("expected 12 docs");

  console.log("docs: " + manifest.docs.length + " (" + total + " pages), languages: " + JSON.stringify(langs));
  console.log("questions: " + questions.length + " (dev " + bySubset.dev + " / eval " + bySubset.eval + ")");
  console.log("types: " + JSON.stringify(byType));
  console.log("pairs: " + JSON.stringify(byPair));
  console.log("evidence quotes checked: " + checked);
  if (errors) { console.error("\n" + errors + " check(s) FAILED"); process.exit(1); }
  console.log("\nALL CHECKS PASSED");
}

main().catch((err) => { console.error("validation crashed:", err); process.exit(1); });
