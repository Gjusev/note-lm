# Multi-provider AI layer (config-driven capability resolution)

> **Status: PROPOSAL — research-backed, NOT implemented.** Authored in English as an
> engineering proposal; product specs under `docs/specs/` remain the user-authored
> source of truth. This document is a decision draft for the owner.
> Derived from a design + critique + library-verdict research pass over the current
> tree (`src/engine/capabilities.ts`, `src/lib/openai.ts`, `src/engine/protocol.ts`,
> `src-tauri/src/engine.rs`, `src/engine/main.ts`).

## Executive summary

The existing AI seam is already right: `resolveCapabilities()` returns flat injected
functions, local llama.cpp already speaks the OpenAI wire protocol, and the ponytail
note in `src/lib/openai.ts` anticipated this exact change ("per-capability provider
registry ... when a second provider is actually added"). The proposal makes capability
resolution config-driven (settings rows `ai.chatProvider` etc.) with one OpenAI-compat
client factory plus a preset catalog, and adds no runtime dependency. Library verdicts:
**LiteLLM — adopt-idea-only** (no official JS SDK; Python SDK + proxy violate the
no-Python/no-PATH rule; adopt its provider config model instead), **Langfuse —
adopt-idea-only** (self-host stack cannot ship in a Tauri installer; adopt local
tracekeeping and, later, opt-in OTLP export), **LangGraph — skip** (~17 MB of
node_modules duplicating the SQLite job/checkpoint model; the PageIndex SDK already
brings its own agent loop).

## Verdicts

| Library | Verdict | Why |
| --- | --- | --- |
| LiteLLM | adopt-idea-only | No official LiteLLM JS SDK exists — BerriAI's docs tell JS users to run the Python proxy and point the OpenAI SDK's `baseURL` at it. Bundling means an embedded Python runtime + FastAPI proxy (hundreds of MB in the NSIS installer, a second always-on process), violating the hard rule "no Python at runtime, nothing on the user's PATH". Supply-chain record is bad for shipped desktop software: March 2026 PyPI compromise of litellm 1.82.7/1.82.8 (credential-stealing payload) plus CVE-2026-49468. **Idea adopted:** its config schema (`model_list → {model_name, model, api_base, api_key}`) collapses to a per-capability `{provider, model, baseUrl, key}` registry — the thing `src/lib/openai.ts` already points at. Its router/fallback features are rejected (product rule: no silent fallback). |
| Langfuse | adopt-idea-only | Langfuse v3+ self-host is Postgres + ClickHouse + Redis + S3/MinIO plus web/worker containers (~4 vCPU / 16 GB) — server infrastructure that cannot ship inside the installed Tauri app. No embedded mode exists; the JS SDK is only an outbound HTTPS reporter, so default use would egress every prompt off the machine, contradicting local-first data minimization. License is not the blocker (MIT core, kept post-ClickHouse acquisition). **Idea adopted:** per-call tracekeeping in a local SQLite table, with opt-in OTLP/HTTP export as a later add-on. |
| LangGraph | skip | `@langchain/langgraph` 1.4.18 drags `@langchain/core` (7.28 MB + langsmith/js-tiktoken/p-queue/mustache), the SDK (4.73 MB) and checkpoint/protocol packages — ~17 MB node_modules, ~1–3 MB minified even after tree-shaking, for what is two HTTP calls wrapped in a loop. Its checkpointer snapshots graph state per super-step into its own store, duplicating the SQLite `job_events`/checkpoint model in `src/engine/jobs.ts` (leaseToken fencing, lane caps, priority, global pause) with no lease/priority semantics — two sources of truth for "where did this work stop". The PageIndex SDK already ships its own agent loop, so LangGraph would be a second agent framework in one esbuild sidecar. |

## The design

### Verified baseline (what already exists)

- `src/engine/capabilities.ts` — `resolveCapabilities()` returns `{chat, chatProvider: "local"|"remote", embed}`; the local/remote choice is currently *inferred* from env/files, not chosen by the user. Embeddings are local-only. `setCapabilitiesForTests` is the existing test seam.
- `src/lib/openai.ts` — single OpenAI SDK client cached in one module-level variable for the process lifetime; env vars pick models.
- `src/lib/ai/llama-supervisor.ts` — llama-server already serves `/v1/chat/completions` + `/v1/embeddings`. All local inference is OpenAI-compatible.
- `src/lib/services/chat.ts`, `materials.ts` — transport-agnostic; receive `chat` (and `tts`) injected. The one exception: `src/lib/ingestion/process.ts` imports `transcribeAudio` directly — transcription is the only capability not injected.
- `docs/specs/desktop-tauri-plan.md` §4 already specifies per-capability provider settings (provider, baseUrl, model, key), a test-connection button, OS-keyring secrets written from Rust, secrets never in React/argv/exports, no required env vars.
- `docs/specs/local-ai-rag-plan.md` already defines the three modes (Local / Mixed / Per task), "no silent substitution", and "show where it is processed" per task.

Base decision: **the interface is correct; only capability resolution must become config-driven, and one OpenAI-compat factory replaces the hardcoded client.**

### Provider model

```ts
// src/lib/ai/providers.ts
type CapabilityKind = "chat" | "embed" | "transcribe" | "tts";
type ProviderId = "local-llamacpp" | `compat:${string}`;
interface CapabilitySetting { provider: ProviderId; model: string }
```

- **`local-llamacpp`** — factory wrapping the existing `LlamaHandle`. Unchanged.
- **`compat:<preset>`** — factory building `new OpenAI({ apiKey, baseURL })`. Covers OpenAI, OpenRouter, Groq, Mistral, Together, DeepSeek, xAI, Ollama (`http://localhost:11434/v1`), LM Studio — plus **Anthropic** (`api.anthropic.com/v1`, OpenAI-SDK compatibility layer) and **Gemini** (`generativelanguage.googleapis.com/v1beta/openai/`). Both verified (Sep 2026) to ship OpenAI-compat layers.
- **Nuance (from the critique):** Anthropic/Gemini compat layers are vendor shims, not contracts. Anthropic positions its layer for testing/migration; Gemini's shim is chat-centric with partial parity, and third parties report breaks on its embeddings path. Both presets are labeled as compat shims in the UI, and the `providers.test` embed-dimension probe catches shim breakage mechanically. The honest future trigger for a native Anthropic adapter is **prompt caching cost** (a real RAG saving unreachable through the shim), not generic "tooling".
- **Native adapters: none in v1.** The preset catalog is the extension mechanism. If only Claude is ever demanded, one `@anthropic-ai/sdk` module behind the existing `ChatFn` seam is the whole diff.
- **Catalog** — packaged `src/lib/ai/provider-presets.json`: `{ name, label, baseUrl, capabilities: [...], authHeader: "bearer" }`. It declares which presets offer embeddings (OpenAI, Mistral, Together, Ollama, LM Studio, Gemini do; OpenRouter and Groq chat presets do not), so the UI never offers an embed config for a provider without embeddings. A custom provider is a `compat:custom` preset with a user-typed baseUrl.

### Config

- Settings rows (existing table, JSON values, no schema migration): `ai.chatProvider`, `ai.embedProvider`, `ai.transcribeProvider`, `ai.ttsProvider` → `{provider, model}`. Presets live in code; user choice + per-capability baseUrl override live in settings.
- Mode rule (local/mixed/offline) is not a separate row: it is derived from the four rows plus an `ai.offline` switch.
- Existing `ai.chatModelId`/`ai.embedModelId` rows migrate once (in `resolveModelPaths`) into `ai.chatProvider = {provider: "local-llamacpp"}` representations; no caller changes.
- Per task ≡ per capability here (Q&A chat and summary chat share one row). UI copy states "Per task = per capability"; revisit trigger: two chat tasks needing different providers.

### Resolution and failure semantics

- `resolveCapabilities()` keeps its signature and return; services keep receiving flat injected functions. What changes is where the settings rows are read. `chatProvider: "local"|"remote"` becomes `provider: {kind, label}` (label: "Auf diesem Computer" or "OpenRouter · openai/gpt-oss-20b"); `chat.send` already returns a provider payload — extend it; existing readers stay compatible via `kind`.
- `ChatFn` gains an optional `AbortSignal` parameter. Stated honestly: a mechanical type change across services/mocks (the existing 120s `AbortSignal.timeout` in `chatCompletion` makes it worthwhile), not a no-op.
- **No silent fallback:** a capability without configuration is `null` / a typed `no_provider` error *naming the capability* ("Transkription benötigt einen Anbieter — Einstellungen → KI"). A failing provider surfaces that provider's error; nothing failovers. This replaces the current env-based local→remote fallback (`capabilities.ts` lines 102–111).
- **Offline switch enforced at call time.** Resolution-time checks only relabel in-flight work: queued and running remote jobs keep their previously resolved `ChatFn`/`EmbedFn`. The offline flag is read *inside* the capability wrapper at call time (one boolean read → throw `offline_blocked`), and the job-claim loop filters remote lanes while paused, mirroring `scheduler.paused`.
- **Transcribe injection fix:** `src/lib/ingestion/process.ts` takes an injected `transcribe` from the job pool exactly like `chat` — routing transcription through the same capability resolution and killing the module-level `transcribeAudio` mocks in `engine-pool`/`engine-imports`.

### `providers.test` op and egress disclosure

`providers.test` (dispatch op; args carry the pending settings-form config + which secret to use — never the key itself):

| Capability | Probe | Returns |
| --- | --- | --- |
| chat | `GET /models`, then one 1-message completion with bounded `max_tokens` | ok, latency, model list |
| embed | embed `"ping"` | ok, **dimension** |
| transcribe | POST a ~1 kB silent WAV to `/v1/audio/transcriptions` | ok, latency |

- Note: a plain `GET /models` passes for keys without audio access on OpenAI/Groq — hence the real transcribe probe.
- Error codes: `auth_failed`, `bad_base_url`, `timeout`, `capability_unsupported`, `offline_blocked`, surfaced with the provider name ("Verbindung mit OpenRouter fehlgeschlagen: 401").
- Synergy: a successful embed probe returns the dimension → the configure flow registers/updates the `embedding_profile` and deactivates `retrieval.activeProfile` on provider change — the same rule `models.select` already applies for a new local embeddings model, so old vectors are never queried under a new provider. Because re-embedding the whole corpus through a paid API has real cost, the switch shows a confirmation dialog ("N Vektoren werden neu erzeugt via `<provider>` (kostenpflichtige API)").
- **Egress disclosure chips:** every task that calls a capability shows its `provider.label` chip ("Auf diesem Computer" extends to "Gesendet an OpenRouter · Modell X"); offline mode makes remote capabilities visibly unavailable. `diagnostics.capabilities` is the "where is it processed" output: per capability `{configured, kind, label, model}` — one op feeding both the settings page and the chips.

## Secrets and keyring: the `secret_request` protocol half

The design doc originally called this "one new message type"; the critique is right that it is a real protocol half, and it is specified here as such.

**Wire contract** (extends the NDJSON protocol; engine-initiated, host-answered):

```
engine → host:  {"t":"secret_request","id":"<uuid>","provider":"compat:openrouter"}
host  → engine: {"id":"<same uuid>","ok":true,"result":{"value":"sk-..."}}   // granted
                {"id":"<same uuid>","ok":true,"result":{"value":null}}       // denied/absent
```

- **Correlation:** responses are matched by `id`. The host must demultiplex — an in-flight host→engine request's reply and an engine→host `secret_request` can interleave on the same stdio pair. Today neither side can do this: `src-tauri/src/engine.rs` (`Engine::request`) writes one request and reads exactly one stdout line, so an engine-initiated frame would be consumed as the response ("bad engine frame" or a silent id misassignment); and the engine's decoder (`src/engine/main.ts:20-24`) drops any frame without `id`+`op`. Demultiplexing (pending-request map keyed by `id`, unknown-id frames to stderr) is implemented and tested in **both** hosts: the Rust engine bridge and the TS dev/e2e host.
- **Timeout: 2–5 s.** A `secret_request` with no correlated response in that window fails the capability as `secret_unavailable` — a job segment must never hang on a missing secret.
- **Grant policy (Rust side):** only providers the user actually configured are grantable. Rate-limited: one pending request per job segment. Every grant is logged (provider name + requesting op — never the value). The key never appears in `providers.list`, in `providers.test` results, in exports, or in SQLite.
- **Dev paths:** `OPENAI_API_KEY` env remains supported for Next dev (compat delegation). Without keyring: session-only key entry with an explicit notice — never silently persisted plaintext.
- **Residual risk, stated honestly:** a compromised engine process can request and obtain keys — the same exposure `OPENAI_API_KEY` in the environment has today; the protocol raises the bar for *accidental* access, not for a fully compromised engine. If the threat model hardens later, the escape hatch is performing the provider HTTPS call inside Rust (keys never enter the Node engine at all) — not more protocol framing.

## Client caching

`src/lib/openai.ts` caches one client in a module-level variable for the process lifetime; correcting a bad key or switching providers keeps serving the stale client (401s) until engine restart — today's bug this design must not replicate. Rule: build the client **per resolution** from a fully-read config row (per-request resolution is already the `dispatch.ts` pattern), or at most cache by config hash `(provider, model, baseUrl, keyHash)`. The single `cached` value is deleted.

## Observability

- **v1 core:** a local SQLite `provider_runs` table written at the capability seam — `(capability, provider, model, latency, tokens, error)` — **no prompt text**, with retention pruning. It mirrors the existing `job_events` pattern. An in-app usage/cost viewer comes later; `response.usage` already travels back on every chat call, so adding token accounting later is an insertion at this seam, not a change to it.
- **Later add-on (explicitly deferred):** opt-in OTLP/HTTP export — a ~50-line `fetch` wrapper, **no OTel SDK dependency** — to a user-configured endpoint. Langfuse, Phoenix and LangSmith all ingest OTLP at `/api/public/otel/v1/traces` with Basic auth, so power users can point the app at their own instance. OFF by default; requires explicit user confirmation; the endpoint and key are the user's own. The critique holds: nobody self-hosts Langfuse to take notes, so the export hook ships only after `provider_runs` proves the local need — the local table is the v1 deliverable.

## Migration path — three vertical slices (TDD, each ending green)

**S1 — config-driven resolution + compat factory + presets + `no_provider` errors + client-cache fix.**
Files: new `src/lib/ai/providers.ts` (types, `compat:` factory, `makeLocal()` wrapping `LlamaHandle`); `src/lib/ai/provider-presets.json`; `src/engine/capabilities.ts` (reads `ai.chatProvider`/`ai.embedProvider`; env fallback preserved so existing Next dev paths and e2e stay untouched); `src/lib/openai.ts` becomes thin delegates (keeping `chatCompletion`/`transcribeAudio`/`generateEmbedding` aliases — `chat-evidence.test.ts` mocks that module path); cache fix. New test seam registered in `CONTEXT.md` **before** its first test (repo TDD rule): preset resolution, auth-header shape, provider-naming errors, no-silent-fallback against a fake `/v1` server (injected fetch).

**S2 — keyring `secret_request` protocol + `providers.test` op + settings UI screen.**
Files: `src/engine/protocol.ts` (`secret_request` frame type + id demultiplexing); `src-tauri/src/engine.rs` (read side able to answer engine-initiated frames; grant policy, logging); dev-host responder in `src/engine/main.ts`; `src/lib/services/providers.ts` (get/set per capability, secrets by name only); `src/engine/dispatch.ts` (`providers.list` / `providers.configure` / `providers.test`; extended `diagnostics.capabilities`; `chat.send` provider payload); Rust keyring commands (plan §4); settings UI screen (per capability: preset/baseUrl/model/key, "Verbindung testen", egress chips). Tests: protocol codec `secret_request` cases incl. interleaving + unknown-id + timeout in both hosts; dispatch `providers.test` with mocked fetch; `offline_blocked`; embed probe returns dimension and deactivates the active profile.

**S3 — offline enforcement at call time + transcribe injection + egress chips + `provider_runs`.**
Files: `src/lib/ingestion/process.ts` + `src/engine/jobs.ts` (inject `transcribe` from capabilities); call-time offline read inside capability wrappers + remote-lane filtering in the claim loop; egress chip rendering; `provider_runs` table + retention pruning; `docs/specs` + `CONTEXT.md` updated. Tests: job pool running with a fake injected transcriber; call-time offline throws for in-flight-style remote jobs; `provider_runs` records tokens/error without prompt content; zero telemetry traffic when unconfigured (network-assertion test).

## Explicit non-goals

- **No router/failover.** Product rule: no silent fallback — a failing provider is an error naming that provider, never a switch.
- **No LangGraph.** Revisit trigger only: a real multi-step flow needing >3 conditional branches *plus* cross-session resumable human-in-the-loop that the jobs/lease model cannot express.
- **No telemetry egress by default.** The OTLP hook is a later, opt-in, user-endpoint add-on.
- Also out of scope in v1: native Anthropic/Gemini adapters, streaming, per-notebook keys, usage billing.

## Decision requested

- **Option A — adopt the design as specified; start S1** (config-driven resolution + compat factory + presets + `no_provider` + cache fix, TDD, seam registered in `CONTEXT.md` first).
- **Option B — adjust** (e.g. defer S2's keyring work, reorder slices, change preset scope) before any slice starts.

No code changes until the owner picks A or B.

### References

Anthropic OpenAI-SDK compatibility (docs.anthropic.com/en/api/openai-sdk) · Gemini OpenAI-compatible endpoint (ai.google.dev/gemini-api/docs/openai) · LiteLLM (docs.litellm.ai) · Langfuse self-host requirements (langfuse.com/docs) · LangGraph JS (langchain-ai.github.io/langgraphjs) · keyring crate (docs.rs/keyring)
