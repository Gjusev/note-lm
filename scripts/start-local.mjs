#!/usr/bin/env node
/**
 * Local launcher: start the Next.js server on loopback plus the ingestion
 * worker, wait until both are ready, then open the browser. Ctrl+C stops
 * both children; in-flight jobs are lease-protected and recovered on the
 * next start.
 */
import { spawn, execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = parseInt(process.env.NOTELM_PORT || process.env.PORT || "3128");
const host = "127.0.0.1";
const appUrl = `http://${host}:${port}`;

if (!fs.existsSync(path.join(repo, ".next", "BUILD_ID"))) {
  console.error("Kein Build gefunden. Zuerst ausführen:  npm run build");
  process.exit(1);
}

const children = [];

function stopChild(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    // Signals don't reach children on Windows; taskkill /T takes the whole
    // tree (incl. ffmpeg spawned by the worker). In-flight jobs are
    // lease-protected and recovered on the next start.
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch { /* already gone */ }
  } else {
    child.kill("SIGTERM");
  }
}

function stopAll() {
  for (const child of children.splice(0)) stopChild(child);
}
process.on("SIGINT", () => { stopAll(); process.exit(0); });
process.on("SIGTERM", () => { stopAll(); process.exit(0); });

function waitForServer(url, timeoutMs = 30_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`${url}/api/auth/local`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on("error", retry);
      function retry() {
        req.destroy?.();
        if (Date.now() - start > timeoutMs) return reject(new Error(`Server nicht bereit nach ${timeoutMs / 1000}s`));
        setTimeout(attempt, 300);
      }
    };
    attempt();
  });
}

function openBrowser(url) {
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    execFile(cmd, args, () => {});
  } catch {
    /* browser open is best-effort */
  }
}

function assertPortFree() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (err) =>
      reject(new Error(`Port ${port} ist belegt — läuft note-lm bereits? (Zweite Instanz?)`))
    );
    probe.once("listening", () => probe.close(() => resolve()));
    probe.listen(port, host);
  });
}

async function main() {
  await assertPortFree();
  console.log(`[note-lm] Server:   ${appUrl}  (nur Loopback)`);
  console.log(`[note-lm] Worker:   läuft als eigener Prozess (lease-geschützt)`);

  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", host, "-p", String(port)], {
    cwd: repo,
    stdio: "inherit",
    env: { ...process.env, PORT: String(port), HOSTNAME: host },
  });
  children.push(server);

  const worker = spawn(process.execPath, ["--import", "tsx", "workers/ingestion.ts"], {
    cwd: repo,
    stdio: "inherit",
  });
  children.push(worker);

  const died = (name) => (code) => {
    console.error(`[note-lm] ${name} wurde beendet (Code ${code}) — stoppe alles.`);
    stopAll();
    process.exit(1);
  };
  server.on("exit", died("Server"));
  worker.on("exit", died("Worker"));

  try {
    await waitForServer(appUrl);
  } catch (err) {
    console.error(`[note-lm] ${err.message}`);
    stopAll();
    process.exit(1);
  }

  console.log(`[note-lm] Bereit:   ${appUrl}`);
  if (!process.env.NOTELM_NO_BROWSER) {
    openBrowser(`${appUrl}/api/auth/local?start=1&next=/app`);
  }
}

main();
