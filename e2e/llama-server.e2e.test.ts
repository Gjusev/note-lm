/**
 * E2E for the real llama-server helper (issue #2): spawn the pinned binary
 * with the downloaded embeddings model, wait for health, embed with the
 * session token, verify auth is enforced, stop the process tree.
 * Skips when the probe artifacts are not present (CI/dev machines).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startLlama } from "@/lib/ai/llama-supervisor";

const REPO = path.resolve(import.meta.dirname, "..");
const LLAMA_DIR = path.join(REPO, ".probe-downloads", "llama-bin");
const MODEL = path.join(REPO, ".probe-downloads", "bge-small-en-v1.5-q8_0.gguf");
const available = fs.existsSync(path.join(LLAMA_DIR, "llama-server.exe")) && fs.existsSync(MODEL);

describe.skipIf(!available)("llama-server lifecycle (real binary)", () => {
  let llama: Awaited<ReturnType<typeof startLlama>>;

  beforeAll(async () => {
    llama = await startLlama({ exeDir: LLAMA_DIR, modelPath: MODEL });
  });

  afterAll(async () => {
    await llama.stop();
  });

  it("becomes healthy and embeds with the session token", async () => {
    const a = await llama.embed("Quantenphysik");
    const b = await llama.embed("Quantenphysik");
    expect(a.length).toBeGreaterThan(300); // bge-small → 384 dims
    expect(a).toEqual(b); // deterministic for the same input

    const unrelated = await llama.embed("Kartoffeln");
    // cosine similarity: same-topic pair should beat unrelated pair
    const cos = (x: number[], y: number[]) =>
      x.reduce((s, v, i) => s + v * y[i], 0) /
      (Math.hypot(...x) * Math.hypot(...y));
    expect(cos(a, unrelated)).toBeLessThan(cos(a, b));
  });

  it("rejects requests without the session token", async () => {
    const res = await fetch(`${llama.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("listens on loopback only", () => {
    expect(new URL(llama.baseUrl).hostname).toBe("127.0.0.1");
  });
});
