/**
 * PI-0 corpus generator — eval/corpus/document-trees-v1
 *
 * Deterministic synthetic PDF corpus for the PageIndex evaluation
 * (docs/specs/pageindex-integration-plan.md, PI-0).
 *
 * Determinism rules:
 * - every string is a fixed literal (content-en/es/de.mjs); no Date.now(),
 *   no Math.random()
 * - PDF metadata dates are pinned to a fixed UTC instant (pdf-lib would
 *   otherwise stamp the wall clock into CreationDate/ModDate)
 * - fixed A4 page size, fixed margins, explicit page break per section
 *
 * Run:  node generate-corpus.mjs
 * Out:  <doc>.pdf + <doc>.json sidecar per document, manifest.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXED_DATE = new Date(Date.UTC(2026, 0, 15, 10, 0, 0));

import { EN } from "./content-en.mjs";
import { ES } from "./content-es.mjs";
import { DE } from "./content-de.mjs";
const DOCS = [...EN, ...ES, ...DE];

/* ---------------------------------------------------------------- layout */

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const M = { left: 56, right: 56, top: 64, bottom: 60 };
const USABLE_W = PAGE_W - M.left - M.right;
const BODY = 10.5;
const LH = 14.5;
const HEAD = 13;
const GRAY = rgb(0.3, 0.3, 0.3);
const BLACK = rgb(0, 0, 0);

const TOC_LABEL = { en: "Table of Contents", es: "Índice", de: "Inhaltsverzeichnis" };

/* ------------------------------------------------------------------ build */

async function buildDoc(doc, pdfLibVersion) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  pdf.setTitle(doc.title);
  pdf.setSubject(doc.subtitle);
  pdf.setAuthor("PI-0 synthetic corpus");
  pdf.setProducer(`pdf-lib ${pdfLibVersion}`);
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
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /** Draw one wrapped line of body text; captures firstWords of the page. */
  const line = (text, { x = M.left, size = BODY, f = font, color = BLACK, gap = 0 } = {}) => {
    if (y + LH > PAGE_H - M.bottom) newPage(); // continuation page inherits curSection
    page.drawText(text, { x, y, size, font: f, color });
    if (!meta.firstWords) meta.firstWords = text;
    y += LH + gap;
  };

  const paragraph = (text, indent = 0) => {
    for (const ln of wrap(text, font, BODY, USABLE_W - indent)) {
      line(ln, { x: M.left + indent });
    }
    y += 6;
  };

  const bullet = (text) => {
    const lines = wrap(text, font, BODY, USABLE_W - 14);
    line("- " + lines[0], { x: M.left });
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
  }

  const colXs = (widths) => {
    let acc = M.left;
    return widths.map((w) => {
      const x = acc;
      acc += w * USABLE_W;
      return x;
    });
  };

  const drawTableHeader = (tb, xs) => {
    tb.columns.forEach((c, i) => line(c, { x: xs[i], size: 9.5, f: bold, gap: 0 }));
    page.drawLine({
      start: { x: M.left, y: y - 4 },
      end: { x: M.left + USABLE_W, y: y - 4 },
      thickness: 0.5,
    });
    y += 3;
  };

  const tableRow = (r, xs) => {
    r.forEach((cell, i) => line(cell, { x: xs[i], gap: 0 }));
    y += 2;
  };

  /* ------------------------------------------------------- title page */
  curSection = doc.title;
  newPage();
  const titleY = 330;
  page.drawText(doc.title, { x: center(doc.title, bold, 20), y: titleY, size: 20, font: bold });
  page.drawText(doc.subtitle, { x: center(doc.subtitle, font, 12), y: titleY - 30, size: 12 });
  page.drawText(doc.org, { x: center(doc.org, font, 10), y: titleY - 52, size: 10, color: GRAY });
  page.drawText("PI-0 synthetic corpus - document-trees-v1", {
    x: center("PI-0 synthetic corpus - document-trees-v1", font, 8),
    y: 120,
    size: 8,
    color: GRAY,
  });
  meta.firstWords = doc.title;
  meta.sectionTitles = [doc.title];

  /* --------------------------------------------------------- sections */
  const sectionStartPage = [];
  for (const sec of doc.sections) {
    curSection = sec.title;
    newPage();
    sectionStartPage.push(pagesMeta.length); // 1-based
    heading(sec.title);
    if (sec.ps) for (const p of sec.ps) paragraph(p);
    if (sec.bullets) for (const b of sec.bullets) bullet(b);
    if (sec.table) {
      const tb = sec.table;
      line(tb.caption, { size: 9.5, f: bold, gap: 4 });
      const xs = colXs(tb.widths);
      drawTableHeader(tb, xs);
      const rows = tb.contRows ? tb.rows.slice(0, tb.splitAfter) : tb.rows;
      for (const r of rows) tableRow(r, xs);
      if (tb.contRows) {
        newPage(); // table deliberately continues on the next page
        line(tb.contCaption, { size: 9.5, f: bold, gap: 4 });
        drawTableHeader(tb, xs);
        for (const r of tb.contRows) tableRow(r, xs);
      }
    }
  }

  // finalize the last content page's metadata (newPage only finalizes on transition)
  if (meta && !meta.sectionTitles) {
    meta.sectionTitles = [...meta.set];
    if (!meta.firstWords) meta.firstWords = "(continuation)";
  }

  /* -------------------------------------------------------------- TOC */
  if (doc.toc) {
    const tocLabel = TOC_LABEL[doc.language];
    const tocPage = pdf.insertPage(1, [PAGE_W, PAGE_H]);
    pagesMeta.splice(1, 0, { set: [tocLabel], firstWords: tocLabel, sectionTitles: [tocLabel] });
    const prevPage = page;
    page = tocPage;
    meta = pagesMeta[1];
    let ty = M.top + 4;
    page.drawText(tocLabel, { x: M.left, y: ty, size: HEAD, font: bold });
    ty -= HEAD + 12;
    const numW = 40;
    for (let i = 0; i < doc.sections.length; i++) {
      const entry = `${i + 1}. ${doc.sections[i].title}`;
      page.drawText(entry, { x: M.left, y: ty, size: BODY, font });
      const pno = String(sectionStartPage[i] + 1); // +1: TOC page inserted before sections
      page.drawText(pno, {
        x: M.left + USABLE_W - numW + (numW - font.widthOfTextAtSize(pno, BODY)),
        y: ty,
        size: BODY,
        font,
      });
      ty -= 18;
    }
    page = prevPage;
  }

  /* ----------------------------------------------------------- footer */
  pdf.getPages().forEach((p, i) => {
    p.drawText(String(i + 1), { x: PAGE_W / 2 - 3, y: 28, size: 8.5, font, color: GRAY });
  });

  const bytes = await pdf.save();
  return { bytes, pagesMeta, sectionStartPage };
}

/* ---------------------------------------------------------------- helpers */

const center = (text, f, size) => (PAGE_W - f.widthOfTextAtSize(text, size)) / 2;

/* ------------------------------------------------------------------- main */

async function main() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(HERE, "../../../node_modules/pdf-lib/package.json"), "utf8")
  );
  const pdfLibVersion = pkg.version;

  const manifest = {
    version: 1,
    corpus: "document-trees-v1",
    generator: "generate-corpus.mjs",
    pdfLib: pdfLibVersion,
    deterministic: true,
    docs: [],
    totals: { docs: 0, pages: 0 },
    languageCounts: {},
  };

  const noToc = [];
  let tableSplit = 0;
  let misleading = 0;

  for (const doc of DOCS) {
    const { bytes, pagesMeta } = await buildDoc(doc, pdfLibVersion);
    const nPages = pagesMeta.length;
    if (nPages < 8 || nPages > 16) {
      throw new Error(`${doc.id}: page count ${nPages} outside required range 8-16`);
    }
    if (doc.sections.length < 3 || doc.sections.length > 7) {
      throw new Error(`${doc.id}: ${doc.sections.length} sections outside required range 3-7`);
    }
    if (!doc.toc) noToc.push(doc.id);
    if (doc.notes.includes("table-split")) tableSplit++;
    if (doc.notes.includes("misleading-headings")) misleading++;

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
          toc: doc.toc,
          pageLabels: pagesMeta.map((_, i) => String(i + 1)),
          notes: doc.notes,
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
      toc: doc.toc,
      sectionCount: doc.sections.length,
      notes: doc.notes,
    });
    manifest.totals.docs++;
    manifest.totals.pages += nPages;
    manifest.languageCounts[doc.language] = (manifest.languageCounts[doc.language] || 0) + 1;
  }

  // PI-0 special-case requirements
  if (DOCS.length < 20) throw new Error("fewer than 20 documents");
  if (noToc.length < 2) throw new Error("fewer than 2 documents without a table of contents");
  if (tableSplit < 1) throw new Error("no table split across two pages");
  if (misleading < 1) throw new Error("no document with misleading heading structure");

  fs.writeFileSync(path.join(HERE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`wrote ${manifest.totals.docs} docs, ${manifest.totals.pages} pages`);
  console.log("languages:", JSON.stringify(manifest.languageCounts));
  for (const d of manifest.docs) {
    console.log(`  ${d.docId.padEnd(30)} ${d.language}  ${d.pages}p  toc=${d.toc ? "y" : "n"}  [${d.notes.join(",")}]`);
  }
}

main().catch((err) => {
  console.error("generation failed:", err);
  process.exit(1);
});
