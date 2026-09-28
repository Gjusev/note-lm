/**
 * E2E for the engine process (issue #10 seam at process level): spawn the real
 * engine over stdio, speak the NDJSON protocol, verify handshake + ops.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

let dir: string;
let proc: ChildProcess;
let buffer = "";
const pending = new Map<string, (value: any) => void>();

function startEngine() {
  proc = spawn(process.execPath, ["--import", "tsx", path.resolve(REPO_ROOT, "src/engine/main.ts")], {
    cwd: REPO_ROOT,
    env: { ...process.env, NOTELM_DATA_DIR: dir },
    stdio: ["pipe", "pipe", "inherit"],
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
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    }
  });
}

function request(id: string, op: string, args: unknown): Promise<any> {
  return new Promise((resolve) => {
    pending.set(id, resolve);
    proc.stdin!.write(JSON.stringify({ id, op, args }) + "\n");
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-engine-"));
  buffer = "";
});

afterEach(async () => {
  if (proc && proc.exitCode === null) {
    proc.kill();
    await new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("engine stdio process", () => {
  it("handshakes and serves notebook ops over split-friendly NDJSON", async () => {
    startEngine();

    const hello = await request("r1", "protocol.version", {});
    expect(hello).toEqual({ id: "r1", ok: true, result: { version: 1 } });

    const created = await request("r2", "notebooks.create", { title: "Stdio Book" });
    expect(created.ok).toBe(true);
    expect(created.result.id).toBeTruthy();

    const listed = await request("r3", "notebooks.list", {});
    expect(listed.ok).toBe(true);
    expect(listed.result).toHaveLength(1);
    expect(listed.result[0].title).toBe("Stdio Book");

    const bad = await request("r4", "definitely.not.an.op", {});
    expect(bad).toEqual({
      id: "r4",
      ok: false,
      error: { code: "unknown_op", message: expect.stringContaining("definitely") },
    });
  });
});
