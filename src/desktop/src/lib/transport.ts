/**
 * Desktop transport adapter (phase 4): same operation contract as the HTTP
 * routes, executed as engine ops. Tauri bridge when running inside the
 * window (withGlobalTauri), HTTP fallback against the Next server in
 * browser dev — one contract, two transports, chosen at runtime.
 */
import { t } from "../i18n";

export interface EngineReply<T = unknown> {
  id: string;
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
}

export type Transport = (op: string, args: unknown) => Promise<EngineReply>;

const inTauri = typeof window !== "undefined" && "__TAURI__" in window;

async function opViaTauri(op: string, args: unknown): Promise<EngineReply> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoke = (window as any).__TAURI__.core.invoke;
  return invoke("engine_op", { op, argsJson: JSON.stringify(args) });
}

async function opViaHttp(op: string, args: unknown): Promise<EngineReply> {
  const res = await fetch("/api/engine-op", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, args }),
  });
  return res.json();
}

export const engineOp: Transport = inTauri ? opViaTauri : opViaHttp;

/** Resolve a transport error into a user-facing message (engine messages
 *  stay verbatim; only the missing-message fallback is translated). */
export function errorMessage(reply: EngineReply): string {
  return reply.error?.message ?? t("common.unknownError");
}
