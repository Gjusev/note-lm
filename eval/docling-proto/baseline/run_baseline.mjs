/**
 * T1 baseline runner - pdf-parse (the extractor the product uses today).
 *
 * Usage: node run_baseline.mjs            (from anywhere; resolves pdf-parse
 *         from the repo node_modules, same import style as eval/corpus)
 *
 * Extracts per-page text for every corpus PDF and records wall time and peak
 * RSS. Raw page texts land in ../results/baseline_results.json; all grading
 * happens in ../grade.py against the corpus manifest.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { PDFParse } from "pdf-parse";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE); // eval/docling-proto
const REPO = path.resolve(ROOT, "..", "..");
const require = createRequire(path.join(REPO, "noop.js"));

const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "corpus", "manifest.json"), "utf8"));
const results = {
  tool: "pdf-parse " + require(path.join(REPO, "node_modules", "pdf-parse", "package.json")).version,
  notes: "pdf-parse gives flat per-page text only: no table structure, no images/OCR, no per-item regions.",
  docs: {},
};

let coldMs = null;
for (const doc of manifest.docs) {
  const t0 = performance.now();
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(path.join(ROOT, "corpus", doc.fileName))) });
  let pagesText;
  try {
    const r = await parser.getText();
    pagesText = r.pages.map((p) => p.text);
  } catch (err) {
    pagesText = null;
    results.docs[doc.fileName] = { error: String(err), wall_ms: performance.now() - t0 };
    console.error("PARSE FAIL", doc.fileName, err);
    continue;
  } finally {
    await parser.destroy();
  }
  const wall = performance.now() - t0;
  if (coldMs === null) coldMs = wall;
  results.docs[doc.fileName] = {
    wall_ms: wall,
    page_count: pagesText.length,
    pages_text: pagesText, // raw, for grade.py; phrase matching normalizes there
  };
  console.log(`${doc.fileName}  ${wall.toFixed(0)} ms  ${pagesText.length} pages`);
}

results.peak_rss_kb = process.resourceUsage().maxRSS;
results.first_doc_ms = coldMs;
fs.writeFileSync(path.join(HERE, "..", "results", "baseline_results.json"), JSON.stringify(results, null, 2));
console.log("wrote results/baseline_results.json; peak RSS " + (results.peak_rss_kb / 1024).toFixed(0) + " MB");
