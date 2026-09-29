# T3 report — cross-lingual retrieval (ES/DE/EN), multilingual-proto-v1

Date: 2026-09-29. Experiment per docs/specs/product-ux-design-research.md section B
(T3 row) and section 4 B ("Recuperación entre idiomas"). Criteria were fixed in
t3-criteria.md BEFORE the reserved eval set was touched (two dev-driven protocol
amendments are recorded there, both before the eval run). No files outside
eval/multilingual-proto/ and .probe-downloads/ were modified; nothing committed.

## 1. Runtime support finding (the load-bearing check)

**llama.cpp b11233 (CUDA build, .probe-downloads/llama-cuda) serves BOTH Qwen3 models
needed for T3. The embedding arm and the reranker arm are both supported.**

- Qwen3-Embedding-0.6B-Q8_0.gguf (639,150,592 bytes; HF lfs.oid
  06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439, verified with
  sha256sum after download): llama-server --embeddings -ngl 99 -c 8192 answers
  /v1/embeddings with HTTP 200, **1024 dimensions** (no MRL truncation requested),
  vectors L2-normalized (norm 1.0000), deterministic across identical requests
  (max abs delta 0). Pooling auto-selected from GGUF metadata (last-token pooling;
  the mean flag from the bge recipe was deliberately NOT passed). Cross-lingual
  sanity on a live probe: cos(es,de)=0.8719, cos(es,en)=0.8197, cos(de,en)=0.8003,
  cos(es,unrelated)=0.1611.
- Qwen3-Reranker: the official Qwen/Qwen3-Reranker-0.6B-GGUF repo answers 401 on HF;
  the llama.cpp-compatible conversion is ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF
  (639,153,184 bytes; lfs.oid
  22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48, sha256
  verified). b11233 has a native rerank endpoint (--rerank flag, /v1/rerank); a
  live probe with an ES query over DE documents scored the correct document 0.99998
  vs 1.4e-05 for distractors. The "reranker unavailable" fallback case did NOT occur.
- One environment quirk (not a server defect): inline curl -d with accented text from
  Git Bash mangles UTF-8 to Latin-1 and llama-server answers 500
  [json.exception.parse_error.101] "ill-formed UTF-8 byte". Send payloads from UTF-8
  files (--data-binary @file). Anything serving Spanish or German text through this
  stack must do the same.

## 2. Criteria (pre-registered)

Adopt Qwen3-Embedding-0.6B as an ALTERNATE profile only if, on the reserved eval set,
cross-lingual recall@10 improves >= +10pp over the bge baseline AND exact-fact
monolingual regression <= 3pp AND query-embedding p95 <= 3x baseline. Rationale per
threshold in t3-criteria.md (question-granularity arguments; embedding is pre-retrieval,
hence the looser latency multiple than an end-to-end gate).

## 3. Results

Reserved eval set: 24 questions (6 mono, 12 cross-lingual across all 6 direction pairs,
6 unanswerable). Index: 42 chunks / 12 docs / 60 pages, chunking 100 words + 20 overlap.
Every number below traces to a results JSON in results/.

### Eval, per pair (recall@10, evidence page in top-10)

| arm | es-es | de-de | en-en | es-de | de-es | es-en | de-en | en-es | en-de | cross | mono | pressure | qEmb p95 | index |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bge-hybrid (baseline) | 1.00 | 1.00 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.50 | 0.00 | 0.083 | 1.000 | 0.500 | 5.5 ms | 0.7 s |
| qwen3-hybrid | 1.00 | 1.00 | 1.00 | 0.00 | 1.00 | 0.00 | 0.00 | 0.50 | 0.00 | 0.250 | 1.000 | 1.000 | 16.6 ms | 3.2 s |
| qwen3-vec (diagnostic) | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.000 | 1.000 | 0.000 | 16.3 ms | 3.2 s |
| bge-vec (diagnostic) | 1.00 | 1.00 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 | 1.00 | 0.333 | 1.000 | 0.667 | 5.2 ms | 0.7 s |
| rerank (bge top-20 + Qwen3-Reranker) | 1.00 | 1.00 | 1.00 | 0.50 | 0.50 | 0.00 | 0.50 | 0.50 | 1.00 | 0.500 | 1.000 | 0.167 | 3.8 ms (+1.57 s rerank p95) | 0.7 s |

Eval MRR / nDCG@10: bge-hybrid 0.324/0.341, qwen3-hybrid 0.347/0.384, qwen3-vec
0.944/0.959, rerank 0.639/0.646. Index size: 42 chunks x dim x 4 B = 64,512 B (bge,
384-dim) vs 172,032 B (qwen3, 1024-dim); sqlite db 6.35 MB vs 10.8 MB (FTS and metadata
dominate at this scale). Full per-question rows in the JSONs; dev-pass equivalents in
results/t3-dev-*.json and the run log in results/history.jsonl.

### Dev subset (16 questions, tuning only)

| arm | cross R@10 | mono R@10 | pressure | note |
|---|---|---|---|---|
| bge-hybrid (first pass: 180/40 chunks, named queries) | 1.000 | 1.000 | 1.000 | saturated: top-10 = 40% of index, proper names = lexical bridge |
| bge-hybrid (final corpus: 100/20, name-free) | 0.250 | 1.000 | 1.000 | corpus hardened before eval |
| qwen3-hybrid plain | 0.375 | 1.000 | 1.000 | metrics identical with instruction prefix -> prefix frozen OFF |
| qwen3-vec | 1.000 | 1.000 | 0.000 | embedding carries all pairs |
| bge-vec | 0.500 | 1.000 | 1.000 | EN-only vectors partially match en-* and de-en |
| rerank depth 20 | 0.500 | 1.000 | 1.000 | rescues pairs whose evidence is inside bge top-20 |

## 4. The finding that matters: fusion, not embedding, blocks cross-lingual hybrid

For name-free cross-lingual questions the qwen3 embedding ranks the correct
foreign-language chunk FIRST under pure vector search (scratch probe for
x-es-de-alpenstern-altitude: top-1 = de-alpenstern-warte p1-3, cos 0.587, next
non-matching doc 0.374) — but through the app's hybrid RRF the same question returns
only same-language FTS junk in the top-10. Mechanism: query-language distractors sharing
generic tokens ("altitud", "nivel") collect both an FTS rank and a mid vector rank, and
1/(60+1)+1/(60+8) beats a pure vector-first 1/(60+1). Both engines are the app's own
(searchHybrid vs vectorSearch); the decomposition (qwen3-hybrid 0.250 vs qwen3-vec
1.000) is measured on the same reserved set and the same index. A second, smaller
effect: title-page chunks are cross-lingual magnets (org identity), soaking up rank 1
and costing MRR (qwen3-vec MRR 0.944 despite recall 1.000).

## 5. Decision per the pre-registered criteria: DEFER

On the production path (qwen3 through searchHybrid): gate 1 PASS (+16.7pp >= +10pp),
gate 2 PASS (0.0pp <= 3pp), gate 3 FAIL 16.62/5.52 = **3.01x > 3x** — 0.06 ms over the
line on a single 24-query run (dev invocations spanned 2.7x-3.6x; the margin is within
run noise, but the criteria required all three gates and were not adjusted after
results). Adoption would also not deliver the measured benefit today: +91.7pp sits in
the vector branch, which the current fusion buries (section 4). **Qwen3-Embedding-0.6B
is deferred as an alternate profile on two recorded drivers: (a) hybrid fusion blocks
the cross-lingual gain on the production path, (b) latency gate marginal-fail under the
frozen rule.** Path to adoption, in order: (1) a search-layer fusion fallback when FTS
is weak or empty on a multilingual query (own criteria, own experiment — not a profile
swap), (2) re-measure query-embedding p95 with a stricter protocol (multi-run, warm
server); 3.0x is inside noise and would likely pass, but the pre-registered rule stands
for this run.

Reranker (measured separately, no adoption decision per criteria): supported at runtime
(section 1), +41.7pp cross-lingual over baseline, but bounded by candidate recall —
es-en stayed 0.00 because bge's top-20 never contained the English evidence — and costs
~1.3-1.6 s per query at depth 20 (p50 1337 ms). Reranking qwen3-vector candidates would
change both its ceiling and its case; that arm was out of T3 scope.

Unanswerable pressure (report-only per criteria): bge-hybrid 0.500, qwen3-hybrid 1.000
(all six eval probes confidently answered with junk — consistent with the fusion
finding), qwen3-vec 0.000, rerank 0.167.

## 6. What remains unmeasured

- Hybrid fusion fixes (vector fallback / FTS-weakness detection) — the follow-up above.
- Qwen3-Reranker over qwen3-vector candidates; rerank depth/latency curve beyond depth 20.
- Corpus ceiling: 42 chunks, top-10 = 24% of the index; perfect qwen3-vector recall means
  this set cannot discriminate further quality steps (larger corpora, more same-topic
  distractors, longer documents unmeasured).
- MRL sub-dimensions of Qwen3 (native 1024 only), instructed DOCUMENT embeddings
  (docs embedded plain, matching production), additional pooling/dimension flags on
  b11233, GPU/CPU latency attribution.
- Answer-stage quality ("respuestas respaldadas" in the T3 row): retrieval-only here.
- Other languages, long queries, real (non-synthetic) documents.

## 7. Reproduction

```
# corpus (deterministic; byte-compare via checksums.sha256)
node eval/multilingual-proto/corpus/generate-corpus.mjs
node eval/multilingual-proto/corpus/validate-corpus.mjs        # ALL CHECKS PASSED
cd eval/multilingual-proto/corpus && sha256sum -c checksums.sha256

# arms (each invocation = fresh DB + own embedding profile; indexes never mix)
npx tsx eval/multilingual-proto/run-multilingual-eval.mts --recipe bge    --subset dev
npx tsx eval/multilingual-proto/run-multilingual-eval.mts --recipe qwen3  --subset dev --qwen-instruct on
npx tsx eval/multilingual-proto/run-multilingual-eval.mts --recipe rerank --subset dev --rerank-depth 20
npx tsx eval/multilingual-proto/run-multilingual-eval.mts --recipe bge    --subset eval
npx tsx eval/multilingual-proto/run-multilingual-eval.mts --recipe qwen3  --subset eval
npx tsx eval/multilingual-proto/run-multilingual-eval.mts --recipe rerank --subset eval
npx tsx eval/multilingual-proto/run-multilingual-eval.mts --recipe bge    --subset eval --mode vector
npx tsx eval/multilingual-proto/run-multilingual-eval.mts --recipe qwen3  --subset eval --mode vector
```

Models: Qwen3-Embedding-0.6B-Q8_0.gguf and qwen3-reranker-0.6b-q8_0.gguf in
.probe-downloads/ with expected-sha256 sidecar files (qwen3-embedding-expected-sha256.txt,
qwen3-reranker-expected-sha256.txt).

Decision sources: results/t3-eval-bge.json, t3-eval-qwen3-plain.json,
t3-eval-qwen3-plain-vec.json, t3-eval-bge-vec.json, t3-eval-rerank.json
(dev passes in t3-dev-*.json; run log in history.jsonl).
