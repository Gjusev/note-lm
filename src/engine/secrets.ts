/**
 * Engine-side half of the secret_request channel (multi-provider S2). The
 * engine asks the host for a connection's secret and blocks (async) until
 * the correlated secret_response frame arrives, the 3 s timeout fires
 * (resolves null -> the capability fails typed secret_unavailable) or the
 * host stream closes (fail fast, null). Responses are routed to pending
 * resolvers by id; unknown ids are ignored and logged without any frame
 * content (a secret_response carries the value - never printed).
 */
import { encodeSecretRequest } from "./protocol";

const pending = new Map<string, (value: string | null) => void>();

/** Wire + UX bound: a host that never answers must not stall a capability. */
const DEFAULT_TIMEOUT_MS = 3_000;

/** Emit a secret_request and wait for the correlated secret_response. */
export function requestSecretViaHost(
  write: (frame: string) => void,
  connectionId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string | null> {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pending.delete(id);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    pending.set(id, finish);
    write(encodeSecretRequest({ id, connectionId }));
  });
}

/** Route a secret_response frame; false = unknown id (ignored by the caller). */
export function resolveSecretResponse(id: string, value: unknown): boolean {
  const finish = pending.get(id);
  if (!finish) return false;
  finish(typeof value === "string" && value.length > 0 ? value : null);
  return true;
}

/** Host stream closed: nothing will ever answer - fail every waiter now. */
export function failPendingSecretRequests(): void {
  for (const [id, finish] of [...pending]) {
    pending.delete(id);
    finish(null);
  }
}
