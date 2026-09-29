/**
 * Onboarding sample generator (open-source-innovation-strategy §9):
 * two tiny deterministic German sample PDFs the desktop app ships as
 * resources (src-tauri/resources/samples/). Fictional coffee study —
 * authored here, redistribution-safe.
 *
 * Determinism rules (same as eval/corpus/document-trees-v1): fixed literal
 * strings, pinned PDF metadata dates, fixed A4 layout, standard fonts.
 * v2 differs from v1 in exactly two reviewable ways: one fact CHANGED
 * (14 -> 9 minutes) and one fact MOVED (participant count from section 1
 * to section 3) — the shape the change-review demo needs once a
 * re-import-as-new-version path exists (file imports create a new source
 * today; the v2 file ships ready for that).
 *
 * Run:  node scripts/generate-samples.mjs   (from the repo root)
 * Out:  src-tauri/resources/samples/kaffee-studie-v1.pdf / -v2.pdf
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(REPO, "src-tauri", "resources", "samples");
const FIXED_DATE = new Date(Date.UTC(2026, 0, 15, 10, 0, 0));

const TITLE = "Kaffeestudie 2026";
const SUBTITLE = "Filterkaffee, Konzentration und Tagesform";
const ORG = "Institut für Alltagsforschung (frei erfundenes Beispiel)";
const DISCLAIMER =
  "Dieses Dokument ist ein frei erfundenes Beispieldokument für das note-lm Onboarding. Alle Angaben sind synthetisch.";

/** The moved fact appears in v1 section 1, in v2 section 3. */
const FACT_PARTICIPANTS =
  "An der Studie nahmen 240 freiwillige Teilnehmende im Alter zwischen 20 und 45 Jahren teil.";

/** The changed fact: 14 minutes in v1, 9 minutes in v2. */
const resultParagraph = (minutes) =>
  `Filterkaffee verlängerte die durchschnittliche Konzentrationsdauer um ${minutes} Minuten. ` +
  "Die Teilnehmenden bearbeiteten an acht Messtagen jeweils dieselbe Aufgabenreihe; " +
  "gemessen wurde die Zeit bis zum ersten deutlichen Leistungsabfall.";

const DOCS = [
  {
    file: "kaffee-studie-v1.pdf",
    minutes: 14,
    s1: [
      "Die Kaffeestudie 2026 untersuchte, ob regelmäßiger Filterkaffee die Konzentration im Tagesverlauf beeinflusst.",
      FACT_PARTICIPANTS,
      "Die Erhebung dauerte acht Wochen. Die Teilnehmenden wurden zufällig in zwei Gruppen eingeteilt: eine Gruppe trank täglich Filterkaffee, die Vergleichsgruppe Kräutertee.",
    ],
    s2: [
      resultParagraph(14),
      "Die empfohlene Tagesmenge lag in der Studie bei drei Tassen, verteilt über den Vormittag.",
    ],
    s3: [
      "Die Autoren schlussfolgern, dass Filterkaffee in dieser Studie mit einer längeren Konzentrationsdauer verbunden war.",
      "Die Ergebnisse gelten nur für die untersuchte fiktive Stichprobe und erheben keinen Anspruch auf Verallgemeinerung.",
    ],
  },
  {
    file: "kaffee-studie-v2.pdf",
    minutes: 9,
    s1: [
      "Die Kaffeestudie 2026 untersuchte, ob regelmäßiger Filterkaffee die Konzentration im Tagesverlauf beeinflusst.",
      "Die Erhebung dauerte acht Wochen. Die Teilnehmenden wurden zufällig in zwei Gruppen eingeteilt: eine Gruppe trank täglich Filterkaffee, die Vergleichsgruppe Kräutertee.",
    ],
    s2: [
      resultParagraph(9),
      "Die empfohlene Tagesmenge lag in der Studie bei drei Tassen, verteilt über den Vormittag.",
    ],
    s3: [
      "Die Autoren schlussfolgern, dass Filterkaffee in dieser Studie mit einer längeren Konzentrationsdauer verbunden war.",
      FACT_PARTICIPANTS,
      "Die Ergebnisse gelten nur für die untersuchte fiktive Stichprobe und erheben keinen Anspruch auf Verallgemeinerung.",
    ],
  },
];

/* ------------------------------------------------------------------ layout */

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const M = { left: 56, top: 72, bottom: 60 };
const USABLE_W = PAGE_W - 2 * M.left;
const BODY = 10.5;
const LH = 15;

function wrap(text, font, size, maxWidth) {
  const lines = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    const cand = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(cand, size) <= maxWidth) cur = cand;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

async function buildDoc(doc) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  pdf.setTitle(`${TITLE} (${doc.file})`);
  pdf.setAuthor(ORG);
  pdf.setProducer("pdf-lib (generate-samples.mjs, deterministic)");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // page 1: title page
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = 330;
  page.drawText(TITLE, { x: (PAGE_W - bold.widthOfTextAtSize(TITLE, 20)) / 2, y, size: 20, font: bold });
  y -= 28;
  page.drawText(SUBTITLE, { x: (PAGE_W - font.widthOfTextAtSize(SUBTITLE, 12)) / 2, y, size: 12, font });
  y -= 22;
  page.drawText(ORG, { x: (PAGE_W - font.widthOfTextAtSize(ORG, 10)) / 2, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
  y = 120;
  for (const ln of wrap(DISCLAIMER, font, 8.5, USABLE_W)) {
    page.drawText(ln, { x: M.left, y, size: 8.5, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 11;
  }

  // pages 2-4: one section per page
  const SECTION_TITLES = ["Hintergrund und Zielsetzung", "Ergebnisse", "Schlussfolgerungen"];
  const paragraphsPerSection = [doc.s1, doc.s2, doc.s3];
  for (let s = 0; s < 3; s++) {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = M.top;
    page.drawText(`${s + 1}. ${SECTION_TITLES[s]}`, { x: M.left, y, size: 13, font: bold });
    page.drawLine({
      start: { x: M.left, y: y - 6 },
      end: { x: M.left + USABLE_W, y: y - 6 },
      thickness: 0.7,
    });
    y -= LH + 6;
    for (const p of paragraphsPerSection[s]) {
      for (const ln of wrap(p, font, BODY, USABLE_W)) {
        page.drawText(ln, { x: M.left, y, size: BODY, font });
        y -= LH;
      }
      y -= 6;
    }
    page.drawText(String(s + 2), { x: PAGE_W / 2 - 3, y: 28, size: 8.5, font, color: rgb(0.3, 0.3, 0.3) });
  }

  return pdf.save();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const doc of DOCS) {
    const bytes = await buildDoc(doc);
    const out = path.join(OUT_DIR, doc.file);
    fs.writeFileSync(out, bytes);
    console.log(`wrote ${out} (${bytes.length} bytes)`);
  }
}

main().catch((err) => {
  console.error("generation failed:", err);
  process.exit(1);
});
