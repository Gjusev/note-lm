import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-dispatch-"));
  process.env.NOTELM_DATA_DIR = dir;
});

afterEach(async () => {
  const { getLocalContext } = await import("@/lib/storage/local");
  const { closeLocalDb } = await import("@/db/local");
  closeLocalDb(getLocalContext().db); // releases WAL locks on Windows
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("engine dispatch (issue #10 seam: ops without HTTP)", () => {
  it("answers unknown operations with a typed error, not a crash", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const res = await handleEngineRequest("nope", {});
    expect(res).toEqual({
      ok: false,
      error: { code: "unknown_op", message: expect.stringContaining("nope") },
    });
  });

  it("handshakes with the protocol version", async () => {
    const { handleEngineRequest, PROTOCOL_VERSION } = await import("@/engine/dispatch");
    const res = await handleEngineRequest("protocol.version", {});
    expect(res).toEqual({ ok: true, result: { version: PROTOCOL_VERSION } });
  });

  it("lists and creates notebooks through the local services", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");

    const created = await handleEngineRequest("notebooks.create", { title: "Engine Book" });
    expect(created.ok).toBe(true);
    const id = (created as { result: { id: string } }).result.id;
    expect(id).toBeTruthy();

    const listed = await handleEngineRequest("notebooks.list", {});
    expect(listed.ok).toBe(true);
    const notebooks = (listed as { result: Array<{ _id: string; title: string }> }).result;
    expect(notebooks).toHaveLength(1);
    expect(notebooks[0]._id).toBe(id);
    expect(notebooks[0].title).toBe("Engine Book");
  });
});
