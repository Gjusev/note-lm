import { describe, it, expect } from "vitest";
import {
  createDecoder,
  createEventEncoder,
  encodeRequest,
  encodeResponse,
  encodeError,
} from "@/engine/protocol";

describe("protocol decoder", () => {
  it("reassembles a request delivered in split chunks", () => {
    const received: unknown[] = [];
    const decoder = createDecoder({ onMessage: (m) => received.push(m) });
    const line = JSON.stringify({ id: "r1", op: "notebooks.list", args: {} });

    decoder.push(line.slice(0, 10));
    expect(received).toEqual([]); // incomplete line: nothing is emitted

    decoder.push(line.slice(10) + "\n");
    expect(received).toEqual([{ id: "r1", op: "notebooks.list", args: {} }]);
  });

  it("emits every complete message contained in one chunk", () => {
    const received: unknown[] = [];
    const decoder = createDecoder({ onMessage: (m) => received.push(m) });
    decoder.push(
      JSON.stringify({ id: "r1", op: "a" }) + "\n" + JSON.stringify({ id: "r2", op: "b" }) + "\n"
    );
    expect(received).toEqual([
      { id: "r1", op: "a" },
      { id: "r2", op: "b" },
    ]);
  });

  it("reports malformed JSON as a typed protocol error and keeps decoding", () => {
    const received: unknown[] = [];
    const errors: unknown[] = [];
    const decoder = createDecoder({
      onMessage: (m) => received.push(m),
      onError: (e) => errors.push(e),
    });

    decoder.push("{not json}\n" + JSON.stringify({ id: "r2", op: "ok" }) + "\n");

    expect(received).toEqual([{ id: "r2", op: "ok" }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "bad_frame" });
  });

  it("rejects oversized frames and recovers on the next line", () => {
    const received: unknown[] = [];
    const errors: unknown[] = [];
    const decoder = createDecoder({
      onMessage: (m) => received.push(m),
      onError: (e) => errors.push(e),
      maxFrameBytes: 64,
    });

    decoder.push("x".repeat(200)); // over the cap, no newline yet
    decoder.push("\n" + JSON.stringify({ id: "r9", op: "ok" }) + "\n");

    expect(received).toEqual([{ id: "r9", op: "ok" }]);
    expect(errors).toEqual([expect.objectContaining({ code: "frame_too_large" })]);
  });
});

describe("protocol encoder", () => {
  it("encodes requests, results and typed errors as one line each", () => {
    expect(encodeRequest({ id: "r1", op: "notebooks.list", args: {} })).toBe(
      '{"id":"r1","op":"notebooks.list","args":{}}\n'
    );
    expect(encodeResponse({ id: "r1", result: [] })).toBe('{"id":"r1","ok":true,"result":[]}\n');
    expect(encodeError({ id: "r1", code: "unknown_op", message: "nope" })).toBe(
      '{"id":"r1","ok":false,"error":{"code":"unknown_op","message":"nope"}}\n'
    );
  });

  it("stamps events with a monotonic sequence and survives the roundtrip", () => {
    const events = createEventEncoder("job-42");
    const first = events.encode("progress", { pct: 10 });
    const second = events.encode("progress", { pct: 90 });

    expect(first).toBe('{"seq":1,"type":"progress","jobId":"job-42","payload":{"pct":10}}\n');
    expect(second).toContain('"seq":2');

    const received: unknown[] = [];
    const decoder = createDecoder({ onMessage: (m) => received.push(m) });
    // feed both frames as one arbitrary split to prove the roundtrip
    decoder.push(first.slice(0, 7));
    decoder.push(first.slice(7) + second);
    expect(received).toEqual([
      { seq: 1, type: "progress", jobId: "job-42", payload: { pct: 10 } },
      { seq: 2, type: "progress", jobId: "job-42", payload: { pct: 90 } },
    ]);
  });
});
