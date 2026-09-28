/**
 * Phase 2 acceptance (agent-execution-plan): the REAL engine process with
 * REAL local AI — llama-server chat (Qwen2.5-0.5B) + embeddings (bge-small)
 * — runs the whole chain: create notebook → activate profile → import file →
 * auto-index → hybrid chat with resolvable references.
 * Skips when the llama artifacts are absent (other machines/CI).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLocalDb, closeLocalDb, type LocalDb } from "@/db/local";
import { getSource } from "@/lib/services/sources";

const REPO = path.resolve(import.meta.dirname, "..");
const LLAMA_DIR = path.join(REPO, ".probe-downloads", "llama-bin");
const CHAT_MODEL = path.join(REPO, ".probe-downloads", "qwen2.5-0.5b-instruct-q4_k_m.gguf");
const EMBED_MODEL = path.join(REPO, ".probe-downloads", "bge-small-en-v1.5-q8_0.gguf");
const available =
  fs.existsSync(path.join(LLAMA_DIR, "llama-server.exe")) &&
  fs.existsSync(CHAT_MODEL) &&
  fs.existsSync(EMBED_MODEL);

let dir: string;
let db: LocalDb;
let proc: ChildProcess;
let buffer = "";
const pending = new Map<string, (value: any) => void>();

function startEngine() {
  proc = spawn(process.execPath, ["--import", "tsx", path.resolve(REPO, "src/engine/main.ts")], {
    cwd: REPO,
    env: {
      ...process.env,
      NOTELM_DATA_DIR: dir,
      NOTELM_LLAMA_DIR: LLAMA_DIR,
      NOTELM_CHAT_MODEL: CHAT_MODEL,
      NOTELM_EMBED_MODEL: EMBED_MODEL,
      OPENAI_API_KEY: "", // local mode: no remote fallback available
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.stdout!.setEncoding("utf8");
  proc.stdout!.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        }
      } catch {
        /* non-protocol noise on stdout must not crash the test */
      }
    }
  });
  proc.stderr!.setEncoding("utf8");
  proc.stderr!.on("data", (d: string) => process.stderr.write(`[engine] ${d}`));
}

function request(id: string, op: string, args: unknown, timeoutMs = 240_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`request ${op} timed out`)), timeoutMs);
    pending.set(id, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    proc.stdin!.write(JSON.stringify({ id, op, args }) + "\n");
  });
}

beforeAll(function () {
  if (!available) return;
});

beforeEach(() => {
  if (!available) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-localai-"));
  db = openLocalDb(dir);
  buffer = "";
});

afterEach(async () => {
  if (!available) return;
  if (proc && proc.exitCode === null) {
    // tree kill: the engine's llama-server children must die with it
    const { execFileSync } = require("node:child_process");
    try {
      execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    } catch { /* already gone */ }
    await new Promise<void>((r) => proc.once("exit", () => r()));
  }
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  // orphan check: no llama-server from this test may survive
  if (available) {
    const { execFileSync } = require("node:child_process");
    const { spawnSync } = require("node:child_process");
    const r = spawnSync(
      "powershell",
      ["-Command", "(Get-Process llama-server -ErrorAction SilentlyContinue | Measure-Object).Count; exit 0"],
      { encoding: "utf8" }
    );
    expect(Number((r.stdout || "0").trim())).toBe(0);
  }
});

describe.skipIf(!available)("engine local AI end to end (phase 2 acceptance)", () => {
  it("imports → auto-indexes → answers with local hybrid chat and resolvable references", async () => {
    startEngine();

    const nb = await request("a1", "notebooks.create", { title: "Local AI Book" });
    expect(nb.ok).toBe(true);
    const notebookId = nb.result.id;

    // activate the embeddings profile (bge-small: 384 dims, mean pooling)
    const act = await request("a2", "retrieval.profile.activate", {
      provider: "llamacpp", model: "bge-small-en-v1.5", revision: "q8_0",
      dimension: 384, pooling: "mean",
    });
    expect(act.ok).toBe(true);

    // import a text file with distinctive content
    const content =
      "Der Katalysator reduziert die Aktivierungsenergie der Reaktion. " +
      "Photonen regen Elektronen zur Emission an. Diese Notiz enthält Zitronenbaum. ".repeat(3);
    const file = path.join(dir, "notes.txt");
    fs.writeFileSync(file, content);
    const imp = await request("a3", "sources.importFile", {
      path: file, notebookId, fileName: "notes.txt", fileType: "text/plain",
    });
    expect(imp.ok).toBe(true);
    const sourceId = imp.result.sourceId;

    // wait for processing AND auto-indexing (both in-engine)
    const deadline = Date.now() + 120_000;
    let source: Awaited<ReturnType<typeof getSource>>;
    do {
      source = getSource(db, sourceId);
      await new Promise((r) => setTimeout(r, 400));
    } while (source?.status !== "completed" && Date.now() < deadline);
    expect(source?.status).toBe("completed");

    // the first chat.send boots the local models (chat + embeddings);
    // hybrid requires the auto-index to have landed — retry until then
    let reply: any = null;
    for (let i = 0; i < 20; i++) {
      reply = await request(`c${i}`, "chat.send", {
        notebookId,
        message: "Was regt Elektronen zur Emission an?",
      });
      expect(reply.ok).toBe(true);
      if (reply.result.mode === "hybrid") break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(reply.result.provider).toBe("local"); // Qwen via llama-server
    expect(reply.result.mode).toBe("hybrid"); // both branches answered
    expect(typeof reply.result.response).toBe("string");
    expect(reply.result.response.length).toBeGreaterThan(0);
    // citations, when the model emits [E1], must be resolvable evidence
    for (const c of reply.result.citations ?? []) {
      expect(c.text).toBeTruthy();
      expect(c.sourceId).toBe(sourceId);
    }
  }, 300_000);
});
