/**
 * Extract page texts from the fusion-proto corpus PDFs so the laya
 * prototype (Python) can read them without a PDF dependency.
 *
 * Mirrors the extraction in eval/harness/run-retrieval-eval.mts
 * (pdf-parse, same page join shape). Output: results/pages.json
 *   { corpus: "fusion-proto-v1", docs: { docId: { language, pages: [{page, text}] } } }
 *
 * Run: pnpm exec tsx eval/laya-proto/extract-pages.mts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, "..", "fusion-proto", "corpus");
const OUT = path.join(HERE, "results", "pages.json");

const manifest = JSON.parse(
  fs.readFileSync(path.join(CORPUS, "manifest.json"), "utf-8"),
);

const docs = {};
for (const doc of manifest.docs) {
  const buf = fs.readFileSync(path.join(CORPUS, doc.fileName));
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  let pageTexts;
  try {
    const r = await parser.getText();
    pageTexts = r.pages.map((p) => p.text);
  } finally {
    await parser.destroy();
  }
  if (pageTexts.length !== doc.pages) {
    throw new Error(
      `${doc.docId}: pdf has ${pageTexts.length} pages, manifest says ${doc.pages}`,
    );
  }
  docs[doc.docId] = {
    language: doc.language,
    pages: pageTexts.map((text, i) => ({ page: i + 1, text })),
  };
  console.log(`${doc.docId}: ${pageTexts.length} pages extracted`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify({ corpus: "fusion-proto-v1", docs }, null, 2),
);
console.log(`wrote ${OUT}`);
