# CONTEXT — domain vocabulary and test seams

Read this before writing tests so names match the project's language.
The module boundaries below (from `docs/specs/product-blueprint.md`) are the
**agreed test seams**: test at these public interfaces, never at internals.

## Domain language

- **Notebook** (Notizbuch) — the unit of study; owns sources, notes, messages, materials.
- **Source** (Quelle) — an imported document/page/media; has provenance and status
  (`pending → processing → completed | error`).
- **Chunk** (Abschnitt) — an indexed text fragment of a source; cited by index.
- **Evidence** (Beleg) — the excerpt actually sent to a model; a citation must
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
| retrieval | `src/lib/services/retrieval.ts` fusion (RRF) | `src/__tests__/retrieval.test.ts` |

New seams are added here **before** their first test (TDD rule: no test at an
unconfirmed seam — adding it to this file is how a seam gets confirmed).

## Loop rules (mattpocock tdd skill)

Red → green, one vertical slice per cycle, no refactor inside the loop.
Expected values come from worked examples in the specs (e.g. the RRF formula
in `docs/specs/local-ai-rag-plan.md`), never recomputed the way the code does.
Deterministic fake embeddings in logic tests; real pinned models only in
distribution validation.
