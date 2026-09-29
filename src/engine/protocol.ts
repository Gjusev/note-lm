/**
 * Engine IPC protocol: newline-delimited JSON over stdio (desktop-tauri-plan
 * fase 1). stdout carries only protocol frames; stderr carries logs.
 */

export interface ProtocolMessage {
  id: string;
  op?: string;
  args?: unknown;
  /** Engine-initiated frames carry a type instead of an op (S2 secret channel). */
  t?: string;
  /** Value of a secret_response frame: the secret string, or null when denied. */
  value?: unknown;
}

export interface ProtocolError {
  code: "bad_frame" | "frame_too_large" | "unknown_op" | (string & {});
  message: string;
}

/** Wire format: exactly one JSON object per \n-terminated line. */
const frame = (value: unknown): string => JSON.stringify(value) + "\n";

export function encodeRequest(input: { id: string; op: string; args?: unknown }): string {
  return frame({ id: input.id, op: input.op, args: input.args ?? {} });
}

export function encodeResponse(input: { id: string; result: unknown }): string {
  return frame({ id: input.id, ok: true, result: input.result });
}

export function encodeError(input: { id: string; code: string; message: string }): string {
  return frame({ id: input.id, ok: false, error: { code: input.code, message: input.message } });
}

/**
 * Engine-initiated frame (multi-provider S2): ask the host for a connection's
 * secret. Answered by the correlated secret_response frame (matched by id).
 */
export function encodeSecretRequest(input: { id: string; connectionId: string }): string {
  return frame({ t: "secret_request", id: input.id, connectionId: input.connectionId });
}

/** Events for one job stream; `seq` is monotonic per encoder (1, 2, …). */
export function createEventEncoder(jobId: string) {
  let seq = 0;
  return {
    encode(type: string, payload: unknown): string {
      seq += 1;
      return frame({ seq, type, jobId, payload });
    },
  };
}

export function createDecoder({
  onMessage,
  onError,
  maxFrameBytes = 8 * 1024 * 1024,
}: {
  onMessage: (message: ProtocolMessage) => void;
  onError?: (error: ProtocolError) => void;
  maxFrameBytes?: number;
}) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      if (buffer.length > maxFrameBytes) {
        onError?.({
          code: "frame_too_large",
          message: `Frame exceeded ${maxFrameBytes} bytes and was discarded`,
        });
        buffer = "";
        return;
      }
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          onMessage(JSON.parse(line) as ProtocolMessage);
        } catch (err) {
          onError?.({
            code: "bad_frame",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  };
}
