# LAYA decision criteria — fixed BEFORE any laya run on project data

Date fixed: 2026-09-29, before the checkpoint was downloaded or any
`predict` call was made against project corpora. Model of record:
`convaiinnovations/laya-multilingual` (mmBERT-base, 322M, Apache-2.0,
HF revision pinned at run time in `results/run-meta.json`).

Exception note: the global "2 weeks minimum release age" rule was waived
for this evaluation by explicit user decision (2026-09-29). The package
`laya` (PyPI, first release 2026-09-18) is used in an ISOLATED venv under
`eval/laya-proto/.venv` (gitignored) and MUST NOT become a product
dependency from this experiment. The product path (if any) is laya-ts +
ONNX via the engine, evaluated separately in `engine-path`.

## Use cases under test (product: triage hints, never statuses)

- **U1 matrix pre-screening** — evidence matrix cell (claim-question x
  source) currently starts `not_reviewed`; laya `noul` would give a
  SORTING HINT ("does this source contain evidence for this question?"),
  like the recorded covering search, never a model-granted relevance
  label. Corpus: `eval/fusion-proto/corpus` (30 questions x 9 docs;
  positives = expectedEvidence docIds; the 6 `pair:"none"` questions are
  all-negative).
- **U2 review-proposal prioritisation** — `scanForStaleness` flags pairs
  deterministically; laya would PRIORITISE the review queue.
  Corpus: `eval/corpus/version-pairs-v1` (20 v1→v2 pairs; material =
  material-change + deleted; non-material = moved + format-only —
  ground truth by construction, from the generator's own category spec).
- **U3 query intent** — route a question to a retrieval strategy
  (strategy §6 table): choice over {single-fact, cross-doc,
  unanswerable}. Corpus: same 30 questions; ground truth from
  `type` (mono-* → single-fact, cross-* → cross-doc, unanswerable →
  unanswerable).

## Grading setup

- One checkpoint (multilingual), same question phrasings for all pairs,
  temperature as shipped (calibration is the model's own), no
  fine-tuning — zero-shot only, as the product would ship it.
- U1 graded at TWO granularities: page-level (each page separately,
  aggregate = max page probability; the engine-realistic shape that also
  yields a page locator) and doc-level (full text, `max_len=8192`).
- Every run records: wall time, per-decision latency (p50/p95), device,
  token budget used, failures (counted in the denominator, never
  dropped).

## Pass criteria (ALL must hold to propose adoption into the engine)

1. **U1 usefulness**: answerable-question recall@1 (true doc top-ranked
   by noul probability) >= 0.8; page-level AUROC >= 0.85.
2. **U1 safety**: on the 6 unanswerable questions, all-doc mean noul
   probability stays below the operating threshold (0.5) — i.e. no doc
   surfaces as "contains evidence" for an unanswerable question in >= 5
   of 6 questions.
3. **U2 prioritisation**: rank-AUC material vs non-material >= 0.85 over
   the 20 pairs; the 5 format-only pairs must score as non-material
   (still-supported) in >= 4 of 5.
4. **U3 routing**: choice accuracy >= 0.8 (majority-class baseline is
   0.53); unanswerable recall >= 4/6.
5. **Budget**: page-level U1 full run < 15 min on the dev CPU (engine
   runs would be incremental per new claim, not bulk); single page-level
   decision p95 < 2 s batched.
6. **Integration fit** (design check, no code): the decision surfaces
   map onto existing seams as HINTS — matrix cell annotation and
   proposal ordering — with statuses and human decisions unchanged.

## If criteria fail

- Fail U1 only -> do NOT wire the matrix hint; keep harness + results.
- Fail U2 only -> proposal prioritisation stays deterministic
  (category/time-based); record as a laya negative result.
- Fail U3 only -> strategy routing stays rule-based (§6 first column).
- Latency-only failure -> re-state budget for GPU (project has a CUDA
  eval build path, PI-2 precedent) before any adoption talk.
- n is small (30 / 20 / 30): results guide the product decision and
  prove nothing universal — stated in every report.
