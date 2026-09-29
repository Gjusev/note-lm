# PI-2 decision report — PageIndex "Análisis profundo" on note-lm

Date: 2026-09-29. Run against the pre-registered criteria in
`pi2-criteria.md` (fixed 2026-09-28, before any 7B PageIndex run on the eval
subset). Reserved eval set (50 q) ran ONCE; dev subset (30 q) was the tuning
pass (infrastructure only — no criteria threshold was touched).

**DECISION: DO NOT ADOPT.** Derived mechanically from the criteria: quality
failed (criteria 2 and 3), the latency budget failed (criterion 5), and the
pre-registered Flash index mode is mechanically unbuildable on this corpus
(fail branch "tree unbuildable"). Keep corpus, harness, prototype and this
report as evidence. The scope branch ("improves only on some doc classes")
does not apply: PageIndex beat hybrid on NO measured question class.

## 1. Criteria checklist (measured, eval subset n=50)

| # | Criterion | Measured | Verdict |
|---|---|---|---|
| 1 | Zero citations outside authorized sources; zero nonexistent pages presented as evidence | 0 presented-evidence violations across 50 q x 2 SDK arms. 7 page REQUESTS beyond a doc's range counted and reclassified as SDK-rejected (get_page_content drops out-of-range pages by construction; no answer cites them). 0 answer citations outside the allowlist/page ranges. | PASS |
| 2 | Structural fully_supported >= hybrid + 5 pp (criteria said n=20; corpus has 22) | pageindex 16/22 = 72.7% vs hybrid 19/22 = 86.4% -> **-13.6 pp** (hybrid+tree also 72.7%) | FAIL |
| 3 | Exact-fact fully_supported drop <= 3 pp vs hybrid | 13/16 = 81.3% vs 15/16 = 93.8% -> **-12.5 pp** | FAIL |
| 4 | Invented-answer rate on unanswerables does not increase | pageindex 0/12 = 0.0% vs hybrid 0/12 = 0.0%. hybrid+tree 1/12 = 8.3% (one borderline German answer asserting a corpus-absent fact). | PASS (pageindex) |
| 5 | Automática p95 <= 2x hybrid p95; RAM+VRAM <= 8 GB; cancel aborts < 2 s | hybrid+tree e2e p95 20.4 s vs hybrid 6.0 s -> **3.40x** (pageindex 22.5 s = 3.75x). VRAM peak 5 992 MiB (ok). llama-server max working set 12.8 GB (includes mmapped GGUF pages; model fully in VRAM). Cancel overhead 0.5 ms, aborted with no answer. | FAIL (latency) |
| 6 | No-TOC / weak-heading docs: valid index or visible "index unavailable", never a silently wrong tree | All 9 target docs (corpus has 6 no-TOC + 3 misleading, not 5+3 as pre-registered) built trees with 0 out-of-range nodes (standard mode). Flash produced a visible "index unavailable" for all 21 docs. Caveat: 3 of 22 eval answers show page-attribution drift of 1-2 pages from the standard-built trees — surfaced through citations, not silent. | PASS (letter) |

## 2. The decisive pre-registered-mode finding: Flash cannot index the corpus

`submit_document(mode="flash")` failed for **21/21** corpus PDFs with
`PageIndex Flash could not extract a structure from this PDF` (evidence:
`pi2-flash-index-failures.log`, 0.1-1.2 s per doc — it never reaches the LLM).
The Flash pipeline (pdfium char-level layout heuristics in `pageindex.flash`)
finds no valid outline on ~8-page PDFs with ~100-word pages, mid-page section
headings after continuation paragraphs, and a textual TOC page. The same code
indexes the PI-1 probe PDF (reportlab, 16 pt headings) in 2.9 s — the failure
is corpus-layout-specific, not a usage error (PI-1 used the identical client
path).

Because the pre-registered arm is "pageindex (flash)", this alone triggers the
criteria's "mechanically broken (tree unbuildable) -> same as fail" branch.

To still obtain the 4-arm comparison, the trees for the SDK arms were built
with `mode="standard"` (LLM TOC extraction, Qwen2.5-7B): 19/21 on the first
pass (~40-52 s/doc, ~20 min), 2 docs failed once and both succeeded on an
idempotent retry (LLM non-determinism; `logs/pi2-index2.log`), final store
21/21. The query side is unchanged: the SDK's local agent (browse ->
structure -> get_page_content) navigates those trees. Any future attempt must
re-register criteria for the standard-built configuration before integration
work.

## 3. Raw results

Run files (complete per-question raw output, audit-ready):
`eval/harness/results/pi2-eval-fts_hybrid_pageindex_hybrid_tree-2026-09-29T05-32-52-386Z.json`
(+ `-graded.json`: per-question verdicts with judge-free rationales) and the
dev counterpart `...T05-05-43-231Z.json`.

Retrieval-grade (page-level, answerable questions; eval n=38, dev n=22):

| subset | arm | recall@5 | recall@10 | MRR | nDCG@10 | docIdR@10 | firstPage@10 |
|---|---|---|---|---|---|---|---|
| eval | fts | 0.921 | 0.947 | 0.854 | 0.776 | 0.961 | 0.368 |
| eval | hybrid | 0.974 | 0.974 | 0.882 | 0.806 | 0.974 | 0.342 |
| eval | pageindex | 0.816 | 0.816 | 0.789 | 0.698 | 0.934 | 0.816 |
| eval | hybrid+tree | 0.789 | 0.803 | 0.785 | 0.686 | 0.895 | 0.803 |
| dev | fts | 0.909 | 0.909 | 0.833 | 0.733 | 0.932 | 0.523 |
| dev | hybrid | 0.955 | 0.955 | 0.818 | 0.751 | 0.955 | 0.568 |
| dev | pageindex | 0.818 | 0.818 | 0.886 | 0.752 | 0.955 | 0.818 |
| dev | hybrid+tree | 0.864 | 0.864 | 0.977 | 0.807 | 0.955 | 0.864 |

Eval hybrid reproduces the PI-1 baseline (recall@10 0.974 / nDCG 0.806) — run
integrity check passed. PageIndex's exact-page ranking (firstPage@10 0.816 vs
hybrid 0.342) is genuinely better — the tree lands on the right page
neighborhood more often than chunk spans start on it — but it loses
end-to-end on answer quality and cost.

Answer-grade (mechanical rubric, ALL questions in the denominator; eval
n=50 = 38 answerable [22 structural, 16 exact-fact] + 12 unanswerable):

| subset | arm | structural fully_sup | exact-fact fully_sup | invented (unansw.) | abstained | failures | e2e p50 | e2e p95 |
|---|---|---|---|---|---|---|---|---|
| eval | fts | 17/22 = 77.3% | 15/16 = 93.8% | 0/12 | 12 | 0 | 4.5 s | 6.2 s |
| eval | hybrid | 19/22 = 86.4% | 15/16 = 93.8% | 0/12 | 12 | 0 | 3.5 s | 6.0 s |
| eval | pageindex | 16/22 = 72.7% | 13/16 = 81.3% | 0/12 | 12 | 0 | 9.2 s | 22.5 s |
| eval | hybrid+tree | 16/22 = 72.7% | 13/16 = 81.3% | 1/12 | 11 | 1 | 9.4 s | 20.4 s |
| dev | fts | 7/13 = 53.8% | 7/9 = 77.8% | 0/8 | 8 | 0 | 3.9 s | 6.7 s |
| dev | hybrid | 10/13 = 76.9% | 6/9 = 66.7% | 0/8 | 8 | 0 | 3.4 s | 5.8 s |
| dev | pageindex | 10/13 = 76.9% | 6/9 = 66.7% | 0/8 | 8 | 0 | 9.0 s | 26.1 s |
| dev | hybrid+tree | 8/13 = 61.5% | 6/9 = 66.7% | 3/8 | 5 | 0 | 8.7 s | 14.5 s |

Per-type verdict matrix (eval, fully_supported counts):

| type | n | fts | hybrid | pageindex | hybrid+tree |
|---|---|---|---|---|---|
| exact-fact | 16 | 15 | 15 | 13 (+2 partial) | 13 (+3 partial) |
| within-doc-xref | 9 | 9 | 9 | 9 | 9 |
| cross-section-comparison | 7 | 6 | 6 | 5 | 5 |
| cross-document-comparison | 6 | 2 | 4 | 2 | 2 |
| unanswerable (abstained) | 12 | 12 | 12 | 12 | 11 (+1 invented) |

Tokens per 50-question run: fts 107.5k prompt / 2.1k completion; hybrid
109.5k / 2.5k; pageindex 461.7k / 8.6k; hybrid+tree 534.7k / 8.5k — PageIndex
costs ~4-5x the prompt tokens (multi-turn agent). One-time standard index
build: ~20 min for 21 docs.

Sample sizes and uncertainty: with n=22 structural questions the observed
-13.6 pp delta is 3 questions (16 vs 19); Wilson 95% CIs overlap (pageindex
[52-87%] vs hybrid [67-95%]). Exact-fact drop = 2 questions of 16. Per the
pre-registration: results guide the product decision and prove nothing
universal. Parse/compat failures count in every denominator (one litellm
tool-call JSON parse error on q-064, hybrid+tree, recorded as failure).

## 4. Failure anatomy (why PageIndex loses on this corpus)

Ids verifiable in the graded JSON:

- q-032 (partial): fact right (8.4 M t); the tree sent the agent to pages
  3-5, evidence page is 2 — standard-built tree page attribution drifts 1-2.
- q-042 (unsupported): agent read page 5; the dock capacity is on page 6 —
  navigation stopped one page short.
- q-044 (partial): read the right section area, cited p. 6 (evidence p. 4);
  also requested pages 9-10 of an 8-page doc (SDK rejected — counted, benign).
- q-059 (unsupported): right page (7), wrong table row — picked "Riesling
  Sonnenuhr Kabinett" over "Gutswein trocken".
- q-064 (failure, hybrid+tree): llama.cpp could not parse the model's
  tool-call JSON once (litellm InternalServerError) — the parse/compat
  failure class the criteria require in the denominator.

Pattern: the standard-built trees are structurally valid but their
section-to-page boundaries drift on short pages, and 7B table reading is
fragile. Neither is fixed by better tree navigation; both are the failure
classes the plan flags for short pages and split tables.

## 5. Setup, revisions, resources

- Hardware: NVIDIA GeForce GTX 1080 8 GB (driver 582.66), Windows 11; eval-only
  llama.cpp build b11233 (CUDA 12.4, `.probe-downloads/llama-cuda/`), flags
  `-ngl 99 -c 8192 --jinja`, ~37 tok/s generation, ~718 tok/s prefill
  (gpu7b-verify.md).
- Model: Qwen2.5-7B-Instruct Q4_K_M split GGUF, sha256 verified against HF
  (gpu7b-verify.md). Same model, temperature 0, max_tokens 512 for ALL four
  arms. Embeddings: bge-small-en-v1.5 q8_0 (unchanged production recipe).
- Software: pageindex==0.2.10, litellm 1.103.0, openai-agents 0.20.0 (pinned
  venv `eval/pageindex-proto/.venv`), corpus document-trees-v1 (21 PDFs, 80 q).
- Revision: git 913654e4ec8e1e792e14b6117079ebfb86b4c204 (eval-only files
  added; no src/docs/scripts/workers changes for this evaluation).
- Wall times: flash index attempts ~25 s total; standard index build ~20 min;
  dev run 885.7 s (30 q x 4 arms); eval run 1 487.7 s (50 q x 4 arms);
  llama-server start ~7 s per phase; servers killed between phases with
  `taskkill /T /F`; zero orphan processes verified at each teardown.
- Per-question budget: 90 s wall cap (85 s inside the SDK agent, 14 turns);
  no question hit the cap in the eval run. Harness DB: temp, rebuilt fresh
  for both runs (dev and eval ingest/index identical within each run).

## 6. Method notes and deviations (all introduced in the tuning pass, all recorded)

1. Agent loop: the bridge drives the SDK's own chat internals
   (`pageindex.local_chat._openai_agent/_doc_block/_managed_instructions` +
   openai-agents Runner — the same calls `run_chat_completions` makes in
   v0.2.10) to get clean per-question cancellation and the tool transcript.
   The only prompt delta is one identical system message for ALL FOUR arms
   (answer only from the documents + citation format + the canonical
   abstention sentence), so criterion 4 compares retrieval, not prompts.
2. Arm definitions: pageindex = SDK agent scoped to the question's expected
   doc set (Profunda over the same selection the question grades against);
   unanswerables = full corpus, wall-budgeted (the SDK has no per-doc quota
   knob; the 90 s / 14-turn budget is the implemented "per-doc budget").
   hybrid+tree = hybrid top-3 distinct docs, then the agent inside those
   docs only.
3. Evidence model for criterion 1: pages the agent read (returned by
   get_page_content; requested-pages fallback where the transcript output was
   not captured) plus parsed `[file, p. N]` citations from the answer. The
   dev pass surfaced one requested-but-out-of-range read (q-023); the bridge
   now separates returned vs requested where the transcript allows, and the
   grader classifies out-of-range REQUESTS as SDK-rejected (the SDK cannot
   serve them — verified against agent_tools.py), not presented evidence.
4. Criteria/corpus deltas discovered, reported as measured (not softened):
   structural eval n=22 (criteria text said 20); no-TOC docs are 6 and
   misleading-heading docs 3 (criteria said 5+3).
5. Grading: mechanical, judge-free (normalization + numeric tolerance
   max(0.011, 0.5%), word-prefix match, abstention pattern list,
   citation-set coverage). Every verdict carries its rationale in the graded
   JSON. The single invented hybrid+tree answer is borderline (asserts a
   corpus-absent fact after a "keine spezifische ... genannt" hedge); the
   conservative pre-registered rubric counts it.

## 7. What to keep

- `eval/harness/run-pi2-eval.mts` + `eval/harness/grade-answers.mts` + the
  results JSONs — the 4-arm comparison machinery, reusable for any future
  retrieval candidate against the same corpus and rubric.
- `eval/pageindex-proto/pi2_bridge.py`, `pi2_store/`, index reports and
  `pi2-flash-index-failures.log` — reproducible evidence for this decision.
- The findings: PageIndex Flash cannot index short-page PDFs at all; even on
  standard-built trees it costs 4-5x prompt tokens and 2.7-3.7x latency for
  worse grounded answers than the existing hybrid path. FTS5 + sqlite-vec +
  RRF remains the general retriever; "Análisis profundo" is NOT added to the
  product. If doc-class-scoped interest survives (e.g. exact-page ranking for
  long real-world PDFs), re-register criteria for that class and the
  standard-built configuration first, then pass through PI-3..PI-5
  (packaged lifecycle, installed-app test) — an eval-script pass would not
  substitute for that gate.
