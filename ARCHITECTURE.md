# Architecture (one page)

A local-first research notebook. Domain vocabulary and the agreed test seams:
[CONTEXT.md](CONTEXT.md). Long-form plans and decision records:
[docs/specs/](docs/specs/) — start with `local-app-plan.md` (the conversion to
a local app), `desktop-workers-plan.md`, `pageindex-integration-plan.md` and
`open-source-innovation-strategy.md`.

## Engine over stdio

The desktop app is a Tauri shell (`src-tauri/`) plus a Node **engine**
(`src/engine/`) spawned as a child process and spoken to over **NDJSON on
stdio** (`src/engine/protocol.ts` is the codec; `dispatch.ts` routes ops).
All storage and processing live in the engine process; the Rust side holds
the window, tray, and the data-dir the engine runs against
(`engine_data_dir` mirrors `resolveDataDir` in `src/db/local/index.ts`).
Every op is a request/response frame — the same ops the web app exercises
through `handleEngineRequest`, which is why `src/__tests__/engine-*.test.ts`
can test everything without spawning anything.

## SQLite and migrations

One SQLite database (better-sqlite3 + Drizzle, WAL) in the data dir. Schema
and forward-only migrations: `src/db/local/{schema,migrations}.ts`, applied
on open; FTS5 for keyword search, sqlite-vec (`vec0`) tables for embeddings.
Original bytes, transcripts and generated audio are files on disk under
`files/`, referenced by rows; the DB is never the only copy of user content.

## Workers, jobs, intents, events

Background work runs through persistent, **lease-fenced job queues**
(`src/engine/jobs.ts`, `src/engine/imports.ts`, `src/engine/processing.ts`):
import jobs (URLs: page → resources → downloads; ffmpeg for A/V) and
processing jobs (extract/transcribe → chunk → index). Jobs carry an
**intent** (`run` / `pause` / `cancel` — `setJobIntent`): pause releases the
lease back to `queued`, cancel marks the row, and a crash mid-download
resumes from partial bytes on disk. Progress flows out as coalesced job
events (`emitJobEvent`/`emitProgress`, paged via `eventsSince`) that the UI
reconnects to. `workers/ingestion.ts` is the standalone Node worker used by
`npm run start:local` / `npm run worker`.

## Versioned evidence model

The chain that makes citations durable, defined in [CONTEXT.md](CONTEXT.md):

```
sources → source_versions → anchors → claims → review proposals
```

- **SourceVersion** — immutable snapshot of a source's original bytes + page
  texts; re-importing changed bytes APPENDS a version, nothing is destroyed.
- **Evidence anchor** — points to an immutable version row plus a locator
  (page when truly known, `null` otherwise) and the quoted text; citations
  must reference evidence that was actually in context.
- **Claim** — a statement with an honest status, never a model-granted
  "verified" label.
- **Review proposal** — the deterministic staleness finding (`quote_moved` /
  `quote_missing`) raised by `scanForStaleness` when a new version changes an
  anchored quote. It flags changed inputs, never proves a conclusion false;
  resolving keeps the full history. Experiments E1/E2 grade exactly this
  (`eval/reports/e1-e2-change-review.md`).

## Provider seam

AI capabilities resolve through explicit config — a **preset** (code: how to
talk), a **connection** (settings instance) and a **capability** mapping
(`{connectionId, model}`, never inferred); local llama.cpp is the default
when no remote config exists (`src/lib/ai/providers.ts`,
`src/lib/services/embedding-profiles.ts`). Secrets cross host → engine only
through the correlated `secret_request`/`secret_response` stdio channel
(`src/engine/secrets.ts`), never in logs. Offline mode blocks remote calls
at call time; local calls are never blocked. Provider runs are recorded as
telemetry rows with honest nulls, never prompt text.

## Eval harness

`eval/` is the open benchmark (see [eval/README.md](eval/README.md)):
deterministic synthetic corpora with generators + validators, the retrieval
harness (`eval/harness/run-retrieval-eval.mts` — variant registry where the
FTS, hybrid and PageIndex arms plug in), the E1/E2 change-review suite, and
`npm run eval:benchmark` as the single entry point. Results — including the
negative ones, e.g. the recorded PI-2 "do not adopt" decision — live under
`eval/reports/` and `eval/harness/results/`.
