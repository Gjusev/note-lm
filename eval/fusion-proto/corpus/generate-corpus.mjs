/**
 * P3 corpus generator — eval/fusion-proto/corpus (fusion-proto-v1)
 * Adapted from eval/multilingual-proto/corpus/generate-corpus.mjs (T3).
 * Deterministic: fixed literals, pinned metadata dates, one section per page.
 * Run:  node generate-corpus.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXED_DATE = new Date(Date.UTC(2026, 8, 29, 9, 0, 0));

import { EN } from "./content-en.mjs";
import { ES } from "./content-es.mjs";
import { DE } from "./content-de.mjs";
import { ES_QUESTIONS } from "./questions-es.mjs";
import { DE_QUESTIONS } from "./questions-de.mjs";
import { EN_QUESTIONS } from "./questions-en.mjs";

const DOCS = [...EN, ...ES, ...DE];
const QUESTIONS = [...ES_QUESTIONS, ...DE_QUESTIONS, ...EN_QUESTIONS];

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = { left: 56, right: 56, top: 64, bottom: 60 };
const USABLE_W = PAGE_W - M.left - M.right;
const BODY = 10.5;
const LH = 14.5;
const HEAD = 13;
const GRAY = rgb(0.3, 0.3, 0.3);
const BLACK = rgb(0, 0, 0);

async function buildDoc(doc, pdfLibVersion) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  pdf.setTitle(doc.title);
  pdf.setSubject(doc.subtitle);
  pdf.setAuthor("P3 fusion-proto corpus");
  pdf.setProducer("pdf-lib " + pdfLibVersion);
  pdf.setCreator("generate-corpus.mjs (deterministic)");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pagesMeta = [];
  let page = null;
  let meta = null;
  let y = 0;
  let curSection = doc.title;

  const newPage = () => {
    if (meta) meta.sectionTitles = [...meta.set];
    page = pdf.addPage([PAGE_W, PAGE_H]);
    meta = { set: new Set([curSection]), firstWords: "" };
    pagesMeta.push(meta);
    y = M.top;
  };

  function wrap(text, f, size, maxW) {
    const words = text.split(/\s+/);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const cand = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(cand, size) <= maxW) cur = cand;
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  const line = (text, opts = {}) => {
    const size = opts.size ?? BODY;
    const f = opts.f ?? font;
    const x = opts.x ?? M.left;
    if (y + LH > PAGE_H - M.bottom) {
      throw new Error(doc.id + ": section overflow - shorten section " + curSection);
    }
    page.drawText(text, { x, y, size, font: f, color: opts.color ?? BLACK });
    if (!meta.firstWords) meta.firstWords = text;
    y += LH + (opts.gap ?? 0);
  };

  const paragraph = (text) => {
    for (const ln of wrap(text, font, BODY, USABLE_W)) line(ln);
    y += 6;
  };

  const bullet = (text) => {
    const lines = wrap(text, font, BODY, USABLE_W - 14);
    line("- " + lines[0]);
    for (const ln of lines.slice(1)) line(ln, { x: M.left + 14 });
    y += 2;
  };

  const heading = (title) => {
    y += 4;
    line(title, { size: HEAD, f: bold });
    page.drawLine({
      start: { x: M.left, y: y - 6 },
      end: { x: M.left + USABLE_W, y: y - 6 },
      thickness: 0.7,
    });
    y += 8;
  };

  curSection = doc.title;
  newPage();
  const titleY = 330;
  page.drawText(doc.title, { x: center(doc.title, bold, 20), y: titleY, size: 20, font: bold });
  page.drawText(doc.subtitle, { x: center(doc.subtitle, font, 12), y: titleY - 30, size: 12 });
  page.drawText(doc.org, { x: center(doc.org, font, 10), y: titleY - 52, size: 10, color: GRAY });
  page.drawText("P3 synthetic corpus - fusion-proto-v1", {
    x: center("P3 synthetic corpus - fusion-proto-v1", font, 8),
    y: 120, size: 8, color: GRAY,
  });
  meta.firstWords = doc.title;
  meta.sectionTitles = [doc.title];

  for (const sec of doc.sections) {
    curSection = sec.title;
    newPage();
    heading(sec.title);
    if (sec.ps) for (const p of sec.ps) paragraph(p);
    if (sec.bullets) for (const b of sec.bullets) bullet(b);
  }

  if (meta && !meta.sectionTitles) {
    meta.sectionTitles = [...meta.set];
  }

  pdf.getPages().forEach((p, i) => {
    p.drawText(String(i + 1), { x: PAGE_W / 2 - 3, y: 28, size: 8.5, font, color: GRAY });
  });

  const bytes = await pdf.save();
  return { bytes, pagesMeta };
}

const center = (text, f, size) => (PAGE_W - f.widthOfTextAtSize(text, size)) / 2;

async function main() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(HERE, "../../../node_modules/pdf-lib/package.json"), "utf8")
  );
  const pdfLibVersion = pkg.version;

  const manifest = {
    version: 1,
    corpus: "fusion-proto-v1",
    generator: "generate-corpus.mjs",
    pdfLib: pdfLibVersion,
    deterministic: true,
    docs: [],
    totals: { docs: 0, pages: 0 },
    languageCounts: {},
  };

  for (const doc of DOCS) {
    const { bytes, pagesMeta } = await buildDoc(doc, pdfLibVersion);
    const nPages = pagesMeta.length;
    if (nPages !== 5) {
      throw new Error(doc.id + ": page count " + nPages + " != 5 (title + 4 sections)");
    }
    if (doc.sections.length !== 4) {
      throw new Error(doc.id + ": " + doc.sections.length + " sections != 4");
    }

    fs.writeFileSync(path.join(HERE, doc.file), bytes);
    fs.writeFileSync(
      path.join(HERE, doc.file.replace(/\.pdf$/, ".json")),
      JSON.stringify(
        {
          docId: doc.id,
          fileName: doc.file,
          language: doc.language,
          pages: pagesMeta.map((m, i) => ({
            pageIndex: i + 1,
            sectionTitles: m.sectionTitles,
            firstWords: m.firstWords,
          })),
        },
        null,
        2
      ) + "\n"
    );

    manifest.docs.push({
      docId: doc.id,
      fileName: doc.file,
      language: doc.language,
      pages: nPages,
      sectionCount: doc.sections.length,
    });
    manifest.totals.docs++;
    manifest.totals.pages += nPages;
    manifest.languageCounts[doc.language] = (manifest.languageCounts[doc.language] || 0) + 1;
  }

  const counts = { total: QUESTIONS.length, dev: 0, eval: 0 };
  const types = {};
  const pairCounts = {};
  const seenIds = new Set();
  for (const q of QUESTIONS) {
    if (seenIds.has(q.id)) throw new Error("duplicate question id " + q.id);
    seenIds.add(q.id);
    counts[q.subset]++;
    types[q.type] = (types[q.type] || 0) + 1;
    pairCounts[q.pair] = (pairCounts[q.pair] || 0) + 1;
  }
  fs.writeFileSync(
    path.join(HERE, "questions.json"),
    JSON.stringify({ version: 1, corpus: "fusion-proto-v1", counts, types, pairCounts, questions: QUESTIONS }, null, 2) + "\n"
  );

  const hashes = DOCS.map((d) => {
    const h = createHash("sha256").update(fs.readFileSync(path.join(HERE, d.file))).digest("hex");
    return h + "  " + d.file;
  });
  fs.writeFileSync(path.join(HERE, "checksums.sha256"), hashes.join("\n") + "\n");
  fs.writeFileSync(path.join(HERE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log("wrote " + manifest.totals.docs + " docs, " + manifest.totals.pages + " pages");
  console.log("languages: " + JSON.stringify(manifest.languageCounts));
  console.log("questions: " + counts.total + " (dev " + counts.dev + " / eval " + counts.eval + ")");
  console.log("types: " + JSON.stringify(types));
  console.log("pairs: " + JSON.stringify(pairCounts));
}

main().catch((err) => { console.error("generation failed:", err); process.exit(1); });
