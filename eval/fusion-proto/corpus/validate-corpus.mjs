/**
 * P3 corpus validator — eval/fusion-proto/corpus
 * Adapted from eval/multilingual-proto/corpus/validate-corpus.mjs (T3).
 * Checks (exit 0 = all pass): quotes on claimed pages, sections on claimed
 * pages, probeTerm absent from corpus, manifest/sidecar/questions
 * consistency, 12/18 split, full pair coverage, distractor-token presence
 * (each cross-distractor query shares tokens with >= 2 same-language docs).
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
  if (questions.length !== 30) fail("questions: " + questions.length + " != 30");
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
      if (!docIds.has(ev.docId)) fail(q.id + ": unknown evidence docId");
      const evLang = manifest.docs.find((d) => d.docId === ev.docId)?.language;
      if (q.pair !== evLang + "-" + evLang && q.pair !== q.language + "-" + evLang) {
        fail(q.id + ": pair " + q.pair + " does not match query/evidence languages");
      }
    }
  }
  if (bySubset.dev !== 12 || bySubset.eval !== 18) fail("subset split: " + JSON.stringify(bySubset));
  if (byType["mono-fact"] !== 8) fail("mono-fact count: " + byType["mono-fact"]);
  if (byType["cross-fact"] !== 5) fail("cross-fact count: " + byType["cross-fact"]);
  if (byType["cross-name"] !== 4) fail("cross-name count: " + byType["cross-name"]);
  if (byType["cross-number"] !== 4) fail("cross-number count: " + byType["cross-number"]);
  if (byType["cross-distractor"] !== 3) fail("cross-distractor count: " + byType["cross-distractor"]);
  if (byType["unanswerable"] !== 6) fail("unanswerable count: " + byType["unanswerable"]);
  for (const p of ["es-es", "de-de", "en-en", "es-de", "de-es", "de-en", "es-en", "en-es", "en-de"]) {
    if (!byPair[p]) fail("missing pair " + p);
  }
  if (byPair["none"] !== 6) fail("unanswerable pair count: " + byPair["none"]);

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

  // cross-distractor design check: the query's own-language tokens must hit
  // at least two OTHER documents of the query language (the both-branch
  // distractor pool that buries the vector head under plain RRF)
  for (const q of questions.filter((x) => x.type === "cross-distractor")) {
    const terms = q.question.toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}]/gu, "")).filter((t) => t.length >= 4);
    const sameLangDocs = manifest.docs.filter((d) => d.language === q.language && !q.docIds.includes(d.docId));
    const hitDocs = sameLangDocs.filter((d) => {
      const text = [...pageText.get(d.docId).values()].join(" ");
      return terms.some((t) => text.includes(t));
    });
    if (hitDocs.length < 2) {
      fail(q.id + ": distractor design - only " + hitDocs.length + " same-language docs share a query token");
    }
  }

  // cross-name design check: the foreign org name in the query must appear in
  // the evidence document (the lexical bridge), and cross-number digits too
  for (const q of questions.filter((x) => x.type === "cross-name" || x.type === "cross-number")) {
    const evDoc = q.docIds[0];
    const text = [...pageText.get(evDoc).values()].join(" ");
    const tokens = q.question.toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}]/gu, "")).filter((t) => t.length >= 4);
    const bridged = tokens.some((t) => text.includes(t));
    if (!bridged) fail(q.id + ": no lexical bridge token from the query reaches the evidence doc");
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
