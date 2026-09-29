# T5 report — Docling scoped-distribution experiment (curated layout under the original 2048 MB budget)

Date: 2026-09-29. New experiment under `eval/docling-proto-v2/`; the T1
result/report (`eval/docling-proto/t1-report.md`, verdict DEFER at
2136.4 MB) is untouched. Criteria were fixed in
[t5-criteria.md](t5-criteria.md) BEFORE any measurement; nothing was removed
from the distribution before the audit proved it unused.

## Verdict

**STILL-DEFER** — but the blocker moved. The original budget miss
(T1 C8: 2136.4 > 2048 MB) is **solved** by the audit-proven curated set
(G1 passes with 244.4 MiB margin under T1's own size convention). What fails
now are two pre-registered quality gates:

- **G3 region IoU** (median ≥ 0.5): measured **0.0495** (T1-synth) /
  **0.1262** (real) / **0.0481** (rotated) — a *granularity artifact* of the
  pre-registered metric, not mislocalization: docling anchors at
  paragraph/band level, the metric compares a phrase-level ground-truth box
  against an item-level box. Containment of the expected text inside the
  matched item is **1.0 / 1.0 / 0.9949 median** (min 0.983 / 0.949 / 0.0) and
  a granularity-matched block-level IoU (supplementary metric B) reaches
  **0.944 / 0.863 / 0.45**. The gate as written fails; the evidence says the
  regions are where the text is.
- **G4 real-table cell recall** (≥ 0.90): pooled exact-match over the four
  real external tables = **0.6485** (substring diagnostic: 0.9576). Content
  survives; structure degrades on real tables (grid dims off on all four,
  nested-header cells merged, citation-bearing cells split). This is a
  genuine fidelity gap, not a metric artifact.

Per the pre-registered decision rule (any G-gate failure → STILL-DEFER), the
outcome is mechanical. Budget stays 2048 MB; no change proposed.

## 1. Audit (before removing anything)

Method (mandate-specified, dual probe): `sys.addaudithook` on `open` events
(Python-level opens) **unioned** with an NTFS last-access-time delta scan
(before/after stat of every file under the venv and the models dir) — the
atime probe catches C++-level opens (torch safetensors mmap, onnxruntime DLL/
weight loads) that audit hooks cannot see. A sentinel self-check verified
atime updates on this machine before every run; zero `socket.connect` events
in all runs. "Bytes read" = sum of sizes of opened files (upper bound of
actual read bytes). One representative doc per class, fresh process each:
text (`sc-hafen-logbuch`), OCR (`sn-versandliste`), table (`tb-messreihe`),
real scan (`real-bookscan`).

| Subtree | Files read / shipped | Bytes read / shipped | Read % |
| --- | --- | --- | --- |
| venv (site-packages + Scripts) | 6,278 / 34,091 | **679.7 / 1196.9 MiB** | 56.8% |
| models (`docling_models/`) | 8 / 54 | **396.9 / 729.8 MiB** | 54.4% |

The four class runs opened **identical file sets** (docling 2.131 initializes
layout + tableformer + all three RapidOCR onnx models eagerly, regardless of
doc content) — so the union equals each single run. Full lists:
`results/audit_{text,ocr,table,realscan}.json`.

The 8 model files actually read: heron **torch** `model.safetensors` (171.7
MB) + `config.json` + `preprocessor_config.json`; tableformer **accurate**
`safetensors` (212.8 MB) + `tm_config.json`; RapidOCR `PP-OCRv6_det_small.onnx`
(9.9 MB), `PP-OCRv6_rec_small.onnx` (21.2 MB), `ch_ppocr_mobile_v2.0_cls_mobile.onnx`
(0.6 MB).

**Headline contradiction of T1's assumption**: the runtime loads the **torch**
layout variant, not the onnx one (T1 report assumed onnx was "the variant the
runtime loads"). The droppable duplicate is therefore the onnx dir (163.3
MiB) — dropping the torch one would have broken the pipeline. This is exactly
why the audit was mandated before removal.

Venv per-package (read/shipped, MiB): torch 341.0/474.4, cv2 82.3/112.4,
scipy 41.4/88.6, transformers 37.0/51.5, pandas 19.8/40.2, onnxruntime
18.4/40.0, docling_parse 15.7/35.8, sympy 12.0/37.4 … Only 29.8 MiB of
site-packages belongs to entirely-never-read packages (win32/pywin32,
pikepdf.libs, dist-infos); the venv fat is *partially-read* packages (test
suites, unselected backends). Venv trimming was **not** attempted: the
mandate's curated actions are the model-set ones, and removing venv content
risks breaking conditional imports (audit proves *this corpus* never read
them, not that no PDF path would).

## 2. Curated layout

Built by `scripts/build_curated.py` — copies ONLY audit-proven files (plus
`ppocrv6_dict.txt`, 0.6 MB conservative insurance, not audit-read), keeping
the standard docling artifacts directory structure. Dropped, with rationale:

| Dropped | Size | Why safe |
| --- | --- | --- |
| `docling-project--docling-layout-heron-onnx/` | 163.3 MiB | never opened in any audited class; runtime loads torch heron (audit-proven) |
| `tableformer/fast/` | 138.7 MiB | never opened; pipeline uses ACCURATE (default) |
| RapidOCR `.pth` twins (det+rec) | 30.1 MiB | never opened; runtime is onnxruntime |
| `.cache/huggingface` trees, README, sample png | ~0.1 MiB | download-time artifacts; G2 proves they are not needed at inference |

Sizes (mandate: separate download/install/models/cache/RAM):

| Item | MiB |
| --- | --- |
| curated models, on disk (logical = du here) | **397.0** |
| curated models, zip −9 ("download") | 366.3 |
| curated models, 7z −mx=9 | 357.8 |
| venv on disk, du today | 1272.4 |
| venv on disk, logical bytes today | 1196.9 |
| venv as recorded by T1 | 1406.6 |
| **G1 total, T1 convention (1406.6 + 397.0)** | **1803.6 ≤ 2048 (margin 244.4)** |
| G1 total, today's du (1272.4 + 397.0) | 1669.4 (margin 378.6) |
| peak RAM, whole curated run (17 docs, incl. 300-dpi scans) | 2433.1 MB |
| peak RAM at end of the T1-8 prefix (comparable point) | 1668.9 MB (T1: 1770.8) |
| wall, median 17 docs / T1-8 subset | 3.66 s / 2.80 s (T1 median: 3.15 s) |
| cold start (first doc, fresh process) | 5.66 s (T1: 5.99 s) |

The venv measured smaller today than T1 recorded (1272.4 vs 1406.6 du) —
disk state changed between the two experiments; both conventions pass G1, and
the T1-convention total is the one gated. Same docling 2.131.0 + identical
pipeline options as T1 (comparability, G8).

## 3. Managed-component feasibility + no-download cold cache (G2)

Test as pre-registered: `HF_HOME`, `HF_HUB_CACHE`, `TRANSFORMERS_CACHE`,
`TORCH_HOME`, `XDG_CACHE_HOME` pointed at **fresh empty dirs**,
`HF_HUB_OFFLINE=1`, `DOCLING_ARTIFACTS_PATH` = the curated dir; an audit hook
recorded `socket.connect`. Result: all 17 docs converted, **0 new/changed
files in the fresh dirs, 0 socket events** (`results/curated_run.json` →
`fresh_cache_test`). Honest method limit: the network was not physically
blocked in-sandbox; offline env + socket audit + empty-dir assertion is the
proxy (as the mandate anticipated).

Design note for a Tauri-managed optional component (no new framework, per
mandate): ship the curated set (7z 357.8 MiB + a packaged runtime for the
existing venv) as a download-on-demand component into the app `dataDir`,
exactly like the existing whisper runtimes: version-pinned manifest
(docling 2.131.0 + `requirements.lock.txt` + per-file sha256 of the curated
set), fetched/verified by the installer, extracted to
`dataDir/components/docling/{runtime,models}`, spawned as a sidecar process
(stdin/stdout JSON or localhost HTTP) with every cache env var pointed at
component-local dirs (proven offline-safe by G2). What this eval proves:
the 397 MiB curated set is *complete* for the pinned pipeline, offline, with
pip-only OCR. What remains unproven and stays out of scope: packaging the
runtime itself into the installer (PI-2-style lifecycle gate), code-signing /
AV first-scan cold start on end-user machines, and the shipping-license
review of redistributed weights (strategy §3, unchanged from T1).

## 4. Corpus extension (deterministic + real)

- **Rotated** (pypdf `/Rotate`, deterministic, two-run byte-identical):
  `rot-sc-hafen-logbuch-180`, `rot-tc-wochenbericht-270`,
  `rot-tb-messreihe-90`.
- **Hybrid scans** (rasterize → rotate bitmap 90° → image-only PDF;
  deterministic): `rscan-sc-observatorium-90`, `rscan-tb-lieferschwelle-90`.
  Synthetic scans — labeled as such, never used for the real-doc gates.
- **Real external** (page subsets, sha256 + license recorded in
  `corpus/real_sources.json`): `real-attn-arxiv.pdf` (arXiv 1706.03762 pp.
  6,8 — two-column + Tables 1/2; arXiv non-exclusive distribution license),
  `real-docling-tr.pdf` (arXiv 2408.09869 pp. 5,8 — nested-header Table 1 +
  DocLayNet mAP Table 2; same license basis), `real-bookscan.pdf` (Wikimedia
  Commons scan of *The old yellow book*, Carnegie Institution 1911, public
  domain; pp. 21,130) and `real-bookscan-notext.pdf` (same raster rebuilt
  image-only at 300 dpi — see finding below). Re-derivation from the cached
  sources is byte-identical; ground truth was transcribed into the manifests
  **before** the extractor ran.

## 5. Grades on the curated set

Text fidelity (phrase recall): all T1 synth classes 1.00 (mx 0.75, the known
chart-label OCR gap — identical to T1), real-attn 1.00, real-docling-tr
1.00. OCR: T1 scan fixture 1.00; **real scan (text-stripped) 0.9091** (G5 ≥
0.90 PASS). Rotation: `/Rotate` 180 and 270 text recall 1.00 (text layer
recovered correctly); `/Rotate` 90 on the table doc: text survives but the
table grid is **transposed and scrambled** (5×8 vs 8×5, merged cells; cell
recall 0.85, row-sequence phrases 0.00). True 90°-rotated *bitmaps* (rscan
class): **RapidOCR returns empty → recall 0.00, table 0.00** — a visible,
documented failure mode (no orientation handling in this config).

Real tables (G4, exact normalized cells / dims found vs expected):

| Table | Recall (exact) | Recall (substring) | Dims |
| --- | --- | --- | --- |
| attn Table 1 (complexity) | **1.000** | 1.000 | 5×4 vs 4×4 (extra hdr row) |
| attn Table 2 (BLEU) | 0.8049 | 1.000 | 12×5 vs 10×5 |
| dtr Table 1 (runtime, nested hdr) | 0.1429 | 0.9286 | 4×8 vs 2×8 |
| dtr Table 2 (DocLayNet mAP) | 0.6579 | 0.9342 | 13×5 vs 13×6 |
| **pooled** | **0.6485** | **0.9576** | 0/4 exact |

Exact-metric misses on attn Table 2 are model names extracted with their
citations ("ByteNet [18]" vs expected "ByteNet") — extraction is right, the
exact-match rule is strict; DTR misses are real structural merges. Either way
the pre-registered exact gate fails.

Region correspondence (details in `results/region_iou.json`, overlays in
`overlays/` — 23 PNGs, red = docling bbox, green = text-layer GT):

| Group | A: phrase-level IoU (pre-registered gate) | containment | B: block-level IoU (suppl.) |
| --- | --- | --- | --- |
| T1 synth (n=81) | 0.0495 | **1.0** | 0.9442 |
| real (n=12) | 0.1262 | **1.0** | 0.8625 |
| rotated (n=33) | 0.0481 | 0.9949 | 0.45 |

Visual verification of the overlays (real-attn p1, rot-tc-270): docling boxes
sit on real content, GT boxes inside docling boxes, no invented regions; on
270° the registration is correct with tighter boxes.

**Embedded-text-layer finding (G5-adjacent)**: the Commons scan ships an
Internet-Archive OCR text layer. With it present, docling returned **one
empty PictureItem for the English page** (recall 0.00) — the layout model
labeled the page "picture" and the good embedded text layer was dropped, no
OCR run. The same raster with the layer stripped OCRs at 0.9091. Adoption
implication (for the next round, not acted on here): scans with embedded OCR
layers need `force_full_page_ocr` or layer-stripping at ingest.

Reading order (G7, visible not hidden): TC fixtures still fail the
all-left-before-all-right rule (as T1); **the real two-column arXiv paper
fails it too** — T1's C2 failure reproduces on a real paper, so it was not
only a fixture artifact. Recorded as-is; no adoption claim may cite column
competence.

## 6. Gates

| # | Gate | Result |
| --- | --- | --- |
| G1 | curated venv+models ≤ 2048 MB | **PASS** (1803.6, margin 244.4; today's-du reading 1669.4) |
| G2 | fresh-cache no-download | **PASS** (0 files, 0 sockets, results produced) |
| G3 | median IoU ≥ 0.5 | **FAIL** (0.0495/0.1262/0.0481; containment 1.0, block-IoU 0.86–0.94) |
| G4 | ≥ 0.90 cell recall, real tables | **FAIL** (0.6485 pooled exact; 0.9576 substring) |
| G5 | ≥ 0.90 OCR on real scan | **PASS** (0.9091) |
| G6 | OCR pip-only | **PASS** (RapidOCR/onnxruntime; no system binary, 0 sockets) |
| G7 | column failure visible | **PASS** (documented, incl. real-paper reproduction) |
| G8 | comparability (same version/options, re-measured) | **PASS** |

Decision per the pre-registered rule: **STILL-DEFER**, drivers G3 and G4.
The budget is no longer the driver. If a future round re-registers G3 at
block granularity (the honest reading of the mandate's "IoU against
text-layer spans"), today's numbers suggest it would pass on unrotated
classes (0.86–0.94) and fail on rotated ones (0.45) — that is a decision for
a new criteria file, not a post-hoc edit of this one.

## 7. Limitations

- G3's threshold assumed phrase-level and item-level boxes were comparable
  granularities; they are not (docling anchors at paragraph/band level). The
  gate failed on that mismatch; containment and block-IoU are reported as the
  diagnostic truth.
- Synthetic rotations (`/Rotate`, rasterized 90°) are not real scans; the
  only real scan is one 1911 book (2 pages). OCR n is small; the book page 2
  (archaic Italian) is ungraded — transcription tooling timed out twice.
- Table ground truth was hand-transcribed (from the text layer for arXiv,
  from the rendered image for the scan) before extraction; transcription
  errors would propagate to both exact and substring metrics.
- "Bytes read" is an upper bound (file-opened ≠ fully read); atime can lag
  (NTFS updates verified working via sentinel before each audit run; AV
  background scans could in principle inflate the read set — the audit-hook ∩
  atime consistency and the 4-run identical sets argue against noise).
- venv size drift vs T1's recorded number (1272.4 vs 1406.6 du) is reported,
  not explained; both pass G1.
- Single machine, CPU-only, one docling version; no license review of
  redistributed weights; no end-user installer test.

## 8. Reproduction

```
# 1. corpus (T1 venv reused, read-only)
eval/docling-proto/.venv/Scripts/python.exe eval/docling-proto-v2/scripts/gen_corpus_ext.py  <dir>   # twice -> byte-compare
eval/docling-proto/.venv/Scripts/python.exe eval/docling-proto-v2/scripts/fetch_real_docs.py <dir>   # downloads + subsets + previews
# 2. audit (per class)
eval/docling-proto/.venv/Scripts/python.exe eval/docling-proto-v2/scripts/audit_run.py text sc-hafen-logbuch.pdf
#    ... ocr sn-versandliste.pdf / table tb-messreihe.pdf / realscan real-bookscan.pdf
# 3. curated layout + sizes
eval/docling-proto/.venv/Scripts/python.exe eval/docling-proto-v2/scripts/build_curated.py
# 4. full run (17 docs, curated artifacts, fresh-cache G2 test, RAM/wall)
eval/docling-proto/.venv/Scripts/python.exe eval/docling-proto-v2/scripts/curated_run.py
# 5. grades
eval/docling-proto/.venv/Scripts/python.exe eval/docling-proto-v2/scripts/grade_regions.py    # IoU + overlays
eval/docling-proto/.venv/Scripts/python.exe eval/docling-proto-v2/scripts/grade_quality.py    # recall/tables/OCR/columns
```

Determinism evidence: `results/gen_check/` (rot/rscan byte-identical),
`corpus/real_sources.json` (source + derived sha256; re-derivation
byte-identical), audit file sets identical across the four class runs.

## 9. Files (exhaustive)

- `t5-criteria.md` (pre-registered gates), `t5-report.md` (this file)
- `scripts/`: `gen_corpus_ext.py`, `fetch_real_docs.py`, `audit_run.py`,
  `build_curated.py`, `curated_run.py`, `grade_regions.py`, `grade_quality.py`
- `corpus/`: `manifest_ext_synth.json`, `manifest_ext_real.json`,
  `real_sources.json`, `rot-sc-hafen-logbuch-180.pdf`,
  `rot-tc-wochenbericht-270.pdf`, `rot-tb-messreihe-90.pdf`,
  `rscan-sc-observatorium-90.pdf`, `rscan-tb-lieferschwelle-90.pdf`,
  `real-attn-arxiv.pdf`, `real-docling-tr.pdf`, `real-bookscan.pdf`,
  `real-bookscan-notext.pdf`, `previews/*.png` (6),
  `_sources/` (gitignored downloads)
- `results/`: `audit_{text,ocr,table,realscan}.json`, `curated_sizes.json`,
  `curated_run.json`, `curated_docs/*.docling.json` (17),
  `quality_grades.json`, `region_iou.json`, `gen_check/` (determinism),
  `fresh_caches/` (empty-by-assertion), `_atime_probe.bin`
- `overlays/`: 23 PNG page overlays (red docling bbox / green GT)
- `curated/`: `models/**` (9 files, gitignored), `curated_models.zip`,
  `curated_models.7z`
- `.gitignore` (repo root): T5 cache entries appended
