#!/usr/bin/env node
// Probe: llama-server as managed loopback helper (llama.cpp, issue #2 dep).
// Stdlib only. Node >= 18. Run from anywhere; all paths absolute.
//
// Usage:
//   AUTH_MODE=env|flag|none node scripts/probes/llama-cpp/probe.mjs
// Env overrides: LLAMA_BIN, MODEL, HOST, API_KEY, START_ARGS (extra args, space-split).
//
// Lifecycle: spawn -> wait /health -> /v1/embeddings (auth checks) -> memory sample
// -> taskkill /T /F -> verify process tree gone. Prints a JSON summary.

import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { openSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = 'C:/Code Main/note-lm';
const BIN = process.env.LLAMA_BIN ?? `${ROOT}/.probe-downloads/llama-bin/llama-server.exe`;
const MODEL = process.env.MODEL ?? `${ROOT}/.probe-downloads/bge-small-en-v1.5-q8_0.gguf`;
const HOST = process.env.HOST ?? '127.0.0.1';
const AUTH_MODE = process.env.AUTH_MODE ?? 'env'; // 'env' | 'flag' | 'none'
const API_KEY = process.env.API_KEY ?? 'probe-key-2b7a91';
const TEXT = 'The quick brown fox jumps over the lazy dog';

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, HOST, () => { const { port } = s.address(); s.close(() => res(port)); });
    s.on('error', rej);
  });

const waitHealthy = async (port, timeoutMs = 30000) => {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`http://${HOST}:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return { ms: Date.now() - t0, body: await r.json() };
    } catch { /* not up yet */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`/health not ok within ${timeoutMs}ms`);
    await sleep(100);
  }
};

const embed = async (port, key) => {
  const t0 = Date.now();
  const r = await fetch(`http://${HOST}:${port}/v1/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ input: TEXT, model: 'probe' }),
    signal: AbortSignal.timeout(15000),
  });
  const body = r.status === 200 ? await r.json() : await r.text();
  return { status: r.status, ms: Date.now() - t0, body };
};

const get = async (port, path, key) => {
  const r = await fetch(`http://${HOST}:${port}${path}`, {
    ...(key ? { headers: { authorization: `Bearer ${key}` } } : {}),
    signal: AbortSignal.timeout(5000),
  });
  return r.status;
};

const memSample = (pid) => new Promise((res) => {
  execFile('powershell', ['-NoProfile', '-Command',
    `Get-Process -Id ${pid} | Select-Object WorkingSet64,PeakWorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`],
    { timeout: 10000 }, (err, stdout) => res(err ? { error: String(err) } : JSON.parse(stdout)));
});

const serverPidsAlive = () => new Promise((res) => {
  execFile('tasklist', ['/FI', 'IMAGENAME eq llama-server.exe', '/FO', 'CSV', '/NH'],
    { timeout: 10000 }, (err, stdout) => {
      if (err) return res(-1);
      res(stdout.split(/\r?\n/).filter((l) => l.toLowerCase().startsWith('"llama-server')).length);
    });
});

const run = async () => {
  const port = await freePort();
  const args = ['-m', MODEL, '--embeddings', '--pooling', 'mean',
    '--host', HOST, '--port', String(port), '--no-webui'];
  if (AUTH_MODE === 'flag') args.push('--api-key', API_KEY);
  const env = { ...process.env };
  if (AUTH_MODE === 'env') env.LLAMA_API_KEY = API_KEY;
  if (process.env.START_ARGS) args.push(...process.env.START_ARGS.split(' ').filter(Boolean));

  const logPath = `${ROOT}/.probe-downloads/server-${AUTH_MODE}.log`;
  const logFd = openSync(logPath, 'a');
  const t0 = Date.now();
  const child = spawn(BIN, args, { cwd: BIN.replace(/[^/\\]+$/, ''), env, stdio: ['ignore', logFd, logFd] });
  const pid = child.pid;

  try {
    const health = await waitHealthy(port);
    const noKeyEmbed = await embed(port, null);        // must FAIL if auth enforced
    const badKeyEmbed = await embed(port, 'wrong-key'); // must FAIL if auth enforced
    const okEmbed = await embed(port, API_KEY);         // must succeed
    const healthNoKey = await get(port, '/health', null);
    const modelsNoKey = await get(port, '/v1/models', null);
    const mem = await memSample(pid);

    const vec = okEmbed.body?.data?.[0]?.embedding;
    const summary = {
      authMode: AUTH_MODE, pid, port, log: logPath,
      startupMs: health.ms, healthBody: health.body,
      embedNoKey: { status: noKeyEmbed.status, bodySnippet: String(noKeyEmbed.body).slice(0, 120) },
      embedBadKey: { status: badKeyEmbed.status },
      embedOk: {
        status: okEmbed.status, ms: okEmbed.ms,
        dim: vec?.length ?? null,
        first5: vec?.slice(0, 5) ?? null,
      },
      unauthenticated: { health: healthNoKey, models: modelsNoKey },
      memory: mem,
    };

    // kill process tree and verify
    await new Promise((res) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'],
      { timeout: 15000 }, () => res()));
    const exit = await new Promise((res) => child.once('exit', (c, s) => res({ code: c, signal: s })));
    let alive; let killWaitMs = 0;
    const killT0 = Date.now();
    do { alive = await serverPidsAlive(); killWaitMs = Date.now() - killT0; if (alive > 0) await sleep(200); }
    while (alive > 0 && killWaitMs < 5000);
    summary.kill = { taskkillExit: exit, serverExesRemaining: alive, goneAfterMs: killWaitMs };
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = (okEmbed.status === 200 && vec?.length > 0 && noKeyEmbed.status !== 200) ? 0 : 1;
  } catch (e) {
    console.error('PROBE FAILED:', e.message, '— see', logPath);
    await new Promise((res) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 15000 }, () => res()));
    process.exitCode = 2;
  }
};

run();
