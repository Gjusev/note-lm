# eval — open benchmark

Everything in this directory is the project's open benchmark: synthetic
corpora we authored (redistributable), annotated questions, expected
evidence, deterministic generators/validators, runnable harnesses and the
published results — including the negative ones
(docs/specs/open-source-innovation-strategy.md, section 10).

## Run it

```bash
npm run eval:benchmark     # one entry point, ~15 s, no network needed
```

`scripts/run-benchmark.mjs` runs, in order:

1. **Corpora** — generates and validates both corpora by calling their
   existing scripts (`generate-corpus.mjs` + `validate-corpus.mjs`,
   `generate-version-pairs.mjs` + `validate-version-pairs.mjs`). Generators
   are deterministic: fixed literal content, pinned PDF metadata dates,
   explicit page breaks — reruns produce byte-identical PDFs.
2. **Retrieval eval** — `eval/harness/run-retrieval-eval.mts` via tsx with
   `--subset eval --variants fts,hybrid` over `document-trees-v1`
   (page-level recall@5/@10, MRR, nDCG@10, evidence pressure on
   unanswerable questions, latency).
3. **E1/E2 change review** — `npx vitest run src/__tests__/change-review.test.ts`;
   the suite itself writes the machine-readable `eval/reports/e1-e2-run.json`
   (material-warning precision >= 90%, recall >= 80%, 20/20 exact pairs).
4. **Summary** — writes `eval/reports/benchmark-summary.md` with the
   headline tables, the step log, and the PI-2 negative-result pointer.

Idempotent: safe to rerun; the summary is overwritten, retrieval results
accumulate as timestamped files plus one line per run in
`eval/harness/results/history.jsonl`.

## Embedding (hybrid) arm — optional, local only

The `hybrid` arm embeds through a llama-server spawned on loopback with the
pinned `bge-small-en-v1.5` GGUF. It needs
`.probe-downloads/llama-bin/llama-server.exe` and
`.probe-downloads/bge-small-en-v1.5-q8_0.gguf` (`npm run fetch:llama`).
Without them the benchmark **skips** the embedding arm with a clear SKIPPED
note in the summary and still runs corpora + FTS + E1/E2 — a fresh clone
needs nothing but `npm install`. The FTS arm never touches llama-server.
PI-2 is NOT rerun by the benchmark (expensive 7B indexing; its verdict is
recorded — see below).

## Corpora and provenance

| corpus | contents | generator / validator |
| --- | --- | --- |
| `corpus/document-trees-v1` | 21 synthetic multi-section PDFs (7 en / 7 es / 7 de), 80 annotated questions (30 dev / 50 eval) with `expectedEvidence` quotes + unanswerable probe terms | `generate-corpus.mjs` / `validate-corpus.mjs` (see its README) |
| `corpus/version-pairs-v1` | 20 deterministic PDF version pairs — 5 each of material-change / moved / deleted / format-only — 60 anchored claims, 15 expected proposals | `generate-version-pairs.mjs` / `validate-version-pairs.mjs` |

Provenance: **synthetic, authored in this repository, redistributable.** No
scraped or licensed third-party text; every document is built from literal
strings in the generators. Both corpora are MIT-licensed with the repo (same
license as the code). `corpus/retrieval-v1.json` is the older single-chunk
smoke set used by `npm run eval:retrieval` (scripts/eval-retrieval.ts).

## How to add cases

Follow the same shape the corpora already use (strategy section 10):
synthetic or otherwise redistributable documents, expected evidence recorded
with the question (never implied), the generator/config committed next to
the fixtures, and **negative results included** — unanswerable questions and
failing arms are published, not dropped. Concretely:

- New retrieval questions: add to `corpus/document-trees-v1/questions.json`
  with `subset`, `type`, `language`, `question`, `expectedEvidence`
  ({docId, page}) — then run `validate-corpus.mjs`; quotes must appear on
  their claimed page. Unanswerable question = empty `expectedEvidence`.
- New retrieval arm (variant): implement `(question) => RankedHit[]` and
  register it in the variant registry inside
  `eval/harness/run-retrieval-eval.mts` (see eval/harness/README.md).
- New change-review pairs: extend
  `corpus/version-pairs-v1/generate-version-pairs.mjs` (category, claims
  with `v1Page`/`v2Expected`, `expectedProposals`), regenerate, and keep
  `src/__tests__/change-review.test.ts` grading the whole manifest.

A judge LLM is never the only arbiter: grading here is deterministic string/
page matching against recorded evidence.

## Negative results (published, not hidden)

- **LAYA zero-shot — System-1 triage decisions: DO NOT ADOPT** — the
  multilingual checkpoint cannot discriminate our domain's decisions
  zero-shot: matrix pre-screening page-AUROC 0.5206 (chance), recall@1
  3/24, unanswerable clean 0/6; proposal prioritisation rank-AUC 0.23
  (inverted); query-intent choice collapses to one class (0.20 accuracy).
  Inference mechanics are fine (ONNX spike: exact Python parity, ~0.15
  s/decision CPU) and latency passed — quality is the blocker. Criteria
  pre-registered, decision report and raw runs:
  `laya-proto/report.md` / `laya-proto/results/` (criteria:
  `laya-proto/criteria.md`). Only viable revisit: fine-tuning on own
  labelled decisions, with new pre-registered criteria.
- **PI-2 — PageIndex "Análisis profundo": DO NOT ADOPT** — quality failed
  (structural fully_supported −13.6 pp vs hybrid), latency failed (p95 3.4x
  hybrid), and the pre-registered Flash mode cannot index this corpus at all
  (21/21 docs). Decision report with criteria and raw runs:
  `pageindex-proto/pi2-decision-report.md` (criteria pre-registered in
  `pageindex-proto/pi2-criteria.md`). Do not rerun it casually: 7B LLM
  indexing, ~20 min and several GB of VRAM.

## Layout

```
corpus/                  corpora + generators + validators (+ per-corpus READMEs)
harness/                 run-retrieval-eval.mts, run-pi2-eval.mts, results/
harness/results/         timestamped run JSONs + history.jsonl (trend)
pageindex-proto/         PI-1/PI-2 prototype, decision criteria + report
laya-proto/              LAYA triage prototype: criteria, eval runner,
                         ONNX spike + negative decision report
reports/                 e1-e2-run.json, e1-e2-change-review.md,
                         benchmark-summary.md (written by eval:benchmark)
```
