#!/usr/bin/env node
/**
 * Browser-dev engine server for the UI drive (surface B): serves the SAME
 * two HTTP contracts the Next dev server provides for the desktop UI's
 * browser fallback (src/desktop/src/lib/transport.ts posts /api/engine-op;
 * assetUrl() maps stored originals to /api/files/<storageId>) — but backed
 * by the REAL packaged engine bundle (src-tauri/resources/engine/engine.cjs
 * over NDJSON stdio, the exact child the Tauri host spawns).
 *
 * Why not `next dev`: on this tree the /api/engine-op route fails to load
 * under next dev (webpack/RSC bundling of pdf-parse@2.4.5 throws
 * "Object.defineProperty called on non-object" at module init → every POST
 * 500s). That is an engine/Next-layer bug (reported); this harness stands in
 * for the transport without touching it.
 *
 * Usage: node eval/ui-drive/engine-server.mjs --port 3128 --data <freshDir>
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = new Map(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [null, null])));
const PORT = Number(argv.get("port") ?? 3128);
const DATA_DIR = path.resolve(argv.get("data"));
const ENGINE_SCRIPT = path.join(repo, "src-tauri", "resources", "engine", "engine.cjs");
if (!fs.existsSync(ENGINE_SCRIPT)) {
  console.error(`engine bundle missing: ${ENGINE_SCRIPT} (npm run build:engine)`);
  process.exit(1);
}
// The bundle's native modules (better-sqlite3/sqlite-vec) are prebuilt for the
// PINNED runtime the app ships — resolve_node() in src-tauri/src/engine.rs
// picks node.exe next to the app exe; do the same, falling back to PATH.
const NODE_BIN = fs.existsSync(path.join(repo, "src-tauri", "target", "release", "node.exe"))
  ? path.join(repo, "src-tauri", "target", "release", "node.exe")
  : process.execPath;

// --- NDJSON engine child (mirrors the Rust host's Engine::spawn) ----------------
const proc = spawn(NODE_BIN, [ENGINE_SCRIPT], {
  env: { ...process.env, NOTELM_DATA_DIR: DATA_DIR, NODE_ENV: "production" },
  stdio: ["pipe", "pipe", "inherit"],
});
let buffer = "";
const pending = new Map();
proc.stdout.setEncoding("utf8");
proc.stdout.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const nl = buffer.indexOf("\n");
    if (nl === -1) return;
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    const entry = pending.get(msg.id);
    if (entry) {
      pending.delete(msg.id);
      entry(msg);
    }
  }
});
const exited = new Promise((resolve) => proc.once("exit", resolve));
proc.once("exit", () => {
  for (const [id, settle] of pending) {
    pending.delete(id);
    settle({ ok: false, error: { code: "engine_died", message: "engine process exited" } });
  }
});
let seq = 0;
const engineRequest = (op, args, timeoutMs = 60_000) =>
  new Promise((resolve) => {
    const id = `srv${++seq}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: { code: "timeout", message: `engine op ${op} timed out` } });
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    proc.stdin.write(JSON.stringify({ id, op, args }) + "\n");
  });

// --- HTTP surface -----------------------------------------------------------------
const MIME = {
  pdf: "application/pdf", csv: "text/csv", txt: "text/plain", md: "text/markdown",
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", json: "application/json",
  wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4", webm: "video/webm",
  mov: "video/quicktime", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      const reply = await engineRequest("protocol.version", {});
      res.writeHead(reply.ok ? 200 : 500, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.ok ? { ok: true, version: reply.result } : reply));
      return;
    }
    if (req.method === "POST" && req.url === "/api/engine-op") {
      const body = await new Promise((resolve, reject) => {
        let b = "";
        req.on("data", (c) => { b += c; });
        req.on("end", () => resolve(b));
        req.on("error", reject);
      });
      let op = null;
      let args = {};
      try { ({ op, args } = JSON.parse(body)); } catch { /* bad json below */ }
      if (typeof op !== "string") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "srv-bad", ok: false, error: { code: "bad_args", message: "op is required" } }));
        return;
      }
      const reply = await engineRequest(op, args ?? {});
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
      return;
    }
    const fileMatch = req.method === "GET" && /^\/api\/files\/([0-9a-f-]{36})$/.exec(req.url ?? "");
    if (fileMatch) {
      const id = fileMatch[1];
      if (!UUID_RE.test(id)) { res.writeHead(400); res.end("bad id"); return; }
      const filesDir = path.join(DATA_DIR, "files");
      let hit = null;
      try {
        hit = fs.readdirSync(filesDir).find((f) => f.startsWith(id)) ?? null;
      } catch { /* no dir */ }
      if (!hit) { res.writeHead(404); res.end("not found"); return; }
      const abs = path.join(filesDir, hit);
      const ext = hit.split(".").pop()?.toLowerCase() ?? "";
      const bytes = fs.readFileSync(abs);
      res.writeHead(200, {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "content-length": bytes.length,
        "cache-control": "private, max-age=60",
      });
      res.end(bytes);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[engine-server] http://127.0.0.1:${PORT} -> ${ENGINE_SCRIPT} (data: ${DATA_DIR})`);
});
process.on("SIGINT", () => process.exit(0));
process.on("exit", () => {
  try { proc.stdin.end(); } catch { /* gone */ }
  try { proc.kill(); } catch { /* gone */ }
});
export { server, engineRequest, exited };
