/**
 * E1/E2 corpus generator — eval/corpus/version-pairs-v1
 *
 * 20 deterministic PDF version pairs for experiments E1 (anchor safety) and
 * E2 (change-review quality) of docs/specs/open-source-innovation-strategy.md
 * §10. This corpus has its OWN fixtures; the PI-2 reserved question set
 * (docs/specs/pageindex-integration-plan.md) is deliberately not reused.
 *
 * Categories (5 pairs each):
 *   material-change : a fact sentence is modified (value or station name) in
 *                     v2, same page -> the old quote disappears -> quote_missing
 *   moved           : fact sentence identical, but a page inserted before its
 *                     section reflows it onto the next page -> quote_moved
 *   deleted         : fact sentence absent in v2, layout otherwise identical
 *                     -> quote_missing
 *   format-only     : wording of every fact sentence identical; heading case,
 *                     whitespace and punctuation OUTSIDE the quoted sentences
 *                     differ -> must NOT trigger any proposal
 *
 * Every document: title page + 3 sections (4-8 pages total), 3 known fact
 * sentences (claims A/B/C) placed as the first sentence of their section's
 * first paragraph, so each claim's page is known by construction.
 *
 * Determinism rules (same style as document-trees-v1/generate-corpus.mjs):
 * - every string is a fixed literal built from fixed tables; no Date.now(),
 *   no Math.random()
 * - PDF metadata dates pinned to a fixed UTC instant (pdf-lib would otherwise
 *   stamp the wall clock into CreationDate/ModDate)
 * - explicit page break per section page; a post-build check asserts the built
 *   page count equals the planned page count
 *
 * Run:  node generate-version-pairs.mjs
 * Out:  <pair>.v1.pdf / <pair>.v1.json / <pair>.v2.pdf / <pair>.v2.json
 *       + manifest.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXED_DATE = new Date(Date.UTC(2026, 0, 15, 10, 0, 0));

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

/* ------------------------------------------------------------ pair specs */

// Section page counts per pair (title page adds +1). Explicit breaks; content
// per page is sized to never overflow, and the built page count is asserted.
const LAYOUTS = [
  [1, 1, 1], // 4 pages
  [2, 2, 1], // 6 pages
  [2, 1, 2], // 6 pages
  [1, 2, 2], // 6 pages
  [2, 2, 2], // 7 pages
];

const VALUES = ["42", "13.5", "128", "9.75", "203"];
const VALUES2 = { "42": "57", "13.5": "11.2", "128": "164", "9.75": "12.5", "203": "189" };
const NAMES = ["Elbingen", "Bärenbach", "Altmoor", "Steinach", "Kaltbrunn"];
const NAMES2 = ["Altmoor", "Steinach", "Kaltbrunn", "Elbingen", "Bärenbach"];
const COUNTS = ["14", "6", "31", "88", "12"];

const SPECS = [
  // 5x material-change: which slot of claim A is rewritten in v2
  { cat: "material-change", slot: "value", title: "River Gauge Annual Report", org: "Institut für Gewässermessung", subject: "the river gauge network" },
  { cat: "material-change", slot: "value", title: "Karst Spring Monitoring", org: "Quellkommission Jura", subject: "the karst spring programme" },
  { cat: "material-change", slot: "value", title: "Harbour Sediment Survey", org: "Hafenboden Konsortium", subject: "the harbour sediment survey" },
  { cat: "material-change", slot: "name", title: "Orchard Frost Report", org: "Obstbaukammer", subject: "the orchard frost network" },
  { cat: "material-change", slot: "name", title: "Fish Ladder Census", org: "Fischpass Kommission", subject: "the fish ladder census" },
  // 5x moved: wording identical, one page inserted before section 3
  { cat: "moved", title: "Peatland Carbon Audit", org: "Moorland Institut", subject: "the peatland carbon audit" },
  { cat: "moved", title: "Wind Farm Yield Review", org: "Böenrat Nordsee", subject: "the wind farm yield review" },
  { cat: "moved", title: "Tunnel Seepage Log", org: "Bergwasser Kommission", subject: "the tunnel seepage programme" },
  { cat: "moved", title: "Forest Damage Inventory", org: "Waldschadensstelle", subject: "the forest damage inventory" },
  { cat: "moved", title: "Canal Lock Registry", org: "Schleusenamt", subject: "the canal lock registry" },
  // 5x deleted: claim A sentence absent in v2
  { cat: "deleted", title: "Glacier Mass Balance", org: "Gletscherdienst", subject: "the glacier mass balance series" },
  { cat: "deleted", title: "Heating Systems Census", org: "Heizungsstatistik Amt", subject: "the heating systems census" },
  { cat: "deleted", title: "Tram Ridership Study", org: "Strassenbahnverband", subject: "the tram ridership study" },
  { cat: "deleted", title: "Alpine Hut Usage", org: "Bergfreunde Sektion", subject: "the alpine hut usage record" },
  { cat: "deleted", title: "Beekeeping Survey", org: "Imkerverband", subject: "the beekeeping survey" },
  // 5x format-only: quotes byte-identical, only formatting outside them differs
  { cat: "format-only", title: "Museum Visitor Count", org: "Museumsverband", subject: "the museum visitor count" },
  { cat: "format-only", title: "Lighthouse Staffing Log", org: "Leuchtturmbetrieb", subject: "the lighthouse staffing plan" },
  { cat: "format-only", title: "School Pool Usage", org: "Schulschwimmbad Träger", subject: "the school pool usage record" },
  { cat: "format-only", title: "Vineyard Climate Log", org: "Rebenklima Verein", subject: "the vineyard climate network" },
  { cat: "format-only", title: "Brown Coal Reserve Note", org: "Reviergeologie", subject: "the lignite reserve estimate" },
];

const FILLER = [
  "The methodology follows the standard protocol of the institute and was reviewed by two independent auditors.",
  "All figures in this section refer to the reporting period and use the calibrated reference instruments.",
  "Data gaps shorter than one week were interpolated with the approved procedure and marked in the appendix.",
  "Comparability with earlier editions is ensured by the unchanged station layout and the stable calibration chain.",
  "Follow-up measurements are scheduled for the next reporting period and will be appended to this series.",
  "Every raw value is archived with its instrument identifier so that the series can be reconstructed.",
];
const [F1, F2, F3, F4, F5, F6] = FILLER;

const ANNEX_INTRO = "This annex collects additional context that arrived after the first edition went to print.";
const DELETED_REPLACEMENT = "The main survey was completed according to the plan announced in the previous edition.";

/* ------------------------------------------------------- fact sentences */

const sentenceA = (p) => `The main survey documents a peak value of ${p.value} at the ${p.name} station in ${p.year}.`;
const sentenceB = (p) => `The review board confirmed that ${p.count} of the monitored sites met the quality threshold during ${p.year}.`;
const sentenceC = (p) => `Field teams verified ${p.count} reference points along ${p.name} before the final report was signed.`;

/* --------------------------------------------------------- v1/v2 bodies */

/** Sections of one version: heading + explicit page groups of paragraphs. */
function buildSections(p, version) {
  const isV2 = version === "v2";
  const fmt = p.cat === "format-only" && isV2;
  const h = (t) => (fmt ? t.toUpperCase() : t);

  const intro1 = `This report summarises the ${p.year} measurement programme for ${p.subject}.`;
  const intro2 = "The quality assessment compares all monitored sites against the agreed thresholds.";
  const intro3 = "Field verification completes the annual cycle and confirms the reported figures.";
  // format-only: punctuation outside any quoted sentence
  const intro1v = fmt ? intro1.replace(/\.$/, "!") : intro1;
  const intro2v = fmt ? intro2.replace(/\.$/, "!") : intro2;
  const intro3v = fmt ? intro3.replace(/\.$/, "!") : intro3;
  const f4v = fmt ? F4.replace("stable calibration", "stable  calibration") : F4;

  const aV1 = sentenceA(p);
  let aParaV2 = `${aV1} ${F6}`;
  if (isV2 && p.cat === "material-change") {
    const aV2 =
      p.slot === "value"
        ? aV1.replace(` ${p.value} `, ` ${p.value2} `)
        : aV1.replace(` ${p.name} `, ` ${p.name2} `);
    if (aV2 === aV1) throw new Error(`${p.pairId}: material change did not alter sentence A`);
    aParaV2 = `${aV2} ${F6}`;
  }
  if (isV2 && p.cat === "deleted") aParaV2 = `${DELETED_REPLACEMENT} ${F6}`;

  const groups = (layout, first, rest) => (layout === 2 ? [first, rest] : [first]);

  const sections = [
    {
      heading: h("Measurement Programme"),
      pageGroups: groups(p.layout[0], [intro1v, isV2 ? aParaV2 : `${aV1} ${F6}`, F1], [F2, F3]),
    },
    {
      heading: h("Quality Assessment"),
      pageGroups: groups(p.layout[1], [intro2v, `${sentenceB(p)} ${F5}`, f4v], [F5, F6]),
    },
  ];
  if (p.cat === "moved" && isV2) {
    sections.push({ heading: h("Inserted Annex"), pageGroups: [[ANNEX_INTRO, F1, F2]] });
  }
  sections.push({
    heading: h("Field Verification"),
    pageGroups: groups(p.layout[2], [intro3v, `${sentenceC(p)} ${F1}`], [F3, F2]),
  });
  return sections;
}

/* ---------------------------------------------------------------- render */

async function renderPdf({ title, org, sections, pdfLibVersion }) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  pdf.setTitle(title);
  pdf.setSubject(`${title} - version-pairs-v1`);
  pdf.setAuthor("version-pairs-v1 synthetic corpus");
  pdf.setProducer(`pdf-lib ${pdfLibVersion}`);
  pdf.setCreator("generate-version-pairs.mjs (deterministic)");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pagesText = [];
  let page = null;
  let y = 0;

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pagesText.push([]);
    y = M.top;
  };
  const wrap = (text, f, size, maxW) => {
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
  };
  const line = (text, { size = BODY, f = font } = {}) => {
    page.drawText(text, { x: M.left, y, size, font: f, color: BLACK });
    pagesText[pagesText.length - 1].push(text);
    y += LH;
  };
  const paragraph = (text) => {
    for (const ln of wrap(text, font, BODY, USABLE_W)) line(ln);
    y += 6;
  };
  const heading = (t) => {
    y += 4;
    line(t, { size: HEAD, f: bold });
    page.drawLine({
      start: { x: M.left, y: y - 6 },
      end: { x: M.left + USABLE_W, y: y - 6 },
      thickness: 0.7,
    });
    y += 8;
  };

  // title page
  newPage();
  const ty = 330;
  const center = (text, f, size) => (PAGE_W - f.widthOfTextAtSize(text, size)) / 2;
  page.drawText(title, { x: center(title, bold, 20), y: ty, size: 20, font: bold });
  page.drawText(org, { x: center(org, font, 12), y: ty - 30, size: 12, font });
  const tag = "version-pairs-v1 synthetic corpus";
  page.drawText(tag, { x: center(tag, font, 8), y: 120, size: 8, font, color: GRAY });
  pagesText[0].push(title, org, tag);

  for (const sec of sections) {
    sec.pageGroups.forEach((paras, gi) => {
      newPage();
      if (gi === 0) heading(sec.heading);
      for (const p of paras) paragraph(p);
    });
  }

  pdf.getPages().forEach((p, i) => {
    p.drawText(String(i + 1), { x: PAGE_W / 2 - 3, y: 28, size: 8.5, font, color: GRAY });
  });

  const bytes = await pdf.save();
  return { bytes, pages: pagesText.map((lines, i) => ({ page: i + 1, text: lines.join("\n") })) };
}

/* ------------------------------------------------------------------ main */

async function main() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(HERE, "../../../node_modules/pdf-lib/package.json"), "utf8")
  );
  const pdfLibVersion = pkg.version;

  const pairs = [];
  for (let i = 0; i < SPECS.length; i++) {
    const p = {
      ...SPECS[i],
      pairId: `vp${String(i + 1).padStart(2, "0")}-${SPECS[i].cat}`,
      layout: LAYOUTS[i % 5],
      year: String(2012 + (i % 12)),
      value: VALUES[i % 5],
      value2: VALUES2[VALUES[i % 5]],
      name: NAMES[i % 5],
      name2: NAMES2[i % 5],
      count: COUNTS[i % 5],
    };

    const v1 = await renderPdf({ title: p.title, org: p.org, sections: buildSections(p, "v1"), pdfLibVersion });
    const v2 = await renderPdf({ title: p.title, org: p.org, sections: buildSections(p, "v2"), pdfLibVersion });

    const expectV1 = 1 + p.layout[0] + p.layout[1] + p.layout[2];
    const expectV2 = expectV1 + (p.cat === "moved" ? 1 : 0);
    if (v1.pages.length !== expectV1) {
      throw new Error(`${p.pairId}: built ${v1.pages.length} v1 pages, planned ${expectV1} (layout overflow?)`);
    }
    if (v2.pages.length !== expectV2) {
      throw new Error(`${p.pairId}: built ${v2.pages.length} v2 pages, planned ${expectV2} (layout overflow?)`);
    }

    const A = sentenceA(p);
    const B = sentenceB(p);
    const C = sentenceC(p);
    // v1 pages: title page + section starts; the moved pair's claim C shifts
    // by +1 only in v2 (annex page inserted before section 3)
    const pageA = 2;
    const pageB = 2 + p.layout[0];
    const pageC = 2 + p.layout[0] + p.layout[1];
    const pageCv2 = pageC + (p.cat === "moved" ? 1 : 0);

    let expA = pageA;
    let expC = pageC;
    let cV2Page;
    if (p.cat === "material-change" || p.cat === "deleted") expA = "missing";
    if (p.cat === "moved") {
      expC = "moved";
      cV2Page = pageCv2;
    }

    const claims = [
      { quote: A, v1Page: pageA, section: "Measurement Programme", v2Expected: expA },
      { quote: B, v1Page: pageB, section: "Quality Assessment", v2Expected: pageB },
      { quote: C, v1Page: pageC, section: "Field Verification", v2Expected: expC, ...(cV2Page !== undefined && { v2Page: cV2Page }) },
    ];
    // NB: only the moved claim (C) carries v2Page - the page the quote lands
    // on after the reflow. The schema also allows null (claim not resolvable);
    // this corpus never needs it.

    const expectedProposals =
      p.cat === "moved"
        ? [{ quote: C, reason: "quote_moved" }]
        : p.cat === "material-change" || p.cat === "deleted"
          ? [{ quote: A, reason: "quote_missing" }]
          : [];

    const base = `${p.pairId}`;
    fs.writeFileSync(path.join(HERE, `${base}.v1.pdf`), v1.bytes);
    fs.writeFileSync(path.join(HERE, `${base}.v1.json`), JSON.stringify({ pairId: p.pairId, version: 1, pages: v1.pages }, null, 2) + "\n");
    fs.writeFileSync(path.join(HERE, `${base}.v2.pdf`), v2.bytes);
    fs.writeFileSync(path.join(HERE, `${base}.v2.json`), JSON.stringify({ pairId: p.pairId, version: 2, pages: v2.pages }, null, 2) + "\n");

    pairs.push({
      pairId: p.pairId,
      category: p.cat,
      topic: p.title,
      v1File: `${base}.v1.pdf`,
      v2File: `${base}.v2.pdf`,
      v1Pages: v1.pages.length,
      v2Pages: v2.pages.length,
      claims,
      expectedProposals,
    });
  }

  /* ------------------------------------------------ corpus-level checks */
  const byCat = {};
  for (const pair of pairs) byCat[pair.category] = (byCat[pair.category] || 0) + 1;
  for (const cat of ["material-change", "moved", "deleted", "format-only"]) {
    if ((byCat[cat] || 0) < 4) throw new Error(`category ${cat}: ${byCat[cat]} < 4 pairs`);
  }
  if (pairs.length !== 20) throw new Error(`expected 20 pairs, built ${pairs.length}`);
  const totalClaims = pairs.reduce((n, p) => n + p.claims.length, 0);
  const totalExpected = pairs.reduce((n, p) => n + p.expectedProposals.length, 0);
  if (totalExpected !== 15) throw new Error(`expected 15 proposals in total, planned ${totalExpected}`);
  for (const p of pairs) {
    if (p.v1Pages < 4 || p.v1Pages > 8 || p.v2Pages > 8) {
      throw new Error(`${p.pairId}: page count outside 4-8 (v1 ${p.v1Pages}, v2 ${p.v2Pages})`);
    }
  }

  const roundtripPairs = ["material-change", "moved", "deleted", "format-only"].map(
    (cat) => pairs.find((p) => p.category === cat).pairId
  );

  const manifest = {
    version: 1,
    corpus: "version-pairs-v1",
    generator: "generate-version-pairs.mjs",
    pdfLib: pdfLibVersion,
    deterministic: true,
    // same normalization as findQuotePage in src/lib/services/change-review.ts:
    // whitespace collapsed, case-insensitive, punctuation preserved
    normalization: "whitespace collapsed + lowercase (findQuotePage)",
    claimsSchema: "v2Expected: page number (still found there) | 'moved' (reflowed, see v2Page) | 'missing' (quote absent in v2); null reserved, unused",
    totals: { pairs: pairs.length, claims: totalClaims, expectedProposals: totalExpected },
    categoryCounts: byCat,
    roundtripPairs,
    pairs,
  };
  fs.writeFileSync(path.join(HERE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`wrote ${manifest.totals.pairs} pairs, ${manifest.totals.claims} claims, ${manifest.totals.expectedProposals} expected proposals`);
  console.log("categories:", JSON.stringify(byCat));
  for (const p of pairs) {
    console.log(
      `  ${p.pairId.padEnd(26)} ${p.category.padEnd(15)} v1=${p.v1Pages}p v2=${p.v2Pages}p expected=${p.expectedProposals.map((e) => e.reason).join("|") || "none"}`
    );
  }
}

main().catch((err) => {
  console.error("generation failed:", err);
  process.exit(1);
});
