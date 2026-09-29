# Contributing to noteLm

Thanks for considering a contribution. Read [ARCHITECTURE.md](ARCHITECTURE.md)
for how the pieces fit and [CONTEXT.md](CONTEXT.md) for the domain vocabulary
and the agreed test seams.

## Setup and build (Windows-first)

```bash
npm ci                  # Node 22+ (the desktop build pins its own runtime via scripts/fetch-node.mjs, default 22.14.0)
npm run setup:local     # verifies the runtime, prepares the data dir
npm run build           # Next.js production build
npm run start:local     # starts server + worker on 127.0.0.1 and opens the app
npm run dev             # or plain dev mode while iterating
```

Data lives in `%APPDATA%/note-lm` (override with `NOTELM_DATA_DIR`). The app
listens on loopback only; AI keys are optional per capability (see
`.env.example`) — without any key, notebooks, imports, notes and local search
still work.

## Tests

```bash
npm test                          # vitest: units/components against real SQLite (temp data dirs)
npm run test:e2e                  # spawns the real worker against real SQLite + a local resource server
cd src-tauri && cargo test        # Rust side (engine_data_dir, path_within_base)
node scripts/generate-samples.mjs # regenerates the bundled sample PDFs (deterministic)
```

`npm run verify:desktop` is the full pipeline: 16 gates in sequence —
typecheck, unit tests, engine e2e, engine/Node/FFmpeg/llama.cpp pinned-binary
fetches, cargo build, dev smoke on a Node-stripped PATH, desktop UI build,
NSIS installer build, silent install, installed smoke (clean PATH), two
interruption/recovery gates (kill + restart, pause survives restart) and
uninstall with process-teardown assertions. `--only=<substring>` filters
gates. It is slow; run the individual commands above while developing.

## How we write code

- **TDD at the seams in [CONTEXT.md](CONTEXT.md).** A seam is added to
  CONTEXT.md *before* its first test; test at the public interfaces listed
  there, never at internals. Red → green, one vertical slice per cycle.
- Expected values come from worked examples in the specs, never recomputed
  the way the code does; logic tests use deterministic fakes, real pinned
  models only for distribution validation.
- Changes to retrieval or evidence behavior should come with eval coverage
  (`eval/`, see below) — measure it, do not argue it.

## Commits and PRs

Conventional commits, English subject lines, one logical change per commit —
matching the existing history: `feat:`, `fix:`, `test:`, `docs:`, `eval:`
(see `git log`). PRs: keep them reviewable, describe what you measured, and
include fixtures/contracts for anything behavioral (see below).

## What we want help with right now

From docs/specs/open-source-innovation-strategy.md section 8, the first
external-contribution surfaces are:

1. **Import adapters** — new source types (file formats, export formats of
   other tools). Ship the adapter plus a minimal fixture and the processing
   path it exercises; the versioned-evidence invariants (immutable
   `source_versions`, honest anchors) must hold.
2. **Extractors** — PDF/OCR/audio improvements. Eval cases with expected
   evidence belong in `eval/`; an extractor PR that regresses the benchmark
   numbers needs the regression explained, not hidden.
3. **Export formats** — extensions of the portable research package
   (manifest versioning, sha256-per-file provenance). Extend
   `src/__tests__/notebook-transfer.test.ts` before the format.
4. **Eval cases** — new corpora questions, change-review pairs or benchmark
   arms. Follow `eval/README.md` ("How to add cases"): synthetic or
   redistributable documents, expected evidence recorded with the question,
   negative results included.

Every extension declares what it touches (network, files, notebooks); the
engine's job queue, permission controls and evidence format are not optional
shortcuts, and MCP or any tool protocol does not substitute for them.

## License

The project is MIT-licensed (see [LICENSE](LICENSE)) — contributions are
accepted under the same. **New dependencies need license review** before
merging: permissive licenses (MIT/Apache-2.0/BSD/ISC) are fine; copyleft
(GPL/AGPL/SSPL) and no-attribution or noncommercial terms are not.
