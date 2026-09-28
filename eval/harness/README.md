# eval/harness — retrieval-eval harness (PageIndex PI-1)

Measures whether the app's own retrieval surfaces the right PAGE of the right
document for the PI-0 corpus (`eval/corpus/document-trees-v1`, 21 deterministic
PDFs, 80 annotated questions: dev 30 / eval 50). It imports from `src/lib`
(no copy-paste of service logic) and runs against a throwaway temp SQLite DB,
exactly like `scripts/eval-retrieval.ts` does.

Arms (variants):

| variant | what runs |
| --- | --- |
| `fts` | `searchChunks` from `src/lib/services/search.ts` — the FTS5/BM25 branch that `searchHybrid` itself uses. Score = negated `bm25(chunks_fts)` rank (higher = better). |
| `hybrid` | `searchHybrid` from `src/lib/services/hybrid-search.ts` — FTS5 + sqlite-vec KNN fused by RRF, over llama-server `bge-small-en-v1.5` embeddings produced through the resumable `indexNotebookChunks` service. Score = RRF score. |

## Run

```bash
# smoke (5 questions per subset)
npx tsx eval/harness/run-retrieval-eval.mts --subset dev  --variants fts,hybrid --limit 5
npx tsx eval/harness/run-retrieval-eval.mts --subset eval --variants fts,hybrid --limit 5

# full subsets
npx tsx eval/harness/run-retrieval-eval.mts --subset dev
npx tsx eval/harness/run-retrieval-eval.mts --subset eval
```

`--variants` accepts any comma list from `{fts, hybrid}`. The hybrid arm needs
`.probe-downloads/llama-bin/llama-server.exe` and
`.probe-downloads/bge-small-en-v1.5-q8_0.gguf` (fetch via `npm run fetch:llama`
/ probe #2); without them the run fails fast with a message. Each run spawns
its own llama-server on a free loopback port (loopback-only, per-session
bearer token) and stops it afterwards. Wall time for a full run is ~8 s
(dev) / ~15 s (eval), dominated by embedding the 72 chunks (~5-9 s).

## What is graded

Per question, per variant, the top-10 hits are recorded as
`{docId, page, lastPage, score, rank}` (full lists in the results JSON).

Answerable questions (non-empty `expectedEvidence`), page level, binary
relevance:

- `recall@5` / `recall@10` — fraction of expected `(docId, page)` pairs covered
  by retrieved hits. A hit covers an expected pair when the docId matches and
  the evidence page lies inside the hit's page span `page..lastPage`.
- `mrr`, `ndcg@10` — first covering rank; binary-relevance nDCG over the top-10.
- `firstPageRecallAt10` — STRICT variant: the chunk must START on the evidence
  page. Reported separately; expect it to be much lower than `recallAt10`
  (see the approximation caveat below).
- `docIdRecallAt10` — partial credit, documented separately: expected docId
  present in the top-10 regardless of page.

Unanswerable questions (empty `expectedEvidence`):

- `evidencePressure` — fraction of unanswerable questions whose top-1 hit
  score reaches the threshold. Threshold = 10th percentile of top-1 scores
  over the run's ANSWERABLE questions, same variant (`thresholdRule` in the
  JSON documents this). Rationale: 90% of answerable questions sit above it,
  so an unanswerable question crossing it behaves like a confident retrieval
  of evidence that does not exist. Scores are not comparable across variants
  (bm25 vs RRF), so each variant gets its own threshold.

Also reported: `perf.retrievalP50Ms/P95Ms` per variant, `queryEmbedP50Ms/P95Ms`
(query-embedding HTTP round trip, excluded from retrieval latency — queries
are pre-embedded once for determinism), per-type averages, per-phase timings
(ingest/index/run/grade).

## Known approximations (documented in every results JSON under `meta.grading`)

1. **Chunk → page is a span, not exact.** Text is extracted per page with
   `pdf-parse`, pages are joined with `\n\n` (same as production
   `extractTextFromPDF`), and word offsets let every chunk be mapped to the
   pages its words actually touch. Because one chunk spans ~1.8 pages
   (see below), the primary metrics grade against the whole span; a chunk
   that starts one page early therefore still credits its evidence page.
   Use `firstPageRecallAt10` for the strict first-word-only attribution.
2. **Chunking differs from production defaults.** The corpus pages hold only
   ~100 words, so the production `chunkText` defaults (1000/200) would make
   one chunk = one whole document = no page signal at all. The harness uses
   `chunkText(text, 180, 40)`, which keeps every observed chunk inside bge's
   512-token training context (this corpus tokenises at up to ~2.6 tokens per
   word on tables/German). llama-server is started with `--ctx-size 1024
   --ubatch-size 1024` as outlier headroom (its defaults are 512/512 and a
   519-token input is rejected with a 500).
3. **English embeddings, multilingual corpus.** bge-small-EN embeds the es/de
   documents and questions too; the hybrid numbers therefore understate what
   a multilingual model would do. Part of the baseline's job.
4. Retrieval latency excludes the query-embedding HTTP call (see `perf.note`).

## Where the PageIndex arms plug in

The variant interface is a plain registry inside `runEval()`:

```ts
type RankedHit = { docId: string; page: number; lastPage: number; score: number; rank: number };
type VariantRunner = (question: string) => Promise<RankedHit[]>;
const variants: Record<string, VariantRunner> = { fts: ftsRunner /*, hybrid */ };
```

To add e.g. a `pageindex` arm: import the PageIndex SDK, build/load its tree
index over the same 21 PDFs (they are on disk in `eval/corpus/document-trees-v1`),
and register `pageindex: (question) => ...` returning ranked
`{docId, page, lastPage: page, score, rank}` (a PageIndex hit names an exact
page, so `lastPage = page`). Add the name to `--variants pageindex` and every
metric, the JSON report and the summary table pick it up unchanged. Because
PageIndex returns exact pages, also report its numbers against
`firstPageRecallAt10` for the strictest like-for-like comparison.

## Outputs

- `results/<subset>-<variants>-<timestamp>.json` — full run: meta (chunking,
  embedding recipe, grading rules), per-phase timings, per-variant aggregates,
  per-question per-variant top-10 with latencies.
- `results/history.jsonl` — one appended line per run
  `{timestamp, subset, variants, metrics}` for trend tracking.
