# CONTEXT — domain vocabulary and test seams

Read this before writing tests so names match the project's language.
The module boundaries below (from `docs/specs/product-blueprint.md`) are the
**agreed test seams**: test at these public interfaces, never at internals.

## Domain language

- **Notebook** — the unit of study; owns sources, notes, messages, materials.
- **Source** — an imported document/page/media; has provenance and status
  (`pending → processing → completed | error`).
- **Chunk** — an indexed text fragment of a source; cited by index.
- **Evidence** — the excerpt actually sent to a model; a citation must
  reference evidence that was in context.
- **Import job** — a URL import running through the lease-fenced queue.
- **Processing job** — a manual upload running extract/transcribe → chunk.
- **Lease** — the fencing token + expiry that protects a job against stale workers.

## Seams

| Seam | Public interface | Where |
| --- | --- | --- |
| persistence services | `src/lib/services/*` functions over a `LocalDb` | `src/__tests__/local-db.test.ts` |
| evidence | `buildEvidenceContext` / `resolveEvidenceReferences` | `src/__tests__/evidence.test.ts` |
| chat route | `POST /api/chat` over a temp data dir | `src/__tests__/chat-evidence.test.ts` |
| HTTP API | route handlers with mocked session | `src/__tests__/api-routes.test.ts` |
| worker queues | the real worker process against real SQLite | `e2e/ingestion-worker.e2e.test.ts` |
| engine protocol | `src/engine/protocol.ts` codec (NDJSON over stdio) | `src/__tests__/engine-protocol.test.ts` |
| engine dispatch | `handleEngineRequest(op, args)` ops without HTTP | `src/__tests__/engine-dispatch.test.ts` |
| retrieval fusion | `fuseRankings` RRF fusion | `src/__tests__/retrieval.test.ts` |
| retrieval metrics | `computeRetrievalMetrics` (recall@10/MRR/nDCG@10) | `src/__tests__/retrieval-metrics.test.ts` |
| vector index | vec0 table ops + resumable `indexNotebookChunks` | `src/__tests__/vector-index.test.ts` |
| hybrid search | `searchHybrid` (FTS+vector, notebook-scoped, fts fallback) | `src/__tests__/hybrid-search.test.ts` |
| eval harness | `runRetrievalEval` over a versioned corpus | `src/__tests__/retrieval-eval.test.ts` |
| llama supervisor | `startLlama` lifecycle + embed | `src/__tests__/llama-supervisor.test.ts` (fake) + `e2e/llama-server.e2e.test.ts` (real, artifact-gated) |

New seams are added here **before** their first test (TDD rule: no test at an
unconfirmed seam — adding it to this file is how a seam gets confirmed).

## Loop rules (mattpocock tdd skill)

Red → green, one vertical slice per cycle, no refactor inside the loop.
Expected values come from worked examples in the specs (e.g. the RRF formula
in `docs/specs/local-ai-rag-plan.md`), never recomputed the way the code does.
Deterministic fake embeddings in logic tests; real pinned models only in
distribution validation.

Repo language: English for issues, commits, tests and code comments.
User-facing app copy stays German for now; product specs under docs/specs
are authored in Spanish by the product owner.
