# PI-2 decision criteria — fixed BEFORE the reserved-set run

Date fixed: 2026-09-28 (before any 7B PageIndex run on the eval subset).
Evidence so far: PI-0 (corpus 21 PDFs / 80 questions), PI-1 (SDK 0.2.10 +
llama.cpp local; Flash works, standard mode hard-fails at 0.5B), retrieval
baseline (dev: hybrid recall@10 0.955 / nDCG 0.751; eval: 0.974 / 0.806;
evidence pressure hybrid 0.875 vs fts 0.375).

## Grading setup

- Model: Qwen2.5-7B-Instruct Q4_K_M, llama.cpp CUDA (eval-only build), -ngl max
  that fits the GTX 1080. Same model, output budget (max_tokens 512), and
  temperature 0 for ALL four variants: fts, hybrid, pageindex (flash),
  hybrid+tree.
- Answer rubric per question (judged against expectedEvidence + expectedAnswer):
  - fully_supported: answer asserts the expected fact AND cites evidence whose
    page contains the quote.
  - partially_supported: fact present, citation missing/wrong page.
  - unsupported / invented: asserts a fact not in the cited corpus pages
    (unanswerable questions: ANY factual answer counts as invented).
- Structural subset = cross-section-comparison + cross-document-comparison +
  within-doc-xref (the cases PageIndex targets). General = exact-fact.
- Every run records: latency p50/p95, retrieval LLM calls, tokens, peak RAM/VRAM,
  parse/compat failures (counted in the denominator, never silently dropped).

## Pass criteria (ALL must hold to adopt "Análisis profundo")

1. Safety: zero citations pointing outside the authorized notebook/sources;
   zero nonexistent pages presented as valid evidence.
2. Structural quality: fully_supported rate on structural questions improves
   >= +5 percentage points over hybrid (report n=20 structural eval questions;
   with n this small, results guide the product decision and prove nothing
   universal — stated in the report).
3. No general regression: fully_supported on exact-fact drops <= 3 pp vs hybrid.
4. Abstention: invented-answer rate on the 20 unanswerable questions does not
   increase vs hybrid (measured on the same model/run conditions).
5. Budget: Automática p95 <= 2x hybrid p95 on identical hardware; RAM+VRAM
   steady-state <= 8 GB (the 1080 budget fixed from PI-0/PI-1 measurements);
   cancellation must abort a query within 2 s and leave a clearly-incomplete
   draft.
6. Degradation: docs without TOC / weak headings produce either a valid index or
   a visible "index unavailable" — never a silently wrong tree (from PI-1
   finding 2, tested on the 5 no-TOC + 3 misleading-heading corpus docs).

## If criteria fail

- Fail quality only -> do NOT adopt; keep corpus/harness/prototype as evidence.
- Improve only on some doc classes -> scope the feature to those classes and
  re-state criteria for them before any integration work.
- Mechanically broken (tree unbuildable/unsafe citations) -> same as fail.

## If criteria pass

Next gate before product: packaged-lifecycle test (PI-3..PI-5) — tree index as
Tauri-controlled workers with progress/pause/cancel/recovery, typed ops,
activity center stages, and the installed-app acceptance run. The eval script
passing never substitutes for the installed-app test.
