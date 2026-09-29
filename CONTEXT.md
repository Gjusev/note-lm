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
- **SourceVersion** — an immutable snapshot of a source's original bytes plus
  its page texts. Importing the same document again with changed bytes
  appends a new version; the original bytes and older versions are never
  destroyed. Claims (later slices) anchor to versions, never to the mutable
  source row — the source row is overwritten on re-import, a version is not.
- **Claim** — a statement saved by a human or kept from a chat answer; it
  carries text, origin (`user` | `chat`) and an honest status, never a
  model-granted "verified" label.
- **Evidence anchor** — a citation made durable: it points to an IMMUTABLE
  `source_versions` row plus a locator (the page when truly known, `null`
  otherwise — a page is never invented) and the quoted text.
- **Review proposal** — the deterministic staleness finding a source change
  raises against dependent claims (`quote_moved` / `quote_missing`). It
  flags changed inputs, it never proves a conclusion false; accepting or
  rejecting keeps the full history in the proposal row and human notes are
  never overwritten.
- **Calculation** — one deterministic op (`sum` | `avg` | `min` | `max` |
  `count`) over the rows of an IMMUTABLE source version's sheet sidecar.
  Never an LLM: the calculation row (input version + query + result +
  timestamp) IS the reproducibility record. Ambiguity blocks (E4, v1): a
  non-numeric cell fails the op naming row+column; an empty cell is
  ambiguous — `count` skips it, the numeric ops block.
- **AI provider** — three separate entities: a **preset** (code: how to talk),
  a **connection** (settings instance: preset + own instance id + endpoint +
  secret reference), and a **capability** (what is used: resolved per
  capability from explicit config `{connectionId, model}`, never inferred).
  Local llama.cpp stays the default when no explicit remote config exists.
  Offline blocks at **call time**: resolved remote functions re-check the
  `ai.offline` flag on every call; new requests and retries are refused and
  in-flight remote calls are aborted. Local calls are never blocked.

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
| engine job pool | `runProcessingJob` / `runImportJob` stage gates + job-control checkpoint fns over a real temp SQLite (driven like `engine-imports`) | `src/__tests__/engine-pool.test.ts` |
| job event stream | `emitJobEvent`/`emitProgress` writer coalescing + `setProgressClock` test hook, `eventsSince` paging, over a real temp SQLite | `src/__tests__/job-control.test.ts` |
| source versioning | `recordVersion` / `listVersions` / `getLatestVersion` / `readVersionPages` over a real temp SQLite + LocalStore | `src/__tests__/source-versions.test.ts` |
| claims & evidence anchors | `createClaim` / `saveClaimFromMessage` / `listClaims` + `evidence.open` over a real temp SQLite + LocalStore | `src/__tests__/claims.test.ts` |
| change review | `scanForStaleness` (hooked into `recordVersion`) / `resolveReview` / `listPendingReviews` over a real temp SQLite + LocalStore | `src/__tests__/change-review.test.ts` |
| ai providers | `PRESETS` / `ProviderConnection` / `resolveCapabilities` per-capability resolution + `setOfflineMode` call-time blocking over a real temp SQLite, SDK mocked | `src/__tests__/providers.test.ts` |
| provider secret channel | engine-side `requestSecretViaHost` / `resolveSecretResponse` demux over the NDJSON `secret_request`/`secret_response` frames against a fake host | `src/__tests__/providers-protocol.test.ts` |
| provider connection test | `handleEngineRequest("providers.test")` side-effect-free probes over pending config (SDK + fetch mocked) | `src/__tests__/providers-protocol.test.ts` |
| provider run telemetry | `recordProviderRun` / `pruneProviderRuns` over a real temp SQLite (rows carry honest nulls, never prompt text) | `src/__tests__/provider-runs.test.ts` |
| inspectable calculations | `runCalculation` / `listCalculations` + `calculations.run` / `calculations.list` over a real temp SQLite + LocalStore | `src/__tests__/calculations.test.ts` |
| file re-import as version | `sources.reimportVersion` op: changed bytes re-run processing on the SAME source (version + staleness scan via the recordVersion hook), identical bytes answer `{unchanged:true}`, missing source is a typed `not_found`; `claims.create` accepts `anchors` | `src/__tests__/source-reimport.test.ts` |
| csv import pipeline | `sources.importFile` (csv) → `runProcessingJob` → `{kind:'sheet'}` sidecar → `calculations.run` end to end | `src/__tests__/source-reimport.test.ts` |
| media time-range evidence | `transcribeMedia` per-segment timing (CBR byte size) + `{kind:'media'}` version sidecar + 1 chunk per segment + `time_range` anchors over a real temp SQLite + LocalStore (fake muxer + fake transcriber) | `src/__tests__/media-evidence.test.ts` |
| portable research package | `exportNotebook` / `importNotebook` (formatVersion 2 manifest: sha256 per file, source versions + sidecars, claims/anchors/links/reviews/calculations, exclusion note, `{includeOriginals}` metadata-only mode) + `notebook.export` / `notebook.import` ops over a real temp SQLite + LocalStore | `src/__tests__/notebook-transfer.test.ts` |

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
