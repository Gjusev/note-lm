# T5 decision criteria — fixed BEFORE any measurement

Date fixed: 2026-09-29, before corpus extension, audit runs, curated-layout
measurement, or grading. This is a NEW experiment following up T1
(`eval/docling-proto/t1-report.md`, verdict DEFER at 2136.4 MB vs 2048 MB
budget); the original T1 result/report is not modified.

Governs: the T5 mandate (fifth delivery, priority 5) — "evaluate a CURATED
distribution that could fit the ORIGINAL 2048MB budget (the 88.4MB miss) -
with an audit BEFORE removing anything".

## Budget

- The budget stays the **original 2048 MB** (2 GiB = 2147.5 MB; T1 compared
  2136.4 MB against 2048 MB — same convention here: the number 2048 is the
  cap). No budget change is proposed by this experiment. Any future change
  would need its own written justification (not part of T5).
- "Curated total" = installed venv footprint + curated on-disk models
  footprint, measured the same way T1 measured `distribution_cost.json`
  (directory sizes on disk, MB = MiB). Reported SEPARATELY as: download size
  (zip AND 7z if available, of the curated set), installed venv size, models
  size, cache size, RAM peak.

## Experiment plan (order fixed)

1. Corpus extension (deterministic generation + genuinely external docs).
2. File-access AUDIT of the pinned venv + models while converting per doc
   class (text-only / scan-OCR / table). Nothing is removed before the audit
   proves it unused on every audited class.
3. Curated layout built ONLY from audit-proven-read files.
4. Re-measure quality + time + RAM on the curated set (same docling version,
   same pipeline options as T1 — comparability).
5. Region-correspondence grading with saved overlay artifacts.

## Corpus (extended)

- **T1 corpus** (8 synthetic docs, unchanged) — reused read-only for the
  audit, per mandate.
- **Rotated variants** generated deterministically from the T1 corpus via
  pypdf `/Rotate` (90°, 180°, 270° on selected docs) — redistributable
  (T1 fixtures are ours). Generation determinism: generate twice, byte-compare.
- **Hybrid scans**: image-only rotated pages built by rasterizing a T1 text
  fixture (pypdfium2 → PIL rotate → img2pdf), deterministic. These are
  synthetic scans, NOT real scans — graded as a rotation/OCR stress class and
  labeled as such; they never substitute for the real-doc gates below.
- **Real external docs** (downloaded, sha256 recorded):
  - ≥ 1 arXiv paper with real tables (arXiv non-exclusive distribution
    license — redistributable; license review for shipping remains a separate
    adoption step per strategy §3, unchanged from T1).
  - ≥ 1 scanned public-domain book excerpt from a stable URL (Wikimedia
    Commons / Internet Archive; PD).
  - Page subsets extracted deterministically via pypdf to keep the corpus
    small. If downloads fail: document it and proceed with the
    synthetic+rotated set (real-doc gates then report NOT-MEASURED and cannot
    pass).

## Metrics (mechanical definitions)

- **Audit**: per doc class, the set of files under the venv `site-packages`
  and under the models dir that are OPENED during conversion (audit hook on
  `open` events, resolved to real paths, plus file sizes). "Bytes actually
  read" = sum of sizes of opened files (upper bound of read bytes; opening a
  file does not imply reading every byte — stated as an upper bound).
  "Bytes shipped" = total on-disk size of the audited subtree.
  A file may only be REMOVED from the curated set if it was never opened in
  ANY audited class run (text-only, scan-OCR, table) AND belongs to a known
  duplicate/variant group (e.g. torch-vs-onnx layout variant, fast-vs-accurate
  tableformer, .pth-vs-.onnx OCR twins).
- **Curated sizes**: zip + 7z (if 7z available) compressed size of the curated
  models dir = "download size"; on-disk dir sizes = installed/models sizes.
- **RAM peak**: process peak working set (Windows, same ctypes probe as T1),
  whole-run, curated artifacts, fresh process.
- **Wall time**: per doc, fresh process, same corpus, docling 2.131.0.
- **Text fidelity**: phrase recall per page (whitespace-normalized,
  case-folded), same as T1 C1.
- **Table cells**: exact normalized cell-string match in the extracted grid +
  grid dims exact, same as T1 C3. On real tables the expected cells are
  hand-transcribed from the rendered page into the manifest before running
  the extractor (transcription recorded in the manifest; a limitation, stated
  in the report).
- **OCR**: phrase recall on scan pages (expected strings exist only in the
  raster). For the real book scan, hand-transcribed phrases from the page
  image.
- **Region correspondence (IoU)**: for every text-layer-comparable block
  (expected phrase with a locatable text-layer span on the page):
  - Ground-truth box = bounding box of the phrase's text-layer chars, in PDF
    points, bottom-left origin, obtained from pypdfium2 text page char boxes.
  - Docling box = the prov bbox of the matching item, same coordinate space.
  - A match pairs the docling item whose text contains the expected phrase;
    if several match, the one with maximal IoU (best case for docling).
  - IoU = intersection area / union area of the two boxes. Median over all
    comparable blocks per doc class.
  - Overlay artifacts: page rendered via pypdfium2, docling bboxes drawn in
    red, ground-truth text-layer boxes drawn in green, saved as PNG per page
    (visual evidence, not the metric itself).
- **Rotation handling**: on `/Rotate` variants, text/table content must still
  be recovered (same recall metrics applied to the rotated file); recorded
  per rotation angle. Reported as its own line, NOT folded into the main
  quality gates (synthetic rotation is a stress test, not a real-scan gate).

## Gates (fixed now)

| # | Gate | Pass condition |
| --- | --- | --- |
| G1 budget | curated installed venv + curated models ≤ 2048 MB (T1 convention) | measured |
| G2 no-download cold cache | curated run with every cache env var pointed at fresh empty dirs produces results and the fresh dirs stay empty (no silent downloads) | must hold for adopt |
| G3 region IoU | median IoU ≥ 0.5 over text-layer-comparable blocks (per audited text-bearing class; real docs included where a text layer exists) | must hold for adopt |
| G4 real tables | ≥ 90% cell recall on the real external tables (arXiv) | must hold for adopt |
| G5 real OCR | phrase recall ≥ 0.90 on the real scanned book excerpt | must hold for adopt |
| G6 OCR pip-only | OCR backend remains RapidOCR (onnxruntime), no system binary | must hold (carried from T1 C8) |
| G7 column failure visibility | the T1 reading-order failure on two-column fixtures is re-measured and reported as-is on the extended corpus (including the real two-column arXiv paper); whatever the result, it is stated, not hidden; no adopt may claim column-order competence that was not measured | must hold for adopt |
| G8 comparability | same docling version + pipeline options as T1; RAM/wall re-measured on curated set, not extrapolated | must hold for adopt |

C2-class quality (reading order) is NOT a pass gate here: T5 evaluates a
scoped distribution (OCR + tables), reading order failure is documented
(G7), and scoping language in any adoption must carry that limitation.

## Decision rule (mechanical)

- **ADOPT-SCOPED (OCR + tables)** iff G1..G8 all pass.
- **STILL-DEFER** if any of G1..G8 fails; the report names the driving gate.
- Budget stays 2048 MB regardless; if G1 misses, the miss is reported, not
  negotiated.
