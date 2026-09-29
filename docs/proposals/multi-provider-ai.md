# Multi-provider AI layer (config-driven capability resolution)

> **Status: DECIDED — adopt with adjustments. S1 in progress.** The owner adopted the
> design with binding adjustments, folded into this document in place (Sep 2026).
> Product specs under `docs/specs/` remain the user-authored source of truth.
> Derived from a design + critique + library-verdict research pass over the current
> tree (`src/engine/capabilities.ts`, `src/lib/openai.ts`, `src/engine/protocol.ts`,
> `src-tauri/src/engine.rs`, `src/engine/main.ts`).

## Executive summary

The existing AI seam is already right: `resolveCapabilities()` returns flat injected
functions, local llama.cpp already speaks the OpenAI wire protocol, and the ponytail
note in `src/lib/openai.ts` anticipated this exact change ("per-capability provider
registry ... when a second provider is actually added"). Capability resolution becomes
config-driven (settings rows `ai.chatProvider` etc.) with one OpenAI-compat client
factory plus a preset catalog, no new runtime dependency. Binding adjustments:
**offline call-time blocking ships in S1**; provider / connection / capability are
separate entities (every custom connection is its own instance with its own ID);
catalog v1 is managed llama.cpp + OpenAI + OpenRouter + custom compat connection —
OpenRouter does offer embeddings (openrouter.ai docs), Anthropic-via-compat is
EXPERIMENTAL; `ChatFn` gets a **normalized result** (it returns `Promise<string>`
today and drops usage); `providers.test` is strictly side-effect-free; the secret
channel ships with a test matrix; LiteLLM is discarded for unnecessary complexity —
not a general Python ban, a packaged Python helper remains evaluable for PageIndex —
and OTLP export is out of the initial scope entirely.

## Verdicts

| Library | Verdict | Why |
| --- | --- | --- |
| LiteLLM | discard | No official LiteLLM JS SDK exists — BerriAI's docs tell JS users to run the Python proxy and point the OpenAI SDK's `baseURL` at it. Shipped in a Tauri installer that is an embedded Python runtime + a second always-on process: unnecessary complexity for what is one `fetch` with a `baseURL`. **Scope correction:** the hard product rule is that the *user installs and manages no runtimes* — it is **not** a general Python ban; a **packaged** Python helper (bundled, not on the user's PATH) remains evaluable for PageIndex. Supply-chain note stands as packaging due-diligence: March 2026 PyPI compromise of litellm 1.82.7/1.82.8 (credential-stealing payload) plus CVE-2026-49468. **Idea adopted:** its config schema (`model_list → {model_name, model, api_base, api_key}`) collapses to a per-capability `{connectionId, model}` registry. Router/fallback rejected (no silent fallback). |
| Langfuse | idea-only | Langfuse v3+ self-host is Postgres + ClickHouse + Redis + S3/MinIO plus web/worker containers (~4 vCPU / 16 GB) — server infrastructure that cannot ship inside the installed Tauri app; the JS SDK is only an outbound HTTPS reporter, so default use would egress every prompt off the machine, contradicting local-first data minimization. **Scope correction:** OTLP export is out of the initial scope entirely — OTLP receivers (Langfuse, Phoenix, LangSmith) each define their own endpoints/auth, and no claim is made that they share one configuration. The v1 deliverable is a local `provider_runs` table; any export is a separate later decision. |
| LangGraph | skip | `@langchain/langgraph` 1.4.18 drags `@langchain/core` (7.28 MB + langsmith/js-tiktoken/p-queue/mustache), the SDK (4.73 MB) and checkpoint/protocol packages — ~17 MB node_modules, ~1–3 MB minified even after tree-shaking, for what is two HTTP calls wrapped in a loop. Its checkpointer snapshots graph state per super-step into its own store, duplicating the SQLite `job_events`/checkpoint model in `src/engine/jobs.ts` (leaseToken fencing, lane caps, priority, global pause) with no lease/priority semantics — two sources of truth for "where did this work stop". The PageIndex SDK already ships its own agent loop. |

## The design

### Verified baseline (what already exists)

- `src/engine/capabilities.ts` — `resolveCapabilities()` returns `{chat, chatProvider: "local"|"remote", embed}`; the local/remote choice is currently *inferred* from env/files, not chosen by the user. Embeddings are local-only. `setCapabilitiesForTests` is the existing test seam.
- `src/lib/openai.ts` — single OpenAI SDK client cached in one module-level variable for the process lifetime; env vars pick models. **`ChatFn` returns `Promise<string>`: usage, finish reason and the effective model id do not cross this layer today.**
- `src/lib/ai/llama-supervisor.ts` — llama-server already serves `/v1/chat/completions` + `/v1/embeddings`; all local inference is OpenAI-compatible.
- `src/lib/services/chat.ts`, `materials.ts` — transport-agnostic; receive `chat` (and `tts`) injected. The one exception: `src/lib/ingestion/process.ts` imports `transcribeAudio` directly — transcription is the only capability not injected.
- `docs/specs/desktop-tauri-plan.md` §4 already specifies per-capability provider settings, a test-connection button, OS-keyring secrets written from Rust, secrets never in React/argv/exports, no required env vars. `docs/specs/local-ai-rag-plan.md` defines the three modes (Local / Mixed / Per task), "no silent substitution", and "show where it is processed" per task.

### Provider / connection / capability — three separate entities

The original `compat:<preset>` id conflated three things; they are separate now:

- **Adapter/preset** (code): *how* to talk. `local-llamacpp` (wraps the existing `LlamaHandle`, unchanged) and `openai-compat` (`new OpenAI({ apiKey, baseURL })`). The preset catalog is the extension mechanism; native adapters: none in v1.
- **Connection** (settings instance): *where* to talk. Its own stable ID, endpoint URL, secret reference, and processing classification (local / remote / self-hosted). One `compat:custom` template does **not** identify multiple custom connections — two LM Studio endpoints are two connections, each independently selectable and testable.
- **Capability** (per task): *what* is used. A connection plus a model plus **verified** capabilities, with provenance: `provider-level` (declared by the vendor for the API), `model-level` (confirmed for this model), `adapter-level` (confirmed through this compat layer). A correct chat response proves nothing about tools, structured JSON, audio, or embeddings; unverified = not offered in the UI.

**Secret–destination binding:** a key is granted to (connection, baseUrl). Changing a connection's `baseUrl` does **not** forward the existing secret to the new destination — the grant goes stale and the connection re-tests and re-authorizes before use. Connection tests run on **pending** form config without saving it.

### Catalog v1

- **Managed** (shipped and supervised by the app): `local-llamacpp`.
- **Presets:** OpenAI (`api.openai.com/v1`), OpenRouter (`openrouter.ai/api/v1`).
- **Custom:** user-defined OpenAI-compat connections (LM Studio, Ollama, Groq, Mistral, Together, DeepSeek, xAI, self-hosted gateways …).
- **Correction:** OpenRouter **does** offer embeddings (openrouter.ai docs list embedding models) — offered with embed capability, verified per model.
- **Anthropic via the OpenAI-compat layer = EXPERIMENTAL.** Anthropic (platform.claude.com docs) positions its OpenAI SDK compatibility mainly as an evaluation/migration path with production limitations; it ships labeled as such and is not in the default catalog. A native adapter may be justified later on two concrete grounds — functional correctness through the shim and prompt-caching cost — not generic "tooling".

### Config

- Settings rows (existing table, JSON values, no schema migration): `ai.chatProvider`, `ai.embedProvider`, `ai.transcribeProvider`, `ai.ttsProvider` → `{connectionId, model}`.
- Mode rule (local/mixed/offline) is derived from the four rows plus an `ai.offline` switch — not a separate provider row.
- Existing `ai.chatModelId`/`ai.embedModelId` rows migrate once (in `resolveModelPaths`) into `local-llamacpp` connection representations; no caller changes.
- Per task ≡ per capability here (Q&A chat and summary chat share one row). UI copy states "Per task = per capability"; revisit trigger: two chat tasks needing different providers.
- **Dev env vars** (`OPENAI_API_KEY`, …) remain supported for Next dev only and **never** override an explicit user selection nor re-activate remote providers in the desktop app — once the user picked (or offline is on), env vars are inert.

### Resolution and failure semantics

- `resolveCapabilities()` keeps its signature and return; services keep receiving flat injected functions. `chatProvider: "local"|"remote"` becomes `provider: {kind, label}` (label: "Auf diesem Computer" or "OpenRouter · openai/gpt-oss-20b"); `chat.send` already returns a provider payload — extend it; readers stay compatible via `kind`.
- **No silent fallback:** a capability without configuration is `null` / a typed `no_provider` error *naming the capability* ("Transkription benötigt einen Anbieter — Einstellungen → KI"). A failing provider surfaces that provider's error; nothing failovers. This replaces the current env-based local→remote fallback (`capabilities.ts` lines 102–111).

### Normalized result contract (correction)

`ChatFn` returning `Promise<string>` discards usage; the earlier draft wrongly claimed `response.usage` already crosses the seam. The capability seam returns:

```ts
interface ChatResult {
  text: string;
  provider: { connectionId: string; model: string };   // what actually answered
  usage?: { inputTokens: number; outputTokens: number };
  finishReason?: string;
}
```

- `AbortSignal` is a parameter on `ChatFn`/`EmbedFn` and is propagated to the **real** request, combined with the existing timeout signal and with job cancellation (cancel any → abort all). A mechanical type change across services/mocks; the existing 120s `AbortSignal.timeout` in `chatCompletion` makes it worthwhile.
- `provider_runs` records tokens **only when usage was actually returned** — unknown consumption is logged as unknown (null), **never as zero**.

### Offline policy — blocking from S1

Offline is part of the first increment that can configure remote providers, not a later slice:

- On activation: new remote requests **and retries** are blocked (`offline_blocked`), active remote requests get their `AbortSignal` aborted, and recoverable jobs keep explicit state (e.g. remote-blocked) instead of being silently dropped.
- Honest boundary: data **already sent** to a remote provider cannot be withdrawn; the UI never claims otherwise.
- Enforcement is at **call time** — resolution-time checks only relabel in-flight work, since queued jobs keep their previously resolved functions. The offline flag is read inside the capability wrapper, and the job-claim loop filters remote lanes while paused (mirroring `scheduler.paused`).

### `providers.test` — side-effect-free probes

`providers.test` (dispatch op; args carry the pending settings-form config + which secret to use — never the key itself) runs **without saving config, without invalidating indexes, without triggering reindexing**. Changes apply only on save.

| Capability | Probe | Returns |
| --- | --- | --- |
| chat | one 1-message completion with bounded `max_tokens` | ok, latency |
| embed | embed `"ping"` | ok, **dimension** |
| transcribe | POST a valid audio fixture (~1 kB silent WAV) to `/v1/audio/transcriptions` | ok, latency |
| tts | its own synthesis probe (short fixture) | ok, latency |

- `GET /models` is optional discovery for presets that support it — **not** a universal requirement; and a plain `GET /models` passes for keys without audio access, hence the real transcribe probe with a valid fixture (the ~1 kB silent-WAV note stays).
- Error codes: `auth_failed`, `bad_base_url`, `timeout`, `capability_unsupported`, `offline_blocked`, surfaced with the provider name ("Verbindung mit OpenRouter fehlgeschlagen: 401").
- **Re-embedding rule:** switching the embed provider creates a *new* embedding profile; profile identity = **connection + model + model revision + dimensions + relevant params** — **equal dimensions do NOT make models interchangeable**. Old indexes are kept; the new index activates only when complete and validated. Before a remote reindex the UI shows destination and scope ("N Vektoren werden neu erzeugt via `<provider>` — kostenpflichtige API").
- **Egress disclosure chips:** every task that calls a capability shows its `provider.label` chip ("Auf diesem Computer" extends to "Gesendet an OpenRouter · Modell X"); offline makes remote capabilities visibly unavailable. `diagnostics.capabilities` is the "where is it processed" output: per capability `{configured, kind, label, model}`.

## Secrets and keyring: the `secret_request` protocol half

**Wire contract** (extends the NDJSON protocol; engine-initiated, host-answered):

```
engine → host:  {"t":"secret_request","id":"<uuid>","connectionId":"<id>"}
host  → engine: {"id":"<same uuid>","ok":true,"result":{"value":"sk-..."}}   // granted
                {"id":"<same uuid>","ok":true,"result":{"value":null}}       // denied/absent
```

- **Correlation:** responses matched by `id`; the host demultiplexes — an in-flight host→engine request's reply and an engine→host `secret_request` can interleave on the same stdio pair. Today neither side can do this (`src-tauri/src/engine.rs` `Engine::request` reads exactly one line; the engine decoder at `src/engine/main.ts:20-24` drops frames without `id`+`op`).
- **Test requirements for the channel** (both hosts: Rust bridge and TS dev/e2e host): a persistent reader with demultiplexing by type+id; covered cases: **timeout** (2–5 s → `secret_unavailable`), **process close** (pending requests fail fast), **concurrency** (interleaved frames), **unknown-id responses** (dropped to stderr, never misassigned).
- **Logging:** full frames that could contain secrets are never logged; grants are logged as (connection label + requesting op, never the value). Stable IDs on the wire; human labels only in the UI.
- **Grant policy (Rust side):** only connections the user configured are grantable; rate-limited (one pending request per job segment); the key never appears in `providers.list`, `providers.test` results, exports, or SQLite.
- **Dev paths:** env vars for Next dev only (see Config); without keyring: session-only key entry with an explicit notice — never silently persisted plaintext.
- **Residual risk, stated honestly:** a compromised engine process can request and obtain keys — the same exposure `OPENAI_API_KEY` has today; the protocol raises the bar for *accidental* access, not for a fully compromised engine. Escape hatch if the threat model hardens: perform the provider HTTPS call inside Rust (keys never enter the Node engine).

## Client caching

`src/lib/openai.ts` caches one client for the process lifetime; correcting a bad key or switching providers keeps serving the stale client (401s) until restart. Rule: build the client **per resolution** from a fully-read config row (per-request resolution is already the `dispatch.ts` pattern), or at most cache by config hash `(connectionId, model, baseUrl, keyHash)`. The single `cached` value is deleted. **A key change takes effect without restart — verified in S1.**

## Observability

- **v1 core:** a local SQLite `provider_runs` table written at the capability seam — `(capability, connectionId, model, latency, tokens, finishReason, error)` — **no prompt text**, retention pruning, mirroring the `job_events` pattern. Tokens only when usage was returned (null, never 0, for unknown). The in-app usage/cost viewer comes later; because the normalized `ChatResult` now carries usage, accounting is an insertion at this seam.
- **OTLP export: out of the initial scope entirely** — not deferred-and-planned, simply not part of this proposal. If a future decision wants it, it gets its own proposal: OTLP receivers (Langfuse, Phoenix, LangSmith) each define their own endpoints and auth; no shared configuration can be assumed.

## Migration path — three vertical slices (TDD, each ending green)

**S1 — connections model + config-driven resolution + presets catalog + offline call-time blocking + client-cache fix + normalized ChatResult/AbortSignal + typed `no_provider`.**
Files: new `src/lib/ai/providers.ts` (connection/capability types, `openai-compat` factory, `makeLocal()` wrapping `LlamaHandle`); `src/lib/ai/provider-presets.json`; `src/engine/capabilities.ts` (reads `ai.chatProvider`/`ai.embedProvider`; env fallback only where no explicit selection exists — never overriding one in desktop); call-time offline read inside capability wrappers + remote retry blocking + abort of active remote requests; `src/lib/openai.ts` thin delegates returning `ChatResult` (keeping `chatCompletion`/`transcribeAudio`/`generateEmbedding` aliases — `chat-evidence.test.ts` mocks that module path); cache fix. New test seam registered in `CONTEXT.md` **before** its first test (repo TDD rule). Verified in S1: connection isolation, no silent fallback, key change without restart, offline blocking, cancellation. **S1 leaves the engine fully tested.**

**S2 — `secret_request` channel per the test requirements + `providers.test` side-effect-free + settings UI.**
Files: `src/engine/protocol.ts` (`secret_request` frame type + id demultiplexing); `src-tauri/src/engine.rs` (read side answering engine-initiated frames; grant policy; frame-safe logging); dev-host responder in `src/engine/main.ts`; `src/lib/services/providers.ts` (connections CRUD per capability, secrets by name only); `src/engine/dispatch.ts` (`providers.list` / `providers.configure` / `providers.test`; extended `diagnostics.capabilities`; `chat.send` provider payload); Rust keyring commands (plan §4); settings UI (per capability: preset or custom connection / baseUrl / model / key, "Verbindung testen" on pending config, egress labels). Tests: protocol codec + full channel matrix (timeout, process close, concurrency, unknown-id) in both hosts; dispatch `providers.test` with mocked fetch and asserted **zero side effects** (no config write, no index invalidation); `offline_blocked`; embed probe dimension → new profile staged, old index kept, activation on validation.

**S3 — transcribe injection + egress chips + `provider_runs`.**
Files: `src/lib/ingestion/process.ts` + `src/engine/jobs.ts` (inject `transcribe` from capabilities, killing the module-level `transcribeAudio` mocks in `engine-pool`/`engine-imports`); egress chip rendering; `provider_runs` table + retention pruning; `docs/specs` + `CONTEXT.md` updated. Tests: job pool with a fake injected transcriber; `provider_runs` records tokens/error without prompt content and null (not 0) for missing usage; zero telemetry traffic when unconfigured (network-assertion test).

The full capability is delivered only when config + secrets + tests + usage all work end-to-end from Tauri — S1 alone is a tested engine, not the shippable feature.

## Explicit non-goals

- **No router/failover.** No silent fallback — a failing provider is an error naming that provider, never a switch.
- **No LangGraph.** Revisit trigger: a real multi-step flow needing >3 conditional branches *plus* cross-session resumable human-in-the-loop the jobs/lease model cannot express.
- **No telemetry/OTLP egress in the initial scope** (see Observability).
- **No invented "Python banned" rule.** Only the user-facing rule stands: the user installs and manages no runtimes; a packaged helper remains evaluable for PageIndex.
- Also out of scope in v1: native Anthropic adapter (EXPERIMENTAL compat connection only), streaming, per-notebook keys, usage billing.

### References

Anthropic OpenAI-SDK compatibility (platform.claude.com) · OpenRouter embeddings model list (openrouter.ai/docs) · Gemini OpenAI-compatible endpoint (ai.google.dev/gemini-api/docs/openai) · LiteLLM (docs.litellm.ai) · Langfuse self-host requirements (langfuse.com/docs) · LangGraph JS (langchain-ai.github.io/langgraphjs) · keyring crate (docs.rs/keyring)
