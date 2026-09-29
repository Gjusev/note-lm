# P3 decision criteria — hybrid fusion policy (written BEFORE any fusion-proto eval run)

Experiment: fusion policies for `searchHybrid` (Priority 3 of the fifth
delivery), following the T3 defer decision (eval/multilingual-proto/t3-report.md
§5): T3 measured that the hybrid RRF fusion buries a cross-lingual vector hit
(qwen3-vec cross recall@10 = 1.000 vs qwen3-hybrid 0.250 on the same reserved
set and index). This file fixes the adoption thresholds BEFORE any metric is
measured in this experiment, so the decision cannot be tuned to the result.
The thresholds themselves come from the delivery mandate, not from data.

## Arms (each recipe in its own index, never mixed — the app rule)

Policies (post-retrieval transforms over the same two branch result lists;
identical branch SQL/KNN, identical filters, identical contract):

- `rrf` — baseline: the current fusion, reciprocal rank 1/(60+rank) summed
  over both branches, top-`limit` by fused score.
- `protected-vector` — after RRF, the top-N vector candidates (N = 3) are
  guaranteed a seat in the returned top-k at a position no worse than their
  plain-RRF fusion position (items RRF already ranks inside the page keep
  their slot; missing ones take tail slots, evicting the lowest-fused-scored
  unprotected items). Justification for N = 3 and for NOT protecting the FTS
  head symmetrically is in src/lib/services/hybrid-search.ts.

Embedding recipes (unchanged from T3, one per invocation, fresh DB each):

- `bge` — bge-small-en-v1.5 q8_0 (the installed default; English-only vectors).
- `qwen3` — Qwen3-Embedding-0.6B q8_0 (1024-dim), plain queries, prefix OFF
  (T3's frozen config).

BANNED by the mandate and not present here: weighted RRF / raw-score mixing
(uncalibrated), k-tuning to pass known questions, language rules, thresholds
tuned to known questions.

## Corpora

- `fusion` (NEW, reserved for the decision) — eval/fusion-proto/corpus,
  fusion-proto-v1: 12 docs / 60 pages (4 ES, 4 DE, 4 EN), 30 questions
  (dev 12 / eval 18): 8 mono-fact, 16 cross-lingual in all 6 direction pairs
  (5 name-free cross-fact, 4 cross-name with a lexical bridge, 4
  cross-number with a shared digit token, 3 cross-distractor whose query
  tokens hit >= 2 same-language distractor docs), 6 unanswerable. Deterministic
  (checksums.sha256), validated (validate-corpus.mjs).
- `t3` — eval/multilingual-proto/corpus, RUN AS REGRESSION ONLY: it was
  inspected during T3, so tuning on it is possible and decisions from it are
  not acceptable. It demonstrates the original failure and its fix; nothing
  else. The T3 report stays untouched either way.

## Protocol

- dev subset (fusion corpus): any number of runs; used to sanity-check that
  the failure reproduces and to measure latency (warmup + 3 measured runs per
  arm; p50/p95 absolute and relative, end-to-end retrieval wall time
  INCLUDING the query-embedding HTTP call).
- Reserved run: fusion corpus, eval subset, ONCE per arm after this file is
  frozen. results/*.json is the only accepted decision source.
- If a dev finding forces a protocol amendment, it is recorded here BEFORE
  the reserved run (as T3 did), with thresholds unchanged.

## Primary gate: flip the searchHybrid default to "protected-vector" iff ALL hold

1. Cross-lingual recall@10 on the reserved eval set improves >= +30pp over the
   rrf baseline — measured on the qwen3 recipe (the recipe whose vector branch
   carries cross-lingual signal; with bge the English-only vectors contain
   almost no cross-lingual information, so a fusion policy cannot move its
   cross numbers — gating on bge cross would measure the embedding, not the
   fusion). "Cross-lingual" = all questions of types cross-fact, cross-name,
   cross-number, cross-distractor — 16 total, 8 of them on the eval subset
   (see questions.json counts).
2. Monolingual recall@10 drops <= 1pp vs the rrf baseline on BOTH recipes
   (bge and qwen3) on the reserved eval set. With 6 mono eval questions one
   question = 16.7pp, so <= 1pp means zero mono evidence pages lost — the
   installed default recipe must not get worse even by one question.
3. p95 retrieval latency (searchHybrid call, pre-embedded query) increases
   <= 20% vs rrf, measured on the dev multi-run series (warmup + 3 runs,
   12 questions x 4 arms x 3 measured runs per recipe — a larger and warmer
   sample than a single reserved pass), reported alongside the reserved run's
   own p50/p95 end-to-end wall times (incl. query embedding) per arm.

### Justification of the numbers

+30pp cross: the policy exists to recover the T3-measured vector-branch gain
that fusion buries (+75pp on the T3 reserved set: 1.000 vs 0.250). A change
that ships as the new default must recover a decisive share of that, not a
marginal slice; with 8 eval cross questions, 30pp = 2.4 questions. Anything
smaller would not justify touching the default ranking every notebook uses.

<= 1pp mono: the default ranking serves every existing notebook; protection
only evicts tail items (ranks limit-2..limit), so mono evidence (both-branch
rank 1-2 in the healthy case) must not move at all. Zero-loss is the honest
bar for a default swap.

<= 20% p95: fusion is post-retrieval — a few Map/Set operations over <= 40+40
candidate ids, no extra SQL, no extra embedding. The tight budget exists to
keep the policy honest (if it ever needs real work per query, it is doing
something else than fusing). Query embedding and KNN dominate and are shared
by both arms, so even 20% of p95 is generous; measured overhead is expected
to be noise-level.

### What does NOT gate the decision (reported, not gating)

- Unanswerable evidence pressure: property of the retrieval+answer chain;
  reported per arm (T3 measured 1.000 for qwen3-hybrid).
- nDCG@10 / MRR / per-pair / docId recall: diagnostics. Note honestly: tail
  seats can worsen cross MRR vs a reranker while fixing recall; that trade is
  acceptable for a retrieval floor (the answer stage reads pages, not ranks).
- The t3-corpus regression numbers: regression demonstration only.
- Index time/size: identical arms (same index; policies differ at query time
  only — each invocation re-ingests into a fresh DB for profile isolation).
- Qwen3-as-alternate-profile: NOT decided here (T3 deferred it with a 3.01x
  latency gate fail). If these numbers justify revisiting, the report
  RECOMMENDS it and integration is a separate slice.

## Protocol amendment 1 (recorded BEFORE the reserved run, dev-driven)

First dev pass (chunking 100/20, T3's frozen constants) produced 33 chunks, so
top-10 covered 30% of the index and the rrf baseline saturated (cross R@10
0.750 on dev; the same failure mode T3's amendment 1 hit at 40%): on a corpus
that small, plain RRF surfaces the correct chunk by headroom alone and no
policy difference can be measured honestly. Hardened BEFORE any eval-subset
run, thresholds and questions unchanged, corpus bytes unchanged (chunking is
a harness ingest constant):

- chunk size 100/20 -> 50/10 (~2x chunks; top-10 ≈ 14-18% of the index)
- added a branch-rank diagnostic to the harness (raw rank of the first
  evidence chunk in each branch at the app's candidate depth 40), so misses
  can be attributed to the embedding (vector rank > 3) vs the fusion
  (vector rank <= 3 but absent from the fused page) and the protected-head
  size N is justified by measurement, not assertion.

## Decision

Recorded in p3-report.md as: adopt (default flips to "protected-vector" in
src/lib/services/hybrid-search.ts; the T3 'defer' report stays untouched — its
3.01x finding is historical, this is a NEW protocol result) / keep-rrf, with
the driver numbers quoted from results/*.json. The unit regression
(src/__tests__/hybrid-search-fusion-policy.test.ts) is written against the
DEFAULT policy and must be green in the final state for an adopt decision.
