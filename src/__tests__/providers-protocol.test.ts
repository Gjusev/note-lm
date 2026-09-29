// @vitest-environment node
/**
 * Multi-provider S2: the engine->host secret channel and the side-effect-free
 * providers.test op. The network layer (OpenAI SDK + global fetch) is the
 * only mock; settings live in real temp SQLite so the no-side-effect
 * assertion is a real one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const remote = vi.hoisted(() => ({
  ctor: vi.fn(),
  chat: null as null | ((args: unknown, opts: { signal: AbortSignal }) => Promise<unknown>),
  embed: null as null | ((args: unknown, opts: { signal: AbortSignal }) => Promise<unknown>),
  transcribe: null as null | ((args: unknown, opts: { signal: AbortSignal }) => Promise<unknown>),
  speech: null as null | ((args: unknown, opts: { signal: AbortSignal }) => Promise<unknown>),
  fetch: null as null | ((url: string, init?: RequestInit) => Promise<Response>),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: (a: unknown, o: { signal: AbortSignal }) => remote.chat!(a, o) } };
    embeddings = { create: (a: unknown, o: { signal: AbortSignal }) => remote.embed!(a, o) };
    audio = {
      transcriptions: { create: (a: unknown, o: { signal: AbortSignal }) => remote.transcribe!(a, o) },
      speech: { create: (a: unknown, o: { signal: AbortSignal }) => remote.speech!(a, o) },
    };
    constructor(cfg: unknown) {
      remote.ctor(cfg);
    }
  },
}));

vi.stubGlobal("fetch", (...callArgs: unknown[]) => {
  const [url, init] = callArgs as [string, RequestInit | undefined];
  return remote.fetch!(url, init);
});

import { openLocalDb, closeLocalDb, type LocalDb } from "@/db/local";
import { getSetting, setSetting } from "@/lib/services/settings";
import { encodeSecretRequest } from "@/engine/protocol";
import {
  requestSecretViaHost,
  resolveSecretResponse,
  failPendingSecretRequests,
} from "@/engine/secrets";
import { handleEngineRequest } from "@/engine/dispatch";
import { setOfflineMode } from "@/lib/ai/providers";

let dir: string;
let db: LocalDb;
const envSnapshot: Record<string, string | undefined> = {};
const setEnv = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeEach(async () => {
  for (const key of ["NOTELM_DATA_DIR", "NOTELM_ENGINE", "OPENAI_API_KEY"]) {
    envSnapshot[key] = process.env[key];
    delete process.env[key];
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-prov-proto-"));
  process.env.NOTELM_DATA_DIR = dir;
  db = openLocalDb(dir);
  remote.ctor.mockClear();
  remote.chat = null;
  remote.embed = null;
  remote.transcribe = null;
  remote.speech = null;
  remote.fetch = null;
});

afterEach(async () => {
  await setOfflineMode(db, false);
  const { getLocalContext } = await import("@/lib/storage/local");
  const { closeLocalDb: closeCtx } = await import("@/db/local");
  closeCtx(getLocalContext().db);
  const g = globalThis as { __notelmCtx?: unknown };
  delete g.__notelmCtx;
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(envSnapshot)) setEnv(key, value);
});

// ---------------------------------------------------------------------------
// Engine-side secret channel: requestSecretViaHost against a fake host
// ---------------------------------------------------------------------------

describe("engine secret channel (fake host demux)", () => {
  it("emits a secret_request frame and resolves with the correlated response value", async () => {
    const emitted: string[] = [];
    const pending = requestSecretViaHost((frame) => emitted.push(frame), "conn-1", 2_000);

    expect(emitted).toHaveLength(1);
    const frame = JSON.parse(emitted[0]);
    expect(frame).toEqual({ t: "secret_request", id: expect.any(String), connectionId: "conn-1" });
  });

  it("resolves null on timeout (host never answers) so the capability fails typed", async () => {
    const pending = requestSecretViaHost(() => undefined, "conn-1", 20);
    await expect(pending).resolves.toBeNull();
  });

  it("resolves null when the host answers with an empty value (denied)", async () => {
    const emitted: string[] = [];
    const pending = requestSecretViaHost((frame) => emitted.push(frame), "conn-1", 2_000);
    const frame = JSON.parse(emitted[0]);
    expect(resolveSecretResponse(frame.id, "")).toBe(true);
    await expect(pending).resolves.toBeNull();
  });

  it("ignores unknown-id responses and never misassigns them to a pending request", async () => {
    const emitted: string[] = [];
    const pending = requestSecretViaHost((frame) => emitted.push(frame), "conn-1", 2_000);
    const frame = JSON.parse(emitted[0]);

    expect(resolveSecretResponse("totally-unknown-id", "sk-wrong-key")).toBe(false);
    expect(resolveSecretResponse(frame.id, "sk-right-key")).toBe(true);
    await expect(pending).resolves.toBe("sk-right-key");
  });

  it("fails all pending waiters when the host stream closes (fail fast, not timeout)", async () => {
    const pending = requestSecretViaHost(() => undefined, "conn-1", 10_000);
    failPendingSecretRequests();
    await expect(pending).resolves.toBeNull();
  });
});

describe("providers.test op (side-effect-free probes)", () => {
  /** A pending (unsaved) form config for an OpenRouter chat connection. */
  const pendingChat = {
    capability: "chat" as const,
    connection: { presetId: "openrouter", model: "openai/gpt-oss-20b" },
    secret: "sk-probe-secret",
  };

  function rowsSnapshot() {
    return Promise.all([
      getSetting<unknown>(db, "ai.connections"),
      getSetting<unknown>(db, "ai.capabilities"),
      getSetting<unknown>(db, "ai.offline"),
      getSetting<unknown>(db, "retrieval.activeProfile"),
    ]).then((rows) => JSON.stringify(rows));
  }

  it("probes chat with a bounded completion via a temp client built from the pending config", async () => {
    let lastChatArgs: Record<string, unknown> = {};
    remote.chat = async (args: unknown) => {
      lastChatArgs = args as Record<string, unknown>;
      return {
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      };
    };

    const res = await handleEngineRequest("providers.test", pendingChat);
    expect(res.ok).toBe(true);
    const result = (res as { result: { capability: string; latencyMs: number } }).result;
    expect(result.capability).toBe("chat");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(remote.ctor).toHaveBeenCalledWith({
      apiKey: "sk-probe-secret",
      baseURL: "https://openrouter.ai/api/v1",
    });
    // probe is bounded: one message, max_tokens 8 (captured via a plain
    // recorder because the mock impls are plain functions, not spies)
    expect(lastChatArgs.model).toBe("openai/gpt-oss-20b");
    expect(lastChatArgs.messages).toEqual([{ role: "user", content: "ping" }]);
    expect(lastChatArgs.max_tokens).toBe(8);
  });

  it("embeds ping and returns the dimension", async () => {
    remote.embed = async () => ({ data: [{ embedding: [1, 0.5, -0.25, 0] }] });
    const res = await handleEngineRequest("providers.test", {
      capability: "embed",
      connection: { presetId: "openai", model: "text-embedding-3-small" },
      secret: "sk-embed-secret",
    });
    expect(res.ok).toBe(true);
    expect((res as { result: { dimension: number } }).result.dimension).toBe(4);
  });

  it("posts a ~1kB silent WAV fixture for the transcribe probe", async () => {
    remote.transcribe = async (args: unknown) => {
      const file = (args as { file: File }).file;
      expect(file.size).toBe(1024); // valid minimal WAV header + zeros
      return { text: "..." };
    };
    const res = await handleEngineRequest("providers.test", {
      capability: "transcribe",
      connection: { presetId: "openai", model: "whisper-1" },
      secret: "sk-audio",
    });
    expect(res.ok).toBe(true);
  });

  it("tts probes the declared models endpoint (GET /models) with auth", async () => {
    remote.fetch = async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.openai.com/v1/models");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-tts");
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    const res = await handleEngineRequest("providers.test", {
      capability: "tts",
      connection: { presetId: "openai", model: "gpt-4o-mini-tts" },
      secret: "sk-tts",
    });
    expect(res.ok).toBe(true);
  });

  it("tts on a custom preset without a declared models endpoint uses the cheapest real call", async () => {
    remote.speech = async () => ({ arrayBuffer: async () => new ArrayBuffer(8) });
    const res = await handleEngineRequest("providers.test", {
      capability: "tts",
      connection: { presetId: "custom", baseUrl: "http://127.0.0.1:9/v1", model: "tts-local" },
      secret: "sk-x",
    });
    expect(res.ok).toBe(true);
  });

  it("maps 401 to auth_failed with a German message", async () => {
    remote.chat = async () => {
      throw Object.assign(new Error("401Unauthorized"), { status: 401 });
    };
    const res = await handleEngineRequest("providers.test", pendingChat);
    expect(res).toEqual({
      ok: false,
      error: { code: "auth_failed", message: expect.stringContaining("Zugangsdaten") },
    });
  });

  it("maps 403 like auth_failed and other HTTP statuses to a typed connection error", async () => {
    remote.chat = async () => {
      throw Object.assign(new Error("403"), { status: 403 });
    };
    const res = await handleEngineRequest("providers.test", pendingChat);
    expect((res as { error: { code: string } }).error.code).toBe("auth_failed");
  });

  it("maps network-level failures to bad_base_url", async () => {
    remote.chat = async () => {
      throw new TypeError("fetch failed");
    };
    const res = await handleEngineRequest("providers.test", pendingChat);
    expect((res as { error: { code: string } }).error.code).toBe("bad_base_url");
  });

  it("maps a probe timeout to the timeout code", async () => {
    remote.chat = async () => {
      const err = new Error("This operation was aborted");
      err.name = "TimeoutError";
      throw err;
    };
    const res = await handleEngineRequest("providers.test", pendingChat);
    expect((res as { error: { code: string } }).error.code).toBe("timeout");
  });

  it("rejects a capability the preset does not declare (capability_unsupported)", async () => {
    const res = await handleEngineRequest("providers.test", {
      capability: "embed",
      connection: { presetId: "anthropic-compat", model: "claude" },
      secret: "sk-a",
    });
    expect(res).toEqual({
      ok: false,
      error: { code: "capability_unsupported", message: expect.stringContaining("unterstützt") },
    });
  });

  it("is blocked by ai.offline before any network I/O (offline_blocked)", async () => {
    await setOfflineMode(db, true);
    const res = await handleEngineRequest("providers.test", pendingChat);
    expect(res).toEqual({
      ok: false,
      error: { code: "offline_blocked", message: expect.stringMatching(/Offline-Modus/) },
    });
    expect(remote.ctor).not.toHaveBeenCalled();
  });

  it("never saves anything and never returns or logs the secret (zero side effects)", async () => {
    remote.chat = async () => ({ choices: [{ message: { content: "ok" } }] });
    remote.embed = async () => ({ data: [{ embedding: [1, 0] }] });

    // unrelated rows to prove they are not touched either
    await setSetting(db, "ai.connections", [{ id: "conn-0", presetId: "openai", label: "alt" }]);
    await setSetting(db, "ai.capabilities", { chat: { connectionId: "conn-0", model: "m" } });
    const before = await rowsSnapshot();

    for (const args of [
      pendingChat,
      { capability: "embed", connection: { presetId: "openai", model: "m" }, secret: "sk-embed-secret" },
      { capability: "chat", connection: { presetId: "openrouter" }, secret: "sk-probe-secret" }, // 401 path
    ]) {
      await handleEngineRequest("providers.test", args);
    }
    remote.chat = async () => {
      throw Object.assign(new Error("401"), { status: 401 });
    };
    const afterFailure = await handleEngineRequest("providers.test", pendingChat);
    expect(afterFailure.ok).toBe(false);

    const after = await rowsSnapshot();
    expect(after).toBe(before); // settings rows byte-identical after all probes

    // the secret never crosses back over the protocol
    const replies = [
      await handleEngineRequest("providers.test", pendingChat),
      await handleEngineRequest("providers.test", {
        capability: "embed",
        connection: { presetId: "openai", model: "m" },
        secret: "sk-embed-secret",
      }),
    ];
    for (const reply of replies) {
      expect(JSON.stringify(reply)).not.toContain("sk-probe-secret");
      expect(JSON.stringify(reply)).not.toContain("sk-embed-secret");
    }
  });
});
