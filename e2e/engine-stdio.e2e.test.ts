/**
 * E2E for the engine process (issue #10 seam at process level): spawn the real
 * engine over stdio, speak the NDJSON protocol, verify handshake + ops.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLocalDb, closeLocalDb } from "@/db/local";
import { getSource, getChunksBySource } from "@/lib/services/sources";

/** Separate connection to the SAME data dir the engine writes to. */
const openDb = () => openLocalDb(dir);

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

let dir: string;
let proc: ChildProcess;
let buffer = "";
const pending = new Map<string, (value: any) => void>();
/** Engine→host secret channel (S2): the harness acts as the keyring host. */
let secretAnswer: string | null = "sk-e2e-key";
let secretRequests: string[] = [];

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
      if (msg.t === "secret_request") {
        // the harness is the keyring host: record + answer, never blank
        secretRequests.push(msg.connectionId);
        proc.stdin!.write(
          JSON.stringify({ t: "secret_response", id: msg.id, value: secretAnswer }) + "\n"
        );
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
        return;
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
  secretAnswer = "sk-e2e-key";
  secretRequests = [];
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

  it("imports a PDF from a granted path and processes it to chunks in-engine", async () => {
    // minimal valid one-page PDF with extractable text
    const text = "Hello note-lm engine packaging";
    const pdf = [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
      `4 0 obj << /Length ${44 + text.length} >> stream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream endobj`,
      "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
      "trailer << /Root 1 0 R >>",
      "%%EOF",
    ].join("\n");
    const pdfPath = path.join(dir, "paper.pdf");
    fs.writeFileSync(pdfPath, pdf, "utf8");

    startEngine();
    const nb = await request("p1", "notebooks.create", { title: "PDF Book" });
    const imported = await request("p2", "sources.importFile", {
      path: pdfPath,
      notebookId: nb.result.id,
      fileName: "paper.pdf",
      fileType: "application/pdf",
    });
    expect(imported.ok).toBe(true);
    const sourceId = imported.result.sourceId;

    // the engine's own processing loop picks the job up; poll until done
    let source: Awaited<ReturnType<typeof getSource>> = null;
    for (let i = 0; i < 100; i++) {
      const db = await openDb();
      source = getSource(db, sourceId);
      closeLocalDb(db);
      if (source && source.status !== "pending" && source.status !== "processing") break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(source?.status).toBe("completed");
    expect(source?.storageId).toBeTruthy();

    const db = await openDb();
    const chunks = getChunksBySource(db, sourceId);
    closeLocalDb(db);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain("Hello note-lm");
  });

it("answers engine secret_request frames so a remote capability resolves its key", async () => {
    startEngine();
    // configure a remote chat connection through the new ops (nothing saved
    // by providers.test; this save is the real config write)
    const saved = await request("s1", "providers.save", {
      connection: { presetId: "custom", label: "Lokal E2E", baseUrl: "http://127.0.0.1:9/v1" },
      models: { chat: "local-model" },
    });
    expect(saved.ok).toBe(true);
    const connId = saved.result.id;
    const offline = await request("s2", "settings.offline", { on: false });
    expect(offline.result.offline).toBe(false);

    // chat.send -> engine resolves the capability -> needs the secret ->
    // emits secret_request -> the harness (keyring host) answers -> the
    // provider call proceeds and fails on the unreachable endpoint (never
    // with secret_unavailable)
    const nb = await request("s3", "notebooks.create", { title: "Secret Book" });
    const reply = await request("s4", "chat.send", { notebookId: nb.result.id, message: "hi" });
    expect(secretRequests).toContain(connId);
    expect(reply.ok).toBe(false);
    expect(reply.error.code).not.toBe("secret_unavailable");

    // host denies (value null): the capability fails typed secret_unavailable
    secretAnswer = null;
    const denied = await request("s5", "chat.send", { notebookId: nb.result.id, message: "hi" });
    expect(denied.error.code).toBe("secret_unavailable");
    expect(denied.error.message).toContain("Keine Zugangsdaten");
  });
});
