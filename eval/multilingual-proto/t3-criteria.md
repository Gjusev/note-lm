# T3 decision criteria — multilingual retrieval (written BEFORE the eval run)

Experiment: cross-lingual retrieval ES/DE/EN, per docs/specs/product-ux-design-research.md
section B (T3 row) and section 4 B ("Recuperación entre idiomas"). This file fixes the
adoption thresholds BEFORE any metric is measured, so the decision cannot be tuned to the
result. Corpus: eval/multilingual-proto/corpus (multilingual-proto-v1, 12 docs, 40
questions: dev 16 / eval 24; 12 monolingual controls, 20 cross-lingual in all 6 direction
pairs, 8 unanswerable).

## Arms (each recipe in its own index, never mixed)

- `bge` — baseline: the app's current recipe (bge-small-en-v1.5 q8_0, 384-dim, mean
  pooling) through the app's own hybrid search (FTS5 + vec0 KNN, RRF). Expected to prove
  the cross-lingual weakness of the current catalog (BGE small is English-only).
- `qwen3` — Qwen3-Embedding-0.6B q8_0 via llama-server /v1/embeddings (1024-dim, GGUF
  pooling as shipped), through the same hybrid search. Tuning allowed on dev only.
- `rerank` — Qwen3-Reranker-0.6B q8_0 via llama-server /v1/rerank over the bge arm's
  top-20 hits. Measured separately; no adoption decision in T3 (see below).

## Primary gate: adopt qwen3 as an ALTERNATE embedding profile (never a silent default)

All three conditions must hold on the RESERVED eval subset:

1. Cross-lingual recall@10 improvement >= +10pp over the bge baseline
   (mean over the 12 eval cross-lingual questions).
2. Monolingual regression <= 3pp: mean recall@10 over the 6 eval monolingual questions
   may drop by at most 3pp vs baseline.
3. Latency: query-embedding p95 <= 3x baseline query-embedding p95.

### Justification of the numbers

+10pp cross-lingual: the decision only gates an alternate profile — an operator would
still have to pick it per notebook, and a recipe change forces a full reindex — so the
gain must be unambiguous, not marginal. With 12 eval cross-lingual questions, one
question equals 8.3pp; +10pp therefore requires a net improvement of more than one whole
question, i.e. the signal must survive at least one full question flip. A smaller
threshold would make a single flipped question decisive, which is noise on this set size.

<= 3pp monolingual regression: with 6 eval mono questions, one question equals 16.7pp, so
this clause degrades to "zero net loss of evidence pages" — deliberately. The current
profile is the installed default; a multilingual swap must not make any exact-fact
monolingual retrieval worse even by one question, because every existing notebook pays
the reindex cost.

p95 <= 3x baseline: embedding is a pre-retrieval, once-per-query cost, not the end-to-end
answer path PI-2 measured — a looser multiple than an end-to-end gate is justified, while
still catching pathological regressions (model spilling off GPU, ubatch thrash). 0.6B vs
33M parameters both GPU-offloaded should stay in the tens of milliseconds; 3x leaves room
for the size step without admitting a pathological profile.

### What does NOT gate the decision (reported, not gating)

- Unanswerable evidence pressure: a retrieval-only metric on 8 questions; it is reported
  per arm for visibility but says nothing about the embedding recipe alone (pressure is a
  property of the whole retrieval+answer chain).
- nDCG@10 / MRR / docId recall: reported for diagnosis; the recall@10 gate above is the
  decision metric because the product requirement is "evidence page reaches the reader".
- Index time and index size: reported for the reindex-cost story, not gated (reindex runs
  offline and the app already exposes progress).
- The rerank arm: composes on top of an embedding recipe and shifts latency budget
  end-to-end; it needs its own criteria in a later experiment. T3 measures it and
  reports pair tables, but adopts nothing based on it.

## Protocol

- dev subset: any number of runs, used to tune (a) the Qwen3 query-instruction prefix
  on/off, (b) rerank candidate depth. The choice is frozen in writing before the eval run.
- eval subset: run ONCE per arm after the freeze; results JSON in results/ is the only
  accepted source for the decision.
- Profile isolation mirrors the app rule (recipe change = new index): each arm ingests
  and indexes the corpus into a fresh database with its own registered embedding profile.

Decision recorded in t3-report.md as: adopt as alternate profile / defer, with the driver
number(s) quoted from results JSON.

## Protocol amendment (recorded before the eval run, driven by the dev subset)

First dev pass (chunking 180/40, all cross-lingual queries carrying the org's proper
name) saturated: 25 chunks corpus-wide meant top-10 covered 40% of the index, and the
proper name gave bge a lexical bridge even across languages, so baseline recall@10 was
1.0 everywhere and no threshold could discriminate. Corpus hardened BEFORE any eval-subset
run, with criteria and subset split unchanged:

- chunk size 180/40 -> 100/20 (about 90 chunks; top-10 is ~11% of the index)
- all 20 cross-lingual queries rewritten name-free: the org is described in the query
  language ("el observatorio astronómico alpino", "die Saatgutbank", "the dry dock"),
  so cross-lingual retrieval must work semantically, not by name lookup. Monolingual
  controls keep the org name (they measure the installed recipe's home turf, entity
  anchoring included).
- evidence pages, quotes, subset split and question counts are unchanged; corpus
  validator re-run: all checks passed. Dev re-run follows; eval subset still untouched.

## Protocol amendment 2 (still before the eval run, dev-driven)

Second dev finding: with name-free cross-lingual queries, a pure-vector probe ranks the
correct German chunk first (cos 0.59) for an ES->DE altitude question, but through the
app's hybrid RRF the same question returns only same-language FTS junk in the top-10:
FTS matches on generic tokens ("altitud", "nivel") let query-language distractors collect
both an FTS rank and a mediocre vector rank, which beats a pure vector-first hit under
RRF (1/(60+1)+1/(60+8) > 1/(60+1)). The embedding is not the (only) blocker; the fusion
is. Section 4 B of the design research explicitly asks to compare "híbrido actual, nuevo
embedding y reranker por separado", so:

- added diagnostic arms `--mode vector` (vec0 KNN branch alone, same app vector stack):
  qwen3-vector and bge-vector, each run once on eval, reported as diagnostics;
- the ADOPTION gate stays on the production path (qwen3 through hybrid search, as
  written above). If qwen3-vector passes the gate but qwen3-hybrid does not, the recorded
  decision is DEFER with the driver named as the fusion behavior, plus the follow-up
  (fusion fallback when FTS is weak), not "embedding rejected".
- frozen qwen3 config for eval: instruction prefix OFF (dev showed identical rankings
  with the prefix; production llamaEmbed sends plain text — the faithful config).
