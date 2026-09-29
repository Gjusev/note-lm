// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Provider run telemetry (multi-provider plan, slice S3): one honest row per
 * model call, written at the capability seam. Tokens only when the provider
 * actually returned usage - unknown consumption is null, never zero - and no
 * prompt text is ever stored.
 */
const remote = vi.hoisted(() => ({
  ctor: vi.fn(),
  chatImpl: null as null | ((args: unknown, opts: { signal: AbortSignal }) => Promise<unknown>),
  embedImpl: null as null | ((args: unknown, opts: { signal: AbortSignal }) => Promise<unknown>),
  transcribeImpl: null as null | ((args: unknown, opts: { signal: AbortSignal }) => Promise<unknown>),
}));
vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: (args: unknown, opts: { signal: AbortSignal }) => remote.chatImpl!(args, opts) } };
    embeddings = { create: (args: unknown, opts: { signal: AbortSignal }) => remote.embedImpl!(args, opts) };
    audio = {
      transcriptions: { create: (args: unknown, opts: { signal: AbortSignal }) => remote.transcribeImpl!(args, opts) },
    };
    constructor(cfg: unknown) {
      remote.ctor(cfg);
    }
  },
}));

import { openLocalDb, closeLocalDb, rawClient, type LocalDb } from "@/db/local";
import { setSetting } from "@/lib/services/settings";
import { recordProviderRun, pruneProviderRuns } from "@/lib/services/provider-runs";
import { setOfflineMode, makeLocalChat, OfflineBlockedError, setSecretRequester } from "@/lib/ai/providers";
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

function runRows(): Array<Record<string, unknown>> {
  return rawClient(db)
    .prepare(
      `SELECT capability, provider, model, latency_ms AS latencyMs, prompt_tokens AS promptTokens,
              completion_tokens AS completionTokens, ok, error_code AS errorCode, created_at AS createdAt
       FROM provider_runs ORDER BY created_at, rowid`
    )
    .all() as Array<Record<string, unknown>>;
}

/** Remote config: an OpenAI connection selected for the named capabilities. */
async function configureOpenAi(capabilities: string[]) {
  await setSetting(db, "ai.connections", [
    { id: "conn-oa", presetId: "openai", label: "OpenAI", secretRef: "conn-oa" },
  ]);
  await setSetting(db, "ai.secrets", { "conn-oa": "sk-oa" });
  await setSetting(
    db,
    "ai.capabilities",
    Object.fromEntries(capabilities.map((c) => [c, { connectionId: "conn-oa", model: "whisper-1" }]))
  );
}

beforeEach(async () => {
  for (const key of ["NOTELM_DATA_DIR", "NOTELM_ENGINE", "OPENAI_API_KEY", "NOTELM_LLAMA_DIR", "NOTELM_CHAT_MODEL", "NOTELM_EMBED_MODEL"]) {
    envSnapshot[key] = process.env[key];
    delete process.env[key];
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-provider-runs-"));
  process.env.NOTELM_DATA_DIR = dir;
  db = openLocalDb(dir);
  remote.ctor.mockClear();
  remote.chatImpl = null;
  remote.embedImpl = null;
  remote.transcribeImpl = null;
  setCapabilitiesForTests(null);
});

afterEach(async () => {
  await setOfflineMode(db, false);
  setCapabilitiesForTests(null);
  setSecretRequester(null);
  await stopLlamaHelpers();
  const { getLocalContext } = await import("@/lib/storage/local");
  const { closeLocalDb: closeCtx } = await import("@/db/local");
  closeCtx(getLocalContext().db);
  const g = globalThis as { __notelmCtx?: unknown };
  delete g.__notelmCtx;
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(envSnapshot)) setEnv(key, value);
});

describe("provider runs service", () => {
  it("records a run row with honest nulls when tokens are unknown", () => {
    recordProviderRun(db, {
      capability: "chat",
      provider: "llamacpp",
      model: "modell.gguf",
      latencyMs: 120,
      ok: true,
    });

    const rows = runRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      capability: "chat",
      provider: "llamacpp",
      model: "modell.gguf",
      latencyMs: 120,
      promptTokens: null,
      completionTokens: null,
      ok: 1,
      errorCode: null,
    });
    expect(typeof rows[0].createdAt).toBe("number");
  });

  it("records token counts only when usage was actually returned", () => {
    recordProviderRun(db, {
      capability: "embed",
      provider: "openai",
      model: "text-embedding-3-small",
      latencyMs: 40,
      promptTokens: 11,
      completionTokens: 7,
      ok: true,
    });

    expect(runRows()[0]).toMatchObject({ promptTokens: 11, completionTokens: 7, ok: 1 });
  });

  it("an error row carries the error code and ok=0", () => {
    recordProviderRun(db, {
      capability: "chat",
      provider: "openrouter",
      model: "openai/gpt-oss-20b",
      latencyMs: 900,
      ok: false,
      errorCode: "remote_error",
    });

    expect(runRows()[0]).toMatchObject({ ok: 0, errorCode: "remote_error", promptTokens: null });
  });

  it("pruning deletes rows older than keepDays and keeps recent ones", () => {
    const old = Date.now() - 31 * 86_400_000;
    rawClient(db)
      .prepare(`INSERT INTO provider_runs (id, capability, provider, ok, created_at) VALUES (?, 'chat', 'old', 1, ?)`)
      .run("run-old", old);
    rawClient(db)
      .prepare(`INSERT INTO provider_runs (id, capability, provider, ok, created_at) VALUES (?, 'chat', 'new', 1, ?)`)
      .run("run-new", Date.now());

    pruneProviderRuns(db, 30);

    expect(runRows().map((r) => r.provider)).toEqual(["new"]);
  });
});

describe("provider runs at the capability seam", () => {
  it("a local chat call records ok=1 with null tokens (llama usage unknown)", async () => {
    const handle = {
      baseUrl: "http://127.0.0.1:0", token: "t",
      chat: async () => "lokal beantwortet",
      embed: async () => Array.from({ length: 4 }, () => 0.5),
      stop: async () => undefined,
    };
    const localChat = makeLocalChat(db, handle, "modell.gguf");
    const result = await localChat([{ role: "user", content: "hi" }]);
    expect(result.text).toBe("lokal beantwortet");

    expect(runRows()).toHaveLength(1);
    expect(runRows()[0]).toMatchObject({
      capability: "chat", provider: "llamacpp", model: "modell.gguf",
      ok: 1, promptTokens: null, completionTokens: null,
    });
  });

  it("a remote chat records token counts when usage is returned, nulls otherwise", async () => {
    await configureOpenAi(["chat"]);
    remote.chatImpl = async () => ({
      choices: [{ message: { content: "Mit Usage." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    });
    const caps = await resolveCapabilities(db);
    await caps.chat!([{ role: "user", content: "hi" }]);

    remote.chatImpl = async () => ({ choices: [{ message: { content: "Ohne." } }] });
    await caps.chat!([{ role: "user", content: "hi" }]);

    const [withUsage, withoutUsage] = runRows();
    expect(withUsage).toMatchObject({ capability: "chat", provider: "openai", promptTokens: 11, completionTokens: 7, ok: 1 });
    expect(withoutUsage).toMatchObject({ promptTokens: null, completionTokens: null, ok: 1 });
  });

  it("a failing remote chat records ok=0 with an error code and still throws", async () => {
    await configureOpenAi(["chat"]);
    remote.chatImpl = async () => {
      throw new Error("500 upstream exploded");
    };
    const caps = await resolveCapabilities(db);
    const err = await caps.chat!([{ role: "user", content: "hi" }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(runRows()[0]).toMatchObject({ ok: 0, errorCode: "remote_error", capability: "chat" });
  });

  it("a transcribe capability resolves from explicit config and records its run", async () => {
    await configureOpenAi(["chat", "transcribe"]);
    remote.transcribeImpl = async () => "Hallo Welt.";
    const caps = await resolveCapabilities(db);
    expect(caps.transcribe).not.toBeNull();
    const out = await caps.transcribe!(Buffer.from("audio"), "ton.wav");
    expect(out.text).toBe("Hallo Welt.");

    expect(runRows()[0]).toMatchObject({ capability: "transcribe", provider: "openai", model: "whisper-1", ok: 1 });
  });

  it("offline blocks the remote transcribe at call time before any network call", async () => {
    await configureOpenAi(["chat", "transcribe"]);
    remote.transcribeImpl = async () => "sollte nie laufen";
    await setOfflineMode(db, true);

    const caps = await resolveCapabilities(db);
    await expect(caps.transcribe!(Buffer.from("audio"), "ton.wav")).rejects.toBeInstanceOf(OfflineBlockedError);
    expect(remote.ctor).not.toHaveBeenCalled();
    expect(runRows()).toHaveLength(0); // a blocked call is not a run
  });

  it("llamacpp selected for transcribe resolves to null with a typed pending reason", async () => {
    await setSetting(db, "ai.connections", [
      { id: "conn-l", presetId: "llamacpp", label: "Lokal" },
    ]);
    await setSetting(db, "ai.capabilities", {
      transcribe: { connectionId: "conn-l", model: "n/a" },
    });

    const caps = await resolveCapabilities(db);
    expect(caps.transcribe).toBeNull();
    expect(caps.transcribeReason).toMatch(/noch nicht/);
  });
});

describe("material generation result path (egress chip)", () => {
  it("the material generation result carries the provider label", async () => {
    const { LocalStore } = await import("@/lib/storage/local");
    const { createNotebook } = await import("@/lib/services/notebooks");
    const { createSource, replaceChunks } = await import("@/lib/services/sources");
    const { requestGeneration } = await import("@/lib/services/learning-materials");
    const { generateMaterial } = await import("@/lib/services/materials");

    const store = new LocalStore(db, dir);
    const notebookId = await createNotebook(db, { ownerId: "local", title: "Chips" });
    const sourceId = await createSource(db, {
      ownerId: "local", notebookId, fileName: "q.txt", fileType: "text/plain", fileSize: 5,
    });
    replaceChunks(db, { ownerId: "local", sourceId, notebookId }, ["Quelleninhalt fuer das Material."]);

    const materialId = await requestGeneration(db, { ownerId: "local", notebookId, type: "summary" });
    const outcome = await generateMaterial(db, store, {
      materialId,
      notebookId,
      type: "summary",
      chat: async () => ({ text: "Zusammenfassung.", provider: "llamacpp", model: "modell.gguf" }),
      providerLabel: "Auf diesem Computer",
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.providerLabel).toBe("Auf diesem Computer");
  });
});
