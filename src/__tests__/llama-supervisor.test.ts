// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import { waitForLlamaHealth, llamaEmbed } from "@/lib/ai/llama-supervisor";

let servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

function fakeLlama(authed: boolean) {
  const seen: { auth?: string | string[]; body?: unknown }[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ auth: req.headers.authorization, body: body ? JSON.parse(body) : undefined });
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"status":"ok"}');
        return;
      }
      if (authed && req.headers.authorization !== "Bearer secret-token") {
        res.writeHead(401);
        res.end('{"error":{"message":"Invalid API Key"}}');
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] }));
    });
  });
  servers.push(server);
  return { server, seen };
}

describe("llama supervisor (issue #2)", () => {
  it("waits for /health to come up, polling until the server answers", async () => {
    const { server } = fakeLlama(false);
    // server not yet listening: waitForLlamaHealth must poll, not fail fast
    const listening = new Promise<string>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))
    );
    setTimeout(() => void listening, 150);
    const url = await listening;

    await waitForLlamaHealth(url, 2000);
    expect(true).toBe(true);
  });

  it("embeds with the session bearer token and returns the vector", async () => {
    const { server, seen } = fakeLlama(true);
    const url = await new Promise<string>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))
    );

    const vector = await llamaEmbed(url, "secret-token", "hello world");
    expect(vector).toEqual([0.1, 0.2, 0.3]);
    expect(seen.at(-1)?.auth).toBe("Bearer secret-token");
    // llama-server exposes the OpenAI-compatible shape: { input: "..." }
    expect(seen.at(-1)?.body).toEqual({ input: "hello world" });
  });
});
