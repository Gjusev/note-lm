/**
 * llama-server supervisor helpers (issue #2): the local inference helper is
 * loopback-only, authenticated with a per-session bearer token, and started
 * on demand. These helpers cover the protocol side; spawn/kill wiring lives
 * with the engine (probe-verified: b11233, ~260 ms to healthy).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { AddressInfo, createServer } from "node:net";

export interface LlamaHandle {
  baseUrl: string;
  token: string;
  embed(input: string): Promise<number[]>;
  chat(messages: Array<{ role: string; content: string }>): Promise<string>;
  stop(): Promise<void>;
}

/** Grab a free loopback port without racing (bind, read, release). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Start the pinned llama-server as an embeddings helper: loopback only, a
 * fresh random token per session (passed via env, never argv), cwd set to
 * the exe dir so the ggml DLLs resolve. Returns after /health is green.
 */
export async function startLlama(opts: {
  exeDir: string;
  modelPath: string;
  port?: number;
  timeoutMs?: number;
}): Promise<LlamaHandle> {
  const port = opts.port ?? (await freePort());
  const token = randomBytes(24).toString("hex");
  const baseUrl = `http://127.0.0.1:${port}`;

  const child: ChildProcess = spawn(
    path.join(opts.exeDir, "llama-server.exe"),
    [
      "-m", opts.modelPath,
      "--embeddings",
      "--pooling", "mean",
      "--host", "127.0.0.1",
      "--port", String(port),
      "--no-webui",
    ],
    {
      cwd: opts.exeDir,
      env: { ...process.env, LLAMA_API_KEY: token },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    }
  );
  child.stderr?.on("data", () => { /* llama logs; keep for debugging only */ });

  try {
    await waitForLlamaHealth(baseUrl, opts.timeoutMs ?? 60_000);
  } catch (err) {
    await stopTree(child);
    throw err;
  }

  return {
    baseUrl,
    token,
    embed: (input: string) => llamaEmbed(baseUrl, token, input),
    chat: (messages) => llamaChat(baseUrl, token, messages),
    stop: () => stopTree(child),
  };
}

/** One chat completion via /v1/chat/completions with the session token. */
export async function llamaChat(
  baseUrl: string,
  token: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`llama chat failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("llama chat: unexpected response shape");
  return content;
}

/** Kill the child's whole process tree (Windows: taskkill /T /F; signals do
 *  not reach grandchildren here). Shared with the whisper runtime teardown. */
export function stopTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    if (process.platform === "win32") {
      // signals don't reach children on Windows; kill the tree explicitly
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
        .on("exit", () => resolve());
    } else {
      child.kill("SIGTERM");
      child.once("exit", () => resolve());
    }
  });
}

/** Poll /health (unauthenticated by design) until the helper is ready. */
export async function waitForLlamaHealth(baseUrl: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`llama-server not healthy after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** One embedding via /v1/embeddings with the session token. */
export async function llamaEmbed(baseUrl: string, token: string, input: string): Promise<number[]> {
  const res = await fetch(`${baseUrl}/v1/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`embeddings failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { embeddings?: number[][]; data?: Array<{ embedding: number[] }> };
  // llama-server answers {embeddings:[...]}; OpenAI-shaped {data:[...]} also accepted
  const vector = data.embeddings?.[0] ?? data.data?.[0]?.embedding;
  if (!vector || !Array.isArray(vector)) throw new Error("embeddings: unexpected response shape");
  return vector;
}
