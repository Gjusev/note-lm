# T1 decision criteria — fixed BEFORE any measurement

Date fixed: 2026-09-29, before corpus generation, baseline run, or Docling run.
Governs: docs/specs/product-ux-design-research.md §B + §10 row T1 ("Mejora de
extracción y anclaje en clases definidas, con tiempo/RAM/tamaño de paquete
documentados; ninguna región inventada") and docs/specs/open-source-innovation-strategy.md
§7 ("el usuario no instala Python … Rechazar un adaptador si incumple el
instalador autónomo o presupuestos acordados") + §10 ("los errores de
extracción y las incompatibilidades cuentan como fallos del sistema; no
excluirlos del denominador").

## Corpus classes (eval/docling-proto/corpus/, synthetic-authored, 2–6 pages each)

| Class | Fixtures | Ground truth |
| --- | --- | --- |
| SC — single-column text | 2 | expected phrases per page, page numbers |
| TC — two-column layout | 2 | left/right column sentinels in reading order |
| TB — real tables (grid, numbers/units) | 2 | exact cell strings with (row, col, page), grid dims |
| SN — scan-like (image-only, needs OCR) | 1 | expected phrases (no text layer exists) |
| MX — mixed (text page + table page + image page) | 1 | phrases, cells, picture item present |

All fixtures generated deterministically with reportlab (invariant output) in
the pinned venv; determinism verified by generating twice and byte-comparing.

## Metrics (mechanical definitions)

- **Text fidelity** = fraction of a fixture's expected phrases found in the
  extracted text (whitespace-normalized, case-folded, per page), plus a
  char-level similarity (difflib ratio) between extracted text and the
  manifest's reference text for SC fixtures.
- **Reading order (TC)** = pass iff ALL left-column paragraph sentinels appear
  before ALL right-column sentinels in the exported reading-order text stream
  of the page. Baseline is recorded as-is (expected to interleave).
- **Table structure (TB, MX)** = for each expected cell, exact normalized
  string match somewhere in the extracted table grid + grid dims equal
  (rows, cols). Baseline has no table model by design: content presence is
  recorded as substring-in-text, structure = none. What pdf-parse loses is
  recorded, not hidden.
- **OCR (SN)** = same phrase-recall metric; expected strings live only in the
  raster, so anything < 1 is OCR error.
- **Anchor precision** = for every matched phrase/table, the extractor's
  claimed page must equal the manifest page; for Docling additionally every
  provenance bbox must lie inside its page rect. "Invented region" = bbox out
  of bounds, page_no outside the document, or content claimed at a page where
  the manifest says it is not. Tolerance: **0** (hard gate). pdf-parse anchors
  at page granularity only (charspan+page); recorded at that granularity.
- **Time** = wall-clock per doc (median across the 8 fixtures), cold (incl.
  model load) and warm reported separately.
- **Peak RAM** = process peak working set (Windows) of the whole run.
- **Distribution cost** = venv size on disk + model weights size on disk +
  startup cold/warm. External binary requirement (e.g. tesseract) counts as a
  violation, not a missing number.

## Thresholds (proposals from strategy §10, now FIXED)

| # | Gate | Pass condition |
| --- | --- | --- |
| C1 | Text fidelity | phrase recall ≥ 0.98 on every SC/MX text page AND no text-class regression vs baseline > 1 pp |
| C2 | Reading order | TC pass on both two-column fixtures |
| C3 | Tables | both TB fixtures: grid dims exact + cell recovery ≥ 0.90 each |
| C4 | OCR | phrase recall ≥ 0.90 on the scan fixture |
| C5 | Anchors | matched-quote→page precision 100%; invented regions = 0 |
| C6 | Time | median ≤ 60 s/doc (CPU, eval-only budget; product budgets come later per hardware profile) |
| C7 | RAM | peak working set ≤ 8 GB |
| C8 | Managed runtime | venv + weights ≤ 2 GB on disk; no user-side Python or binary install (OCR backend pip-only); cold start ≤ 120 s, warm ≤ 10 s/doc |

C5 and C8 are hard gates: a violation alone forces DEFER regardless of
quality. Every parse/compat failure is counted in the denominator.

## Decision rule (derived mechanically)

- **ADOPT** — C1..C8 all pass.
- **SCOPE TO DOC CLASSES** — C5, C7, C8 pass; quality gates (C2/C3/C4) pass on
  a strict subset of classes; C1 holds wherever Docling is used and no scoped
  class regresses vs baseline by > 1 pp. Scope = exactly the passing classes;
  criteria must be re-stated for the scoped classes before any integration.
- **DEFER** — C5 fails (any invented region), or C8 infeasible, or no class
  improves extraction over the baseline.

The decision and the criterion that drove it are stated in t1-report.md.
