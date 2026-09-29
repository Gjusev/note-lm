// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The network layer (OpenAI SDK) is the only mock: settings live in real
// temp SQLite. Every remote call routes through this controllable fake.
const remote = vi.hoisted(() => ({
  ctor: vi.fn(),
  chatImpl: null as null | ((args: unknown, opts: { signal: AbortSignal }) => Promise<unknown>),
  embedImpl: null as null | ((args: unknown, opts: { signal: AbortSignal }) => Promise<unknown>),
}));
vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: (args: unknown, opts: { signal: AbortSignal }) => remote.chatImpl!(args, opts) } };
    embeddings = { create: (args: unknown, opts: { signal: AbortSignal }) => remote.embedImpl!(args, opts) };
    constructor(cfg: unknown) {
      remote.ctor(cfg);
    }
  },
}));

import { openLocalDb, closeLocalDb, type LocalDb } from "@/db/local";
import { getSetting, setSetting } from "@/lib/services/settings";
import { OfflineBlockedError, RemoteProviderError, setOfflineMode, makeLocalChat, PRESETS } from "@/lib/ai/providers";
import {
  resolveCapabilities,
  setCapabilitiesForTests,
  stopLlamaHelpers,
} from "@/engine/capabilities";

let dir: string;
let db: LocalDb;
const envSnapshot: Record<string, string | undefined> = {};

const setEnv = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

/** Remote chat config: an OpenRouter connection selected for chat. */
async function configureRemoteChat(secret = "sk-router-secret") {
  await setSetting(db, "ai.connections", [
    { id: "conn-1", presetId: "openrouter", label: "Mein OpenRouter", secretRef: "conn-1" },
  ]);
  await setSetting(db, "ai.secrets", { "conn-1": secret });
  await setSetting(db, "ai.capabilities", {
    chat: { connectionId: "conn-1", model: "openai/gpt-oss-20b" },
  });
}

/** Default remote chat answer, OpenAI wire shape. */
function chatAnswer(content = "Antwort aus der Ferne.", overrides: Record<string, unknown> = {}) {
  return async () => ({
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
    ...overrides,
  });
}

beforeEach(async () => {
  for (const key of ["NOTELM_DATA_DIR", "NOTELM_ENGINE", "OPENAI_API_KEY", "NOTELM_LLAMA_DIR", "NOTELM_CHAT_MODEL", "NOTELM_EMBED_MODEL"]) {
    envSnapshot[key] = process.env[key];
    delete process.env[key];
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-providers-"));
  process.env.NOTELM_DATA_DIR = dir;
  db = openLocalDb(dir);
  remote.ctor.mockClear();
  remote.chatImpl = null;
  remote.embedImpl = null;
  setCapabilitiesForTests(null);
});

afterEach(async () => {
  await setOfflineMode(db, false);
  setCapabilitiesForTests(null);
  await stopLlamaHelpers();
  // resolveCapabilities falls back to the process-wide context (second handle
  // on the same SQLite file) — close it too or Windows refuses the rmSync.
  const { getLocalContext } = await import("@/lib/storage/local");
  const { closeLocalDb: closeCtx } = await import("@/db/local");
  closeCtx(getLocalContext().db);
  const g = globalThis as { __notelmCtx?: unknown };
  delete g.__notelmCtx;
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(envSnapshot)) setEnv(key, value);
});

describe("ai providers", () => {
  it("explicit connection config wins over env (client built from connection, not env)", async () => {
    process.env.OPENAI_API_KEY = "sk-env-key";
    remote.chatImpl = chatAnswer("OpenRouter answer.");
    await configureRemoteChat("sk-router-secret");

    const caps = await resolveCapabilities(db);
    expect(caps.chatProviderKind).toBe("remote");
    expect(caps.chatProvider).toEqual({ kind: "remote", label: "OpenRouter · openai/gpt-oss-20b" });

    const result = await caps.chat!([{ role: "user", content: "hi" }]);
    expect(result.text).toBe("OpenRouter answer.");
    expect(result.provider).toBe("openrouter");
    expect(remote.ctor).toHaveBeenCalledWith({
      apiKey: "sk-router-secret",
      baseURL: "https://openrouter.ai/api/v1",
    });
    expect(remote.ctor).not.toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-env-key" }));
  });

  it("env-only works in dev mode (Next dev path keeps working)", async () => {
    process.env.OPENAI_API_KEY = "sk-env-key";
    remote.chatImpl = chatAnswer();

    const caps = await resolveCapabilities(db);
    expect(caps.chatProviderKind).toBe("remote");
    expect(caps.chatProvider).toEqual({ kind: "remote", label: "OpenAI" });

    const result = await caps.chat!([{ role: "user", content: "hi" }]);
    expect(result.text).toBe("Antwort aus der Ferne.");
    expect(result.provider).toBe("openai");
    expect(remote.ctor).toHaveBeenCalledWith({ apiKey: "sk-env-key" });
  });

  it("env-only yields null chat capability in desktop mode (env never reactivates remote)", async () => {
    process.env.OPENAI_API_KEY = "sk-env-key";
    process.env.NOTELM_ENGINE = "1";

    const caps = await resolveCapabilities(db);
    expect(caps.chat).toBeNull();
    expect(caps.chatProvider).toBeNull();
    expect(caps.chatReason).toMatch(/Kein KI-Anbieter konfiguriert/);
    expect(remote.ctor).not.toHaveBeenCalled();
  });

  it("offline blocks remote chat at call time with a typed error before any network call", async () => {
    await configureRemoteChat();
    remote.chatImpl = chatAnswer();
    await setOfflineMode(db, true);

    const caps = await resolveCapabilities(db);
    await expect(caps.chat!([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(OfflineBlockedError);
    expect(remote.ctor).not.toHaveBeenCalled();

    await setOfflineMode(db, false);
    const result = await caps.chat!([{ role: "user", content: "hi" }]);
    expect(result.text).toBe("Antwort aus der Ferne.");
  });

  it("offline aborts an in-flight remote chat call and refuses the retry", async () => {
    await configureRemoteChat();
    // in-flight: the fake hangs until its AbortSignal fires
    const implStarted = new Promise<{ signal: AbortSignal }>((resolve) => {
      remote.chatImpl = (_args, opts) => {
        resolve(opts);
        // like the real SDK: an aborted request rejects the fetch
        return new Promise((_res, reject) => {
          opts.signal.addEventListener("abort", () => reject(opts.signal.reason), { once: true });
        });
      };
    });

    const caps = await resolveCapabilities(db);
    const pending = caps.chat!([{ role: "user", content: "hi" }]);
    const opts = await implStarted; // the call is registered and on the wire
    const observedAbort = new Promise<unknown>((resolve) => {
      opts.signal.addEventListener("abort", () => resolve(opts.signal.reason), { once: true });
    });
    await setOfflineMode(db, true);
    await observedAbort; // the registry aborted the in-flight call's signal
    await expect(pending).rejects.toThrow();
    await expect(caps.chat!([{ role: "user", content: "retry" }])).rejects.toBeInstanceOf(OfflineBlockedError);
  });

  it("local llama calls are not affected by offline mode", async () => {
    const handle = {
      baseUrl: "http://127.0.0.1:0", token: "t",
      chat: async () => "lokal beantwortet",
      embed: async () => Array.from({ length: 4 }, () => 0.5),
      stop: async () => undefined,
    };
    const localChat = makeLocalChat(handle, "modell.gguf");
    await setOfflineMode(db, true);
    const result = await localChat([{ role: "user", content: "hi" }]);
    expect(result.text).toBe("lokal beantwortet");
    expect(result.provider).toBe("llamacpp");
    expect(result.model).toBe("modell.gguf");
    // unknown usage stays undefined — never fabricated as zero
    expect(result.usage).toBeUndefined();
    expect(result.finishReason).toBeUndefined();
  });

  it("configured remote failing does NOT fall back to local (typed remote error only)", async () => {
    await configureRemoteChat();
    remote.chatImpl = async () => {
      throw new Error("500 upstream exploded");
    };

    const caps = await resolveCapabilities(db);
    const err = await caps.chat!([{ role: "user", content: "hi" }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteProviderError);
    expect((err as Error).message).toContain("Verbindung mit Mein OpenRouter fehlgeschlagen");
    expect((err as Error).message).toContain("500 upstream exploded");
    expect(err).not.toBeInstanceOf(OfflineBlockedError);
  });

  it("changing the apiKey/baseUrl in settings changes the built client without restart", async () => {
    remote.chatImpl = chatAnswer();
    await configureRemoteChat("sk-first-key");
    const caps = await resolveCapabilities(db);
    await caps.chat!([{ role: "user", content: "hi" }]);
    expect(remote.ctor).toHaveBeenLastCalledWith({
      apiKey: "sk-first-key",
      baseURL: "https://openrouter.ai/api/v1",
    });

    // rotate the secret and switch the connection to a custom endpoint
    await setSetting(db, "ai.connections", [
      { id: "conn-2", presetId: "custom", label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
    ]);
    await setSetting(db, "ai.secrets", { "conn-2": "sk-second-key" });
    await setSetting(db, "ai.capabilities", {
      chat: { connectionId: "conn-2", model: "local-model" },
    });

    const caps2 = await resolveCapabilities(db);
    await caps2.chat!([{ role: "user", content: "hi" }]);
    expect(remote.ctor).toHaveBeenLastCalledWith({
      apiKey: "sk-second-key",
      baseURL: "http://localhost:1234/v1",
    });
  });

  it("ChatResult carries usage and finishReason from a remote response; unknown stays undefined", async () => {
    await configureRemoteChat();
    remote.chatImpl = chatAnswer("Mit Usage.");

    const caps = await resolveCapabilities(db);
    const known = await caps.chat!([{ role: "user", content: "hi" }]);
    expect(known.usage).toEqual({ promptTokens: 11, completionTokens: 7 });
    expect(known.finishReason).toBe("stop");

    remote.chatImpl = async () => ({
      choices: [{ message: { content: "Ohne Usage." } }],
    });
    const unknown = await caps.chat!([{ role: "user", content: "hi" }]);
    expect(unknown.usage).toBeUndefined();
    expect(unknown.finishReason).toBeUndefined();
    expect(unknown.text).toBe("Ohne Usage.");
  });

  it("remote embed resolves from explicit config and keeps the EmbedFn shape", async () => {
    await setSetting(db, "ai.connections", [
      { id: "conn-e", presetId: "openai", label: "OpenAI", secretRef: "conn-e" },
    ]);
    await setSetting(db, "ai.secrets", { "conn-e": "sk-embed" });
    await setSetting(db, "ai.capabilities", {
      embed: { connectionId: "conn-e", model: "text-embedding-3-small" },
    });
    remote.embedImpl = async (args) => ({
      data: (args as { input: string[] }).input.map(() => ({ embedding: [0.5, -0.5, 0.25, 0] })),
    });

    const caps = await resolveCapabilities(db);
    expect(caps.embed).not.toBeNull();
    const vectors = await caps.embed!(["a", "b"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(16); // 4 floats as float32 buffer bytes
    expect(remote.ctor).toHaveBeenLastCalledWith({ apiKey: "sk-embed", baseURL: "https://api.openai.com/v1" });
  });

  it("embed falls back to textual (null) when remote config is invalid", async () => {
    await setSetting(db, "ai.capabilities", {
      embed: { connectionId: "missing-conn", model: "m" },
    });
    const caps = await resolveCapabilities(db);
    expect(caps.embed).toBeNull();
  });

  it("offline blocks remote embed at call time too", async () => {
    await setSetting(db, "ai.connections", [
      { id: "conn-e", presetId: "openai", label: "OpenAI", secretRef: "conn-e" },
    ]);
    await setSetting(db, "ai.secrets", { "conn-e": "sk-embed" });
    await setSetting(db, "ai.capabilities", {
      embed: { connectionId: "conn-e", model: "text-embedding-3-small" },
    });
    remote.embedImpl = async () => ({ data: [{ embedding: [1, 0] }] });
    await setOfflineMode(db, true);

    const caps = await resolveCapabilities(db);
    await expect(caps.embed!(["x"])).rejects.toBeInstanceOf(OfflineBlockedError);
    expect(remote.ctor).not.toHaveBeenCalled();
  });

  it("presets data: openrouter embeds, anthropic is experimental chat-only, custom is configurable", () => {
    const openrouter = PRESETS.find((p) => p.id === "openrouter")!;
    expect(openrouter.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(openrouter.capabilities).toContain("embed");

    const anthropic = PRESETS.find((p) => p.id === "anthropic-compat")!;
    expect(anthropic.experimental).toBe(true);
    expect(anthropic.capabilities).toEqual(["chat"]);
    expect(anthropic.baseUrl).toBe("https://api.anthropic.com/v1");

    const openai = PRESETS.find((p) => p.id === "openai")!;
    expect(openai.capabilities).toEqual(["chat", "embed", "transcribe", "tts"]);
    const custom = PRESETS.find((p) => p.id === "custom")!;
    expect(custom.capabilities).toEqual(["chat", "embed", "transcribe", "tts"]);

    const llamacpp = PRESETS.find((p) => p.id === "llamacpp")!;
    expect(llamacpp.baseUrl).toBeNull(); // base url comes from the supervisor handle
  });
});
