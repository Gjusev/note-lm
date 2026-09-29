# Security Policy

## Supported version

Only the latest state of `main` is supported. There are no release branches
or tagged versions yet; security fixes land on `main`.

## Reporting a vulnerability

Please do **not** open a public issue for anything you believe is
exploitable. Report privately through GitHub's **private security advisory**
("Report a vulnerability" on the repository's Security tab). Include a
description, reproduction steps and the affected paths/files. You will get a
response and, once confirmed, a fix on `main` with credit if you want it.

## Scope and posture

noteLm is a **local-first, single-user desktop/web app**:

- The Next.js server listens on **loopback only** (127.0.0.1); a single
  local profile, an HttpOnly session cookie gating `/app`, and Origin
  checks on mutating routes. There is no auth stack and no multi-tenant
  surface — reports should assume a local attacker or a malicious document
  /URL processed by the import pipeline, not a remote web attacker.
- **No telemetry by default.** Nothing leaves the machine except explicit
  per-capability AI calls the user configures, URL imports the user
  requests, and optional SearXNG web search.

Security-relevant surfaces worth attention in a report:

- **Engine data-dir path validation.** `open_external_file` (the Tauri
  command that opens stored evidence with the OS default app) must resolve
  strictly INSIDE the engine data dir — traversal (`..`) and foreign
  absolute paths are rejected before any shell runs
  (`path_within_base` in `src-tauri/src/main.rs`).
- **The keyring secret channel.** Provider API keys travel host → engine as
  correlated `secret_request`/`secret_response` frames over the NDJSON stdio
  protocol (`src/engine/secrets.ts`); the engine holds them only for the
  in-flight call, never logs frame content, and a host that never answers
  fails the capability typed (`secret_unavailable`) after a 3 s bound.
- The import worker's network policy for URL imports (private-address
  guarding, `INGEST_ALLOW_PRIVATE=1` reserved for loopback test servers).
