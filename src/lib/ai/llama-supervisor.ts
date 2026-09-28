/**
 * llama-server supervisor helpers (issue #2): the local inference helper is
 * loopback-only, authenticated with a per-session bearer token, and started
 * on demand. These helpers cover the protocol side; spawn/kill wiring lives
 * with the engine (probe-verified: b11233, ~260 ms to healthy).
 */

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
