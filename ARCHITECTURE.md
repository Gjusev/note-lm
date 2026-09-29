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

## Implementation status

Three delivery levels: **PROBADO DESDE INSTALADOR** (asserted against the
packaged app by `npm run verify:desktop` — `scripts/desktop-verify.mjs`, 17
gates from typecheck through NSIS silent install/uninstall, all on a PATH
stripped of Node), **IMPLEMENTADO** (in code and covered by unit/e2e suites,
not yet asserted from the installer), **PENDIENTE**.

**PROBADO DESDE INSTALADOR** (all via the `--smoke` self-check in
`src-tauri/src/main.rs` plus the headless engine gates in the verify script):

- Engine/SQLite/typed errors: protocol round trip, sqlite-vec loaded, unknown
  op answers `unknown_op` — gate `installed smoke`.
- Claims flow roundtrip: create → list → empty reviews → fabricated anchor
  answers `not_found` — gate `installed smoke`.
- Provider/model flow: curated catalog and presets ship in the bundle, the
  offline probe answers `offline_blocked`, a refused loopback endpoint answers
  `bad_base_url` from packaged resources; the keyring channel is exercised on
  this same probe path — gate `installed smoke`.
- Samples bundled (the two redistributable sample PDFs) +
  `sources.reimportVersion` op presence — gate `installed smoke`.
- Interruption recovery: kill mid-download leaves a resumable partial, restart
  completes the import; a paused job survives restart and resumes to
  completion — gates `installed recovery`, `installed pause survives restart`.
- Full user walkthrough end to end: URL import (source + chunks + immutable
  v1), anchored claim, changed re-import of the SAME url appends v2 and
  raises the staleness proposal, typed `not_a_sheet` over the page source,
  CSV import + deterministic sum calculation, engine killed mid-download and
  resumed after restart, export/import round trip into a fresh data dir
  (claims, versions, proposals, calculation ride along), chat without a
  configured provider answers the typed `no_provider` — gate `installed
  walkthrough`.
- NSIS silent install/uninstall with full engine process teardown — gates
  `silent install`, `uninstall + process teardown`.

**IMPLEMENTADO** (unit/e2e-tested, not asserted from the installer):

- Claim provenance stamping at retrieval time — `src/__tests__/claims.test.ts`.
- Durable review scans + reconciliation ledger — `src/__tests__/change-review.test.ts`.
- Materials dispatch consolidation + busy guard — `src/__tests__/engine-dispatch.test.ts`.
- Calculations engine ops — `src/__tests__/calculations.test.ts`.
- Time-range media anchors — `src/__tests__/media-evidence.test.ts`.
- Portable packages, formatVersion 2 incl. metadata-only — `src/__tests__/notebook-transfer.test.ts`.
- Reliability: worker shutdown drains in-flight lanes before closing SQLite —
  engine-pool regression test + zero-occurrence greps
  (`src/__tests__/engine-pool.test.ts`); import confinement + staged atomic
  rollback on restore — `src/__tests__/notebook-transfer.test.ts`; chunk
  provenance (chunks carry the version that produced them, migration 0013) —
  `src/__tests__/chunk-provenance.test.ts`.
- In-app evidence reader and materials UI wired in the desktop frontend
  (`vite build` green) — `src/desktop/src/components/EvidencePanel.tsx`,
  `src/desktop/src/screens/NotebookWorkspace.tsx`; manual click-through
  verification still pending as before.
- Versioned-source UI (Neue Version, Versions expander, Berechnungen tab,
  EvidencePanel) — `src/desktop/src/screens/NotebookWorkspace.tsx`,
  `src/desktop/src/components/EvidencePanel.tsx`; ops underneath in
  `src/__tests__/source-reimport.test.ts`.
- Multi-provider S1–S3 resolution/offline/telemetry (keyring covered above
  from the installer; the rest unit-level) — `src/__tests__/providers.test.ts`,
  `providers-protocol.test.ts`, `provider-runs.test.ts`.
- Local whisper.cpp transcription (managed runtime): `whisper-local` preset +
  catalog `transcribe` models (ggml-tiny/base, HF-hash-verified), local
  TranscribeFn never offline-blocked with provider_runs telemetry, runWhisper
  over the pinned v1.9.2 win-x64 build (real-binary smoke in-suite) —
  `src/__tests__/whisper.test.ts`, `src/lib/ai/whisper.ts`.
- Change-review experiments E1/E2 — fixture-level, synthetic; real-document
  precision NOT demonstrated (`eval/reports/e1-e2-change-review.md`).

**PENDIENTE:**

- In-app PDF page rendering — the evidence panel shows quote + locator, no
  page image (`src/desktop/src/components/EvidencePanel.tsx`).
- Local TTS — `tts` capability typed but unresolvable
  (`src/lib/ai/providers.ts`); local ASR landed (whisper.cpp: `whisper-local`
  preset, catalog `transcribe` models, `src/lib/ai/whisper.ts`). Runtime via
  `npm run fetch:whisper` / `NOTELM_WHISPER_DIR` (no installer bundling);
  models download on demand via the catalog + `models.download` capability
  `transcriptions`.
- E3 human pilot; I5/I6 gated experiments (adaptive router, visual retrieval,
  RLM, collaboration — each behind registered criteria) —
  [docs/specs/open-source-innovation-strategy.md](docs/specs/open-source-innovation-strategy.md).
- VM-clean run + code-signing for distribution — the verify script's stripped
  PATH is the current stand-in for a clean machine.
