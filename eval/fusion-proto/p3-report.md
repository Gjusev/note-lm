# P3 report — hybrid fusion policy (protected-vector), fusion-proto-v1

Date: 2026-09-29. Priority 3 of the fifth delivery: reproduce the T3 fusion
failure, keep a regression, compare a small justified set of fusion policies.
Criteria were fixed in p3-criteria.md BEFORE any run in this experiment; one
dev-driven protocol amendment (chunk hardening + branch-rank diagnostic) is
recorded there, before the reserved run, with thresholds unchanged. The
reserved eval subset (fusion corpus) was run ONCE per arm after the freeze.
Nothing outside eval/fusion-proto/, src/lib/services/hybrid-search.ts,
src/__tests__/hybrid-search-fusion-policy.test.ts and CONTEXT.md (one seam
row) was modified — the pre-existing src/__tests__/hybrid-search.test.ts is
untouched and passes unchanged under the new default;
eval/multilingual-proto/ (the T3 corpus and its reports) is UNTOUCHED;
nothing committed.

## 1. Decision (per the pre-registered gates): ADOPT — default flips to "protected-vector"

All three gates from p3-criteria.md, measured on the reserved fusion-corpus
eval subset (one run per arm, results/p3-fusion-eval-*.json):

| gate | threshold | measured | verdict |
|---|---|---|---|
| 1. cross recall@10 (qwen3) | >= +30pp over rrf | 0.500 -> 1.000 = **+50.0pp** | PASS |
| 2. mono recall@10 (both recipes) | drop <= 1pp | qwen3 1.000 -> 1.000 (0.0pp); bge 1.000 -> 1.000 (0.0pp) | PASS |
| 3. p95 retrieval latency (dev multi-run) | increase <= 20% | qwen3 5.83 -> 5.66 ms (**-2.8%**); bge 3.06 -> 2.20 ms (**-27.9%**) | PASS |

`DEFAULT_FUSION_POLICY` in src/lib/services/hybrid-search.ts is now
"protected-vector". The T3 'defer' report (eval/multilingual-proto/t3-report.md)
stays UNTOUCHED: its 3.01x finding is historical; this is a NEW protocol
result, run under its own pre-registered criteria.

## 2. Policies and their justifications

Both policies are post-retrieval transforms over the SAME two branch result
lists — identical SQL/KNN, identical notebook/source filters, identical
return contract (HybridResult: mode, vectorStatus, hits with provenance).

- **rrf** (baseline, the previous default) — plain reciprocal-rank fusion,
  score(d) = Σ 1/(60+branch rank), top-`limit` by fused score.
- **protected-vector** (new default) — after RRF, the top-3 vector candidates
  are guaranteed a seat in the returned top-k, each at a position no worse
  than its plain-RRF fusion position: items RRF already ranks inside the page
  keep their exact slot; missing ones take tail slots, evicting the
  lowest-fused-scored unprotected items from the tail. O(limit), no extra
  queries, no extra embeddings.
  - **N = 3, measured**: the failure mode (T3 §4 and this experiment's
    diagnostics) is the loss of the vector branch's HEAD — evidence chunks at
    vector rank 1-2 with no FTS foothold. On the reserved set all four
    rescued questions sit at vector rank 1-2; on dev both rescued questions
    sit at rank 1, while the residual dev misses sit at rank 4 and 9 —
    embedding-bound, outside any honest head. Raising N to 4 to capture the
    rank-4 dev question would be tuning N to a known question (mandate ban);
    the honest knob for rank-4+ misses is the embedding profile (§7).
  - **No symmetric FTS-head protection**: the failure mechanism is
    asymmetric — a same-language distractor collecting BOTH an FTS rank and a
    mid vector rank is exactly what buries the vector head; protecting the
    FTS head too would re-create the collision at the tail and double the
    eviction pressure on FTS evidence for zero measured failure to fix.
  - **Banned and absent** (mandate 3/4): weighted RRF / raw-score mixing
    (uncalibrated across branches), k-tuning to pass known questions,
    language rules, thresholds tuned to known questions.

## 3. Reproduction and the permanent regression

- **Unit regression (the guard)** —
  `src/__tests__/hybrid-search-fusion-policy.test.ts > "hybrid fusion policy —
  T3 cross-lingual regression (p3) > keeps a vector-rank-1 cross-lingual hit
  inside top-k when same-language distractors score in both branches (default
  policy)"`. Deterministic fake embeddings; a Spanish query whose correct
  German chunk is vector-rank-1 with no Spanish FTS tokens, against 11
  both-branch Spanish distractors. Written FIRST and observed RED under the
  then-default rrf (the correct chunk was absent from the entire top-10);
  turned GREEN by the adopted default. It runs with no policy parameter, so
  it guards what ships. Note: the mandate's literal "correct chunk ~8th by
  FTS" variant cannot drop out of top-10 under RRF (1/61+1/68 is beaten by at
  most 3 distinct-rank pairs), so the test encodes the geometry T3 actually
  measured (no FTS foothold) — same failure mode, actually droppable.
- **Contract tests** (same file): policy-param rescue at the exact tail slot
  with full provenance; no-op (byte-identical page) when RRF already seats
  the vector head; whole-head (top-3) seating with RRF survivors keeping
  better positions; source filters never leak an excluded source through
  protection; vectorStatus typing (failed/indexing/unavailable) inert under
  protection; limit respected.
- **T3 corpus regression (demonstration only, not a decision source)** —
  the historical failure reproduces and closes at its measured ceiling:

| arm (t3 corpus, eval subset) | cross R@10 | cross MRR | mono R@10 | pressure |
|---|---|---|---|---|
| qwen3-rrf | 0.250 (T3 historical: 0.250) | 0.050 | 1.000 | 0.833 |
| qwen3-protected-vector | **1.000** (T3 qwen3-vec ceiling: 1.000) | 0.139 | 1.000 | 0.833 |
| bge-rrf | 0.083 | 0.017 | 1.000 | 0.833 |
| bge-protected-vector | 0.167 | 0.027 | 1.000 | 0.833 |

## 4. Reserved-set results (fusion corpus, eval subset, ONE run per arm)

18 questions (6 mono-fact, 8 cross-lingual in all 6 direction pairs, 4
unanswerable), 61 chunks / 12 docs / 60 pages, chunking 50/10 (amendment 1).
Every number traces to results/p3-fusion-eval-*.json.

### By type, recall@10 (qwen3 recipe — the decision recipe)

| type | n | rrf | protected-vector |
|---|---|---|---|
| mono-fact | 6 | 1.000 | 1.000 |
| cross-fact (name-free) | 3 | 0.000 | **1.000** |
| cross-name (lexical bridge) | 2 | 1.000 | 1.000 |
| cross-number (digit bridge) | 2 | 1.000 | 1.000 |
| cross-distractor | 1 | 0.000 | **1.000** |
| **cross aggregate** | **8** | **0.500** | **1.000** |

Same table, bge recipe (the installed default): cross aggregate 0.375 ->
0.500 (+12.5pp; even English-only vectors carry a little cross signal —
consistent with T3's bge-vec 0.333), mono 1.000 -> 1.000, cross-fact stays
0.000 both arms (the embedding has no cross-lingual headroom; a fusion policy
cannot fix an embedding).

### nDCG@10 / MRR (diagnostics, not gating)

qwen3: cross nDCG 0.417 -> 0.571, cross MRR 0.393 -> 0.452; mono nDCG 1.000 ->
1.000, mono MRR 1.000 -> 1.000. bge: cross nDCG 0.289 -> 0.327, mono MRR
0.917 -> 0.917. As pre-registered: tail seats fix recall first, rank quality
second — acceptable for a retrieval floor.

### Why each question flipped (branch-rank diagnostics, qwen3 reserved run)

| id | type | rrf | prot | vector rank | fts rank | reading |
|---|---|---|---|---|---|---|
| x-es-en-quarry-toneladas | cross-fact | 0 | 1 | 2 | — | buried head, rescued |
| x-de-es-faros-alcance | cross-fact | 0 | 1 | 1 | — | buried head, rescued |
| x-en-de-bergbau-tiefe | cross-fact | 0 | 1 | 1 | — | buried head, rescued |
| x-en-es-tajo-robot | cross-distractor | 0 | 1 | 2 | — | buried head, rescued |
| x-de-en-kearsley-dampfmaschine | cross-number | 1 | 1 | 1 | 5 | digit bridge kept working |
| x-en-de-odenwald-1935 | cross-number | 1 | 1 | 8 | 8 | FTS carries it (vec too deep for the head) |
| x-es-de-porzellan-temperatura / x-es-en-fal-buques | cross-name | 1 | 1 | 1 | 1 | name bridge intact |
| all 6 mono-fact | mono | 1 | 1 | 1-2 | 1-2 | both branches agree; protection never fired |

All four rescued questions are vector rank <= 2 with no FTS foothold —
precisely the mechanism T3 measured and this policy targets.

### Unanswerable pressure (reported, not gating)

qwen3 1.000 vs 1.000 (both arms confidently answer junk — unchanged, a
property of the retrieval+answer chain, consistent with T3); bge 0.750 vs
0.750.

## 5. Dev results (tuning + latency; warmup + 3 measured runs per arm, drift = 0 across all runs)

### Metrics (dev subset, 12 questions)

| arm | cross R@10 | mono R@10 | all R@10 | pressure |
|---|---|---|---|---|
| qwen3-rrf | 0.500 | 1.000 | 0.600 | 0.000 |
| qwen3-protected-vector | 0.750 | 1.000 | 0.800 | 0.000 |
| bge-rrf | 0.500 | 1.000 | 0.600 | 0.500 |
| bge-protected-vector | 0.625 | 1.000 | 0.700 | 0.500 |

Dev misses that stay missed under protection are embedding-bound
(x-es-de-schleusen-hub at vector rank 9; x-de-es-faros-turm at vector rank 4 —
the Spanish lighthouse tower legitimately ranks behind two semantically very
close German tower descriptions) — see §2 for why N stays 3.

### Latency (p50/p95 ms; measured runs only; retrieval = searchHybrid with
pre-embedded query; end-to-end = query-embedding HTTP + searchHybrid)

| arm | ret p50 | ret p95 | emb p50 | emb p95 | e2e p50 | e2e p95 |
|---|---|---|---|---|---|---|
| qwen3-rrf | 4.73 | 5.83 | 14.5 | 15.7 | 22.23 | 26.37 |
| qwen3-protected-vector | 4.86 | 5.66 | 14.5 | 16.1 | 23.23 | 25.69 |
| bge-rrf | 2.13 | 3.06 | 5.0 | 6.9 | 8.98 | 11.29 |
| bge-protected-vector | 1.80 | 2.20 | 4.2 | 6.0 | 7.36 | 9.21 |

Relative (protected vs rrf): qwen3 ret p95 **-2.8%**, ret p50 +2.7%, e2e p95
-2.6%; bge ret p95 **-27.9%**, ret p50 -15.4%, e2e p95 -18.5%. The fusion
overhead is below run noise in both directions — the pre-registered "tight
budget" held without needing the margin. Reserved-run absolutes agree for
qwen3 (5.53 -> 5.68 ms, +2.7%); the bge reserved pair (2.71 -> 3.91 ms) is a
single 18-question run on ~3 ms absolutes — noise, which is exactly why gate
3 was pre-registered on the dev multi-run series.

## 6. Profile isolation, determinism, contract

- One embedding recipe per invocation, fresh DB each (the app rule); policies
  differ only at query time. metricDriftRuns = 0 on every multi-run arm.
- Corpora byte-deterministic: fusion corpus regenerated twice ->
  checksums.sha256 identical (sha256sum -c passes); the T3 corpus was read
  from disk and never written (git status of eval/multilingual-proto clean).
- Contract unchanged (asserted in tests): same HybridResult shape, same
  filter semantics inside both branches, provenance fields intact,
  vectorStatus typing intact, limit respected. The one documented nuance:
  with protected-vector the hits array order IS the ranking while `score`
  stays the plain RRF contribution, so scores can be non-monotonic at the
  protected tail slots.

## 7. Qwen3-as-alternate-profile: RECOMMENDED (integration is a separate slice)

T3 deferred Qwen3-Embedding-0.6B on two drivers: (a) hybrid fusion blocked
the cross-lingual gain — now removed by this experiment (qwen3 through
hybrid search reaches its own vector ceiling: cross 1.000 on BOTH corpora,
vs 0.083-0.500 for the installed bge through the same fixed fusion); (b)
query-embedding p95 3.01x baseline, a marginal single-run fail. This
experiment measures (multilingual query embedding, warm servers): qwen3/bge
embed p95 = 16.1/6.0 ms = **2.71x** on dev, 17.3/6.2 ms = **2.80x** on the
reserved run — under T3's 3x gate, and T3 itself recorded that 3.0x was
inside run noise. With driver (a) gone and (b) measuring under the gate, the
report RECOMMENDS re-opening the T3 adoption decision with a dedicated
multi-run re-measurement (T3's own stated path to adoption). Not integrated
here: profile adoption forces a reindex and per-notebook operator choice —
a separate slice, per the mandate.

## 8. What remains unmeasured

- Rerankers over protected-vector candidates (T3 measured rerank over rrf
  top-20 only); protected head N beyond 3; protection interaction with
  multi-evidence questions (all corpus questions have single evidence pages).
- Non-synthetic documents; languages beyond ES/DE/EN; longer queries; corpora
  beyond ~80 chunks; answer-stage quality (retrieval only, mandate 10).
- The bge reserved-run latency pair (single-run, ~3 ms absolutes) — noise,
  noted above.

## 9. Reproduction

```bash
# corpus (deterministic; byte-compare via checksums.sha256)
node eval/fusion-proto/corpus/generate-corpus.mjs
node eval/fusion-proto/corpus/validate-corpus.mjs        # ALL CHECKS PASSED
cd eval/fusion-proto/corpus && sha256sum -c checksums.sha256

# dev (tuning + latency: warmup + 3 measured runs)
npx tsx eval/fusion-proto/run-fusion-eval.mts --recipe qwen3 --policy rrf               --subset dev --runs 4
npx tsx eval/fusion-proto/run-fusion-eval.mts --recipe qwen3 --policy protected-vector --subset dev --runs 4
npx tsx eval/fusion-proto/run-fusion-eval.mts --recipe bge   --policy rrf               --subset dev --runs 4
npx tsx eval/fusion-proto/run-fusion-eval.mts --recipe bge   --policy protected-vector --subset dev --runs 4

# T3 corpus regression (demonstration only)
npx tsx eval/fusion-proto/run-fusion-eval.mts --corpus t3 --recipe qwen3 --policy rrf               --subset eval
npx tsx eval/fusion-proto/run-fusion-eval.mts --corpus t3 --recipe qwen3 --policy protected-vector --subset eval
npx tsx eval/fusion-proto/run-fusion-eval.mts --corpus t3 --recipe bge   --policy rrf               --subset eval
npx tsx eval/fusion-proto/run-fusion-eval.mts --corpus t3 --recipe bge   --policy protected-vector --subset eval

# reserved decision run (ONCE per arm; done — do not repeat for decisions)
npx tsx eval/fusion-proto/run-fusion-eval.mts --recipe qwen3 --policy rrf               --subset eval
npx tsx eval/fusion-proto/run-fusion-eval.mts --recipe qwen3 --policy protected-vector --subset eval
npx tsx eval/fusion-proto/run-fusion-eval.mts --recipe bge   --policy rrf               --subset eval
npx tsx eval/fusion-proto/run-fusion-eval.mts --recipe bge   --policy protected-vector --subset eval
```

Models: bge-small-en-v1.5-q8_0.gguf and qwen3-embedding-0.6b-q8_0.gguf in
.probe-downloads/ (llama-cuda b11233, --embeddings; payloads sent from
process memory, no shell quoting of UTF-8 — T3's Latin-1 mangling note
applies to curl only).

Decision sources: results/p3-fusion-eval-{qwen3,bge}-{rrf,protected-vector}.json
(dev passes in p3-fusion-dev-*.json, T3 regression in p3-t3-eval-*.json, run
log in results/history.jsonl).
