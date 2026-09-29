/**
 * PI-2 four-arm eval runner (PageIndex decision run).
 *
 * Arms, all sharing one fresh temp ingest DB, one index phase, one run pass,
 * the identical chat model (Qwen2.5-7B-Instruct Q4_K_M on the eval-only
 * llama.cpp CUDA build), max_tokens 512, temperature 0, and one identical
 * answer rule for every arm (ANSWER_RULE below == pi2_bridge.py ANSWER_RULE;
 * for the SDK arms it rides a system message).
 *
 *   fts          - FTS5/BM25 top chunks -> context-prompt answer (7B)
 *   hybrid       - FTS5+vec RRF top chunks -> context-prompt answer (7B)
 *   pageindex    - SDK agent (Flash trees) scoped to the question's doc set
 *                  (answerable: expected docs; unanswerable: full corpus,
 *                  wall-budgeted) - answer + read pages come from the agent run
 *   hybrid+tree  - hybrid retrieval selects top-3 docs, SDK agent explores
 *                  those docs only
 *
 * Usage:
 *   npx tsx eval/harness/run-pi2-eval.mts --subset dev [--arms ...] [--limit N]
 *
 * Pre-registration: pi2-criteria.md (fixed 2026-09-28). The dev subset is
 * the tuning pass; the eval subset runs ONCE against frozen arm configs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { randomBytes } from "node:crypto";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { AddressInfo, createServer } from "node:net";
import { parseArgs } from "node:util";
import { PDFParse } from "pdf-parse";

import { openLocalDb, closeLocalDb } from "../../src/db/local";
import { createNotebook } from "../../src/lib/services/notebooks";
import {
  createSource,
  replaceChunks,
  updateSourceStatus,
  getChunksByNotebook,
} from "../../src/lib/services/sources";
import { chunkText } from "../../src/lib/text-extraction";
import { searchChunks } from "../../src/lib/services/search";
import { searchHybrid } from "../../src/lib/services/hybrid-search";
import { registerEmbeddingProfile } from "../../src/lib/services/embedding-profiles";
import { indexNotebookChunks } from "../../src/lib/services/vector-index";
import { llamaEmbed, waitForLlamaHealth } from "../../src/lib/ai/llama-supervisor";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const CORPUS_DIR = path.join(REPO, "eval", "corpus", "document-trees-v1");
const RESULTS_DIR = path.join(REPO, "eval", "harness", "results");
const LLAMA_DIR = path.join(REPO, ".probe-downloads", "llama-bin");
const MODEL = path.join(REPO, ".probe-downloads", "bge-small-en-v1.5-q8_0.gguf");
const CHAT_LLAMA_DIR = path.join(REPO, ".probe-downloads", "llama-cuda");
const CHAT_MODEL = path.join(REPO, ".probe-downloads", "qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf");
const CHAT_ALIAS = "Qwen2.5-7B-Instruct";
const VENV_PYTHON = path.join(REPO, "eval", "pageindex-proto", ".venv", "Scripts", "python.exe");
const BRIDGE = path.join(REPO, "eval", "pageindex-proto", "pi2_bridge.py");
const PI2_STORE = path.join(REPO, "eval", "pageindex-proto", "pi2_store");
const OWNER = "eval-harness";
const DIMENSION = 384;
const CHUNK_WORDS = 180;
const CHUNK_OVERLAP = 40;
const EMBED_RECIPE = {
  provider: "llamacpp",
  model: "bge-small-en-v1.5",
  revision: "q8_0",
  dimension: 384,
  pooling: "mean",
} as const;
const TOP_K = 10;
const CTX_CHUNKS = 6;
const MAX_TOKENS = 512;
const QUESTION_WALL_CAP_MS = 90_000;
const BRIDGE_TIMEOUT_S = 85;
const CHAT_TIMEOUT_MS = 60_000;

/** Identical for all four arms (mirrored in eval/pageindex-proto/pi2_bridge.py). */
const ANSWER_RULE =
  "Answer using ONLY the content of the user's documents. Cite every page you used with the format [<document name>, p. N]. " +
  'If the documents do not contain the answer, reply with exactly: "La información no está en los documentos." ' +
  "Do not use general knowledge.";

/* ------------------------------------------------------------------ types */

interface RankedHit {
  docId: string;
  page: number;
  lastPage: number;
  score: number;
  rank: number;
  chunkId?: string;
}

/** One arm invocation for one question: hits + generated answer. */
interface ArmRun {
  outcome: "ok" | "timeout" | "error";
  latencyMs: number;      // end-to-end per-question wall time (budget metric)
  retrievalMs: number;    // retrieval portion only (fts/hybrid: search call)
  answerMs: number | null; // answer-generation portion (null when the arm IS the answerer)
  hits: RankedHit[];
  answer: string;
  readPages: Array<{ docName?: string; docId?: string; pages?: unknown; resolved?: boolean }>;
  toolCalls: Array<{ name: string; arguments: unknown; output?: unknown }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  error?: string;
}

interface Pi2Question {
  id: string;
  subset: string;
  type: string;
  language: string;
  question: string;
  docIds: string[];
  expectedEvidence: Array<{ docId: string; page: number; section?: string; quoteSnippet?: string }>;
  expectedAnswer: string;
  probeTerm?: string;
}

interface ManifestDoc { docId: string; fileName: string; pages: number; language: string; toc: boolean; notes: string[] }

/* -------------------------------------------------------------------- cli */

const { values } = parseArgs({
  options: {
    subset: { type: "string", default: "dev" },
    arms: { type: "string", default: "fts,hybrid,pageindex,hybrid+tree" },
    limit: { type: "string", default: "" },
    "force-index": { type: "boolean", default: false },
  },
});
const subset = values.subset as "dev" | "eval";
if (subset !== "dev" && subset !== "eval") throw new Error(`--subset must be dev|eval, got ${values.subset}`);
const armNames = values.arms.split(",").map((v) => v.trim()).filter(Boolean);
for (const a of armNames) {
  if (!["fts", "hybrid", "pageindex", "hybrid+tree"].includes(a)) throw new Error(`unknown arm: ${a}`);
}
const limit = values.limit ? Number(values.limit) : Infinity;
const needChatServer = armNames.length > 0; // answer generation for every arm uses the 7B
const needBridge = armNames.some((a) => a.includes("pageindex") || a.includes("tree"));

/* ------------------------------------------------- process helpers (win) */

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/** Windows needs an explicit tree kill (signals don't reach children). */
function stopTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
        .on("exit", () => resolve());
    } else {
      child.kill("SIGTERM");
      child.once("exit", () => resolve());
    }
  });
}

function execFileP(cmd: string, args: string[], timeoutMs = 600_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

interface ChatHandle { baseUrl: string; token: string; pid: number; stop(): Promise<void> }

/**
 * Eval-only llama.cpp CUDA build (b11233) with the Qwen2.5-7B Q4_K_M split
 * GGUF, exactly the flags gpu7b-verify.md validated: -ngl 99 (all layers on
 * the GTX 1080), -c 8192, --jinja (tool calling for the SDK agents).
 */
async function startChatServer(): Promise<ChatHandle> {
  const port = await freePort();
  const token = randomBytes(24).toString("hex");
  const child = spawn(
    path.join(CHAT_LLAMA_DIR, "llama-server.exe"),
    [
      "-m", CHAT_MODEL,
      "--host", "127.0.0.1",
      "--port", String(port),
      "--alias", CHAT_ALIAS,
      "-ngl", "99",
      "-c", "8192",
      "--jinja",
      "--no-webui",
      "--api-key", token,
    ],
    {
      cwd: CHAT_LLAMA_DIR,
      env: { ...process.env, LLAMA_API_KEY: token },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    }
  );
  let stderrTail = "";
  child.stderr?.on("data", (d: Buffer) => { stderrTail = (stderrTail + d.toString()).slice(-4000); });
  try {
    await waitForLlamaHealth(`http://127.0.0.1:${port}`, 120_000);
  } catch (err) {
    await stopTree(child);
    throw new Error(`chat server failed: ${String(err)}; stderr tail: ${stderrTail}`);
  }
  return { baseUrl: `http://127.0.0.1:${port}`, token, pid: child.pid ?? -1, stop: () => stopTree(child) };
}

interface BridgeHandle {
  ask(req: Record<string, unknown>): Promise<Record<string, unknown>>;
  stop(): Promise<void>;
}

/** JSON-line bridge to the PageIndex SDK process (pi2_bridge.py serve). */
async function startBridge(chat: ChatHandle): Promise<BridgeHandle> {
  const child = spawn(VENV_PYTHON, [BRIDGE, "serve", "--store", PI2_STORE, "--server-url", chat.baseUrl, "--api-key", chat.token],
    {
      cwd: path.dirname(BRIDGE),
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[bridge] ${d}`));
  const pending = new Map<number, (v: Record<string, unknown>) => void>();
  let buf = "";
  let nextId = 1;
  child.stdout?.on("data", (d: Buffer) => {
    buf += d.toString();
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(line); } catch { console.warn(`[bridge] unparsable line: ${line.slice(0, 200)}`); continue; }
      if (typeof msg.event === "string") {
        if (msg.event === "ready") console.log(`[bridge] ready, ${msg.docs} docs in store`);
        else console.log(`[bridge] event: ${line.slice(0, 300)}`);
        continue;
      }
      const resolver = pending.get(Number(msg.id));
      if (resolver) { pending.delete(Number(msg.id)); resolver(msg); }
    }
  });
  const ready = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("bridge not ready in 120s")), 120_000);
    child.stdout?.once("data", () => {});
    const onData = (d: Buffer) => {
      if (String(d).includes('"ready"')) { clearTimeout(t); resolve(); }
    };
    child.stdout?.prependListener("data", onData);
    child.once("exit", (code) => reject(new Error(`bridge exited (code ${code}) before ready`)));
  });
  await ready;
  return {
    async ask(req) {
      const id = nextId++;
      const line = JSON.stringify({ ...req, id }) + "\n";
      return new Promise((resolve, reject) => {
        pending.set(id, resolve);
        child.stdin?.write(line, (err) => { if (err) { pending.delete(id); reject(err); } });
        // hard safety net (python enforces its own per-request timeout)
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); resolve({ id, outcome: "timeout", answer: "", hits: [], readPages: [], toolCalls: [], usage: null }); }
        }, QUESTION_WALL_CAP_MS + 30_000);
      });
    },
    async stop() { await stopTree(child); },
  };
}

/* ------------------------------------------------------- perf sampling */

interface ResourcePeak { vramUsedMaxMiB: number; ramWorkingSetMaxMB: number; samples: number }

function startSampler(pids: number[], intervalMs = 3000) {
  const peak: ResourcePeak = { vramUsedMaxMiB: 0, ramWorkingSetMaxMB: 0, samples: 0 };
  let stopped = false;
  const tick = async () => {
    while (!stopped) {
      try {
        const vram = await execFileP("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], 10_000);
        const used = parseInt(vram.trim().split("\n")[0], 10);
        if (Number.isFinite(used)) peak.vramUsedMaxMiB = Math.max(peak.vramUsedMaxMiB, used);
      } catch { /* no nvidia-smi */ }
      for (const pid of pids) {
        if (pid <= 0) continue;
        try {
          const out = await execFileP("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], 10_000);
          const m = /"([\d.,]+) K"/.exec(out);
          if (m) {
            const kb = parseInt(m[1].replace(/[.,]/g, ""), 10);
            if (Number.isFinite(kb)) peak.ramWorkingSetMaxMB = Math.max(peak.ramWorkingSetMaxMB, kb / 1024);
          }
        } catch { /* process gone */ }
      }
      peak.samples++;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  void tick();
  return { peak, stop() { stopped = true; } };
}

/* ------------------------------------------------------------------- main */

interface LiveHandles {
  embedLlama: LlamaHandle | null;
  chat: ChatHandle | null;
  bridge: BridgeHandle | null;
  dataDir: string | null;
  db: ReturnType<typeof openLocalDb> | null;
}
const live: LiveHandles = { embedLlama: null, chat: null, bridge: null, dataDir: null, db: null };

async function main(): Promise<void> {
  const t0 = performance.now();
  const cleanup = async () => {
    await live.bridge?.stop();
    await live.chat?.stop();
    await live.embedLlama?.stop();
    if (live.db) closeLocalDb(live.db);
    if (live.dataDir) fs.rmSync(live.dataDir, { recursive: true, force: true });
  };
  try {
    await runEval();
  } finally {
    await cleanup();
  }
  console.log(`total wall: ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}

interface LlamaHandle {
  baseUrl: string;
  token: string;
  pid: number;
  embed(input: string): Promise<number[]>;
  stop(): Promise<void>;
}

async function startEmbedServer(modelPath: string): Promise<LlamaHandle> {
  const port = await freePort();
  const token = randomBytes(24).toString("hex");
  const child = spawn(
    path.join(LLAMA_DIR, "llama-server.exe"),
    [
      "-m", modelPath,
      "--embeddings",
      "--pooling", "mean",
      "--host", "127.0.0.1",
      "--port", String(port),
      "--no-webui",
      "--ctx-size", "1024",
      "--ubatch-size", "1024",
    ],
    {
      cwd: LLAMA_DIR,
      env: { ...process.env, LLAMA_API_KEY: token },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    }
  );
  child.stderr?.on("data", () => {});
  try {
    await waitForLlamaHealth(`http://127.0.0.1:${port}`, 60_000);
  } catch (err) {
    await stopTree(child);
    throw err;
  }
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    token,
    pid: child.pid ?? -1,
    embed: (input) => llamaEmbed(`http://127.0.0.1:${port}`, token, input),
    stop: () => stopTree(child),
  };
}

async function runEval(): Promise<void> {
  const t0 = performance.now();

  /* -------------------------------------------------- chat server + store */
  const chat = await startChatServer();
  live.chat = chat;
  console.log(`[chat] llama-cuda server on :${chat.baseUrl.split(":")[2]} pid ${chat.pid} (${CHAT_ALIAS})`);

  const storeFile = path.join(PI2_STORE, "manifest.json");
  const storeReady = needBridge && fs.existsSync(storeFile) && (() => {
    try {
      const m = JSON.parse(fs.readFileSync(storeFile, "utf8")) as { docs: Record<string, unknown> };
      return Object.keys(m.docs ?? {}).length;
    } catch { return 0; }
  })();
  const INDEXABLE_DOCS = 19; // 21 minus the two docs neither flash nor standard can index
  if (needBridge && storeReady < INDEXABLE_DOCS) {
    console.log(`[index] PageIndex store has ${storeReady} docs; building flash indexes (this can take a while)...`);
    const indexStart = performance.now();
    await execFileP(VENV_PYTHON, [BRIDGE, "index", "--store", PI2_STORE, "--server-url", chat.baseUrl, "--api-key", chat.token,
      "--out", path.join(REPO, "eval", "pageindex-proto", "pi2-index-report.json")], 3_600_000);
    console.log(`[index] PageIndex flash index done in ${((performance.now() - indexStart) / 1000).toFixed(1)}s`);
  }

  if (needBridge) live.bridge = await startBridge(chat);
  const bridge = live.bridge;

  /* ---------------------------------------------------- phase: ingest */
  const ingestStart = performance.now();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-pi2-eval-"));
  live.dataDir = dataDir;
  const db = openLocalDb(dataDir);
  live.db = db;
  const notebookId = await createNotebook(db, { ownerId: OWNER, title: `PageIndex PI-2 corpus (${subset})` });

  const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, "manifest.json"), "utf8")) as { docs: ManifestDoc[] };
  const allQuestions = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, "questions.json"), "utf8")) as { questions: Pi2Question[] };
  const questions = allQuestions.questions.filter((q) => q.subset === subset).slice(0, limit);
  const fileNameByDoc = new Map(manifest.docs.map((d) => [d.docId, d.fileName]));
  const pagesByDoc = new Map(manifest.docs.map((d) => [d.docId, d.pages]));
  const ALL_DOC_IDS = manifest.docs.map((d) => d.docId);

  const pageStartByDoc = new Map<string, number[]>();
  const wordCountByDoc = new Map<string, number>();
  const docIdBySourceId = new Map<string, string>();
  const pageTextByDoc = new Map<string, string[]>();
  let totalChunks = 0;
  for (const doc of manifest.docs) {
    const buf = fs.readFileSync(path.join(CORPUS_DIR, doc.fileName));
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    let pageTexts: string[];
    try {
      const r = await parser.getText();
      pageTexts = r.pages.map((p) => p.text);
    } finally {
      await parser.destroy();
    }
    if (pageTexts.length !== doc.pages) {
      throw new Error(`${doc.docId}: pdf has ${pageTexts.length} pages, manifest says ${doc.pages}`);
    }
    const fullText = pageTexts.join("\n\n");
    const pageStart: number[] = [];
    let prefix = "";
    for (const text of pageTexts) {
      pageStart.push(prefix.split(/\s+/).length - 1);
      prefix = prefix ? `${prefix}\n\n${text}` : text;
    }
    pageStartByDoc.set(doc.docId, pageStart);
    wordCountByDoc.set(doc.docId, fullText.split(/\s+/).length);
    pageTextByDoc.set(doc.docId, pageTexts);

    const sourceId = await createSource(db, {
      ownerId: OWNER,
      notebookId,
      fileName: doc.fileName,
      fileType: "application/pdf",
      fileSize: buf.length,
    });
    docIdBySourceId.set(sourceId, doc.docId);
    const chunks = chunkText(fullText, CHUNK_WORDS, CHUNK_OVERLAP);
    replaceChunks(db, { ownerId: OWNER, sourceId, notebookId }, chunks);
    await updateSourceStatus(db, sourceId, { status: "completed" });
    totalChunks += chunks.length;
  }
  const ingestMs = performance.now() - ingestStart;
  console.log(`[ingest] ${manifest.docs.length} docs, ${totalChunks} chunks in ${(ingestMs / 1000).toFixed(1)}s (db: ${dataDir})`);

  /* ----------------------------------------------------- phase: index */
  let indexMs = 0;
  let profileId: string | null = null;
  let embedLlama: LlamaHandle | null = null;
  let totalIndexed = 0;
  if (armNames.includes("hybrid")) {
    if (!fs.existsSync(path.join(LLAMA_DIR, "llama-server.exe")) || !fs.existsSync(MODEL)) {
      throw new Error("hybrid arm needs llama artifacts (.probe-downloads/llama-bin + bge gguf)");
    }
    const indexStart = performance.now();
    embedLlama = await startEmbedServer(MODEL);
    live.embedLlama = embedLlama;
    const profile = await registerEmbeddingProfile(db, { ...EMBED_RECIPE });
    profileId = profile._id;
    for (;;) {
      const r = await indexNotebookChunks(db, {
        profileId,
        dimension: DIMENSION,
        notebookId,
        batchSize: 16,
        embed: async (texts) => {
          const out: Buffer[] = [];
          for (const t of texts) out.push(float32(await embedLlama!.embed(t)));
          return out;
        },
      });
      if (r.indexed + r.skipped === 0) break;
      totalIndexed += r.indexed;
    }
    indexMs = performance.now() - indexStart;
    console.log(`[index] ${totalIndexed} chunks embedded via ${EMBED_RECIPE.model} in ${(indexMs / 1000).toFixed(1)}s`);
  }

  const sampler = startSampler([chat.pid, embedLlama?.pid ?? -1]);

  /* ------------------------------------------------------- phase: run */
  const runStart = performance.now();
  const queryVectors = new Map<string, Buffer>();
  if (embedLlama) {
    for (const q of questions) {
      queryVectors.set(q.question, float32(await embedLlama.embed(q.question)));
    }
  }

  const chunkMeta = new Map<string, { docId: string; page: number; lastPage: number }>();
  const chunkTextById = new Map<string, string>();
  const chunkRows = getChunksByNotebook(db, notebookId);
  const chunkIdsBySource = new Map<string, string[]>();
  for (const c of chunkRows) {
    chunkTextById.set((c as unknown as { _id: string })._id, (c as unknown as { content: string }).content);
    const arr = chunkIdsBySource.get(c.sourceId) ?? [];
    arr.push((c as unknown as { _id: string })._id);
    chunkIdsBySource.set(c.sourceId, arr);
  }
  for (const [sourceId, docId] of docIdBySourceId) {
    const arr = chunkIdsBySource.get(sourceId) ?? [];
    const pageStart = pageStartByDoc.get(docId)!;
    const totalWords = wordCountByDoc.get(docId)!;
    arr.forEach((chunkId, j) => {
      const startWord = j * (CHUNK_WORDS - CHUNK_OVERLAP);
      const endWord = Math.min(startWord + CHUNK_WORDS, totalWords) - 1;
      const pageOf = (word: number) => {
        let page = 0;
        for (let p = 0; p < pageStart.length; p++) {
          if (pageStart[p] <= word) page = p;
        }
        return page + 1;
      };
      chunkMeta.set(chunkId, { docId, page: pageOf(startWord), lastPage: pageOf(endWord) });
    });
  }

  /** Answer generation with the 7B for the fts/hybrid arms: top chunks with
   *  page labels as context, ANSWER_RULE, temperature 0, max_tokens 512. */
  async function contextAnswer(question: string, hits: RankedHit[]): Promise<{ answer: string; usage: ArmRun["usage"]; answerMs: number }> {
    const blocks = hits.slice(0, CTX_CHUNKS).map((h) => {
      const name = fileNameByDoc.get(h.docId) ?? h.docId;
      const text = chunkTextById.get(h.chunkId ?? "") ?? "";
      const span = h.lastPage > h.page ? `${h.page}-${h.lastPage}` : `${h.page}`;
      return `[${name}, p. ${span}]\n${text}`;
    });
    const prompt = `${ANSWER_RULE}\n\nDocument excerpts:\n\n${blocks.join("\n\n")}\n\nQuestion: ${question}`;
    const t = performance.now();
    const res = await fetch(`${chat!.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${chat!.token}` },
      body: JSON.stringify({ model: CHAT_ALIAS, messages: [{ role: "user", content: prompt }], temperature: 0, max_tokens: MAX_TOKENS }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`chat completion failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    return {
      answer: data.choices?.[0]?.message?.content ?? "",
      usage: data.usage ?? null,
      answerMs: performance.now() - t,
    };
  }

  function withWallCap<T>(p: Promise<T>, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`WALLCAP:${label}`)), QUESTION_WALL_CAP_MS);
      p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
  }

  const ftsRunner = async (question: string): Promise<RankedHit[]> => {
    const hits = searchChunks(db!, notebookId, question, TOP_K);
    return hits.map((h, i) => {
      const meta = chunkMeta.get(h.chunkId) ?? { docId: "?", page: -1, lastPage: -1 };
      return { docId: meta.docId, page: meta.page, lastPage: meta.lastPage, score: -h.rank, rank: i + 1, chunkId: h.chunkId };
    });
  };

  const hybridRunner = async (question: string): Promise<RankedHit[]> => {
    const result = await searchHybrid(db!, {
      notebookId,
      query: question,
      profile: profileId ? { id: profileId, dimension: DIMENSION } : null,
      embedQuery: (q) => {
        const v = queryVectors.get(q);
        if (!v) throw new Error(`query not pre-embedded: ${q}`);
        return v;
      },
      limit: TOP_K,
    });
    if (result.vectorStatus !== "ok") console.warn(`[warn] hybrid vectorStatus=${result.vectorStatus}`);
    return result.hits.map((h, i) => {
      const meta = chunkMeta.get(h.chunkId) ?? { docId: "?", page: -1, lastPage: -1 };
      return { docId: meta.docId, page: meta.page, lastPage: meta.lastPage, score: h.score, rank: i + 1, chunkId: h.chunkId };
    });
  };

  /** Scoped selection mirroring the plan's Profunda mode: run PageIndex over
   *  the SAME source selection the question is graded against (answerable:
   *  expected doc set; unanswerable: full corpus, wall-budgeted). */
  const pageindexRunner = async (q: Pi2Question): Promise<ArmRun> => {
    const docIds = q.docIds.length > 0 ? q.docIds : null; // null = full corpus (unanswerable)
    return bridgeArm(q, docIds, "pageindex");
  };

  /** Automática per the plan: hybrid retrieval selects candidate docs
   *  (top-3 distinct docs by best rank), PageIndex explores only those. */
  const hybridTreeRunner = async (q: Pi2Question): Promise<ArmRun> => {
    const perDoc = new Map<string, number>();
    for (const h of hybridHitsCache.get(q.id) ?? []) {
      const best = perDoc.get(h.docId);
      if (best === undefined || h.rank < best) perDoc.set(h.docId, h.rank);
    }
    const docIds = [...perDoc.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([d]) => d);
    return bridgeArm(q, docIds.length > 0 ? docIds : null, "hybrid+tree");
  };

  async function bridgeArm(q: Pi2Question, docIds: string[] | null, arm: string): Promise<ArmRun> {
    const t = performance.now();
    const res = await withWallCap(
      bridge!.ask({
        question: q.question,
        docIds,
        maxTurns: 14,
        maxTokens: MAX_TOKENS,
        timeoutS: BRIDGE_TIMEOUT_S,
      }),
      arm
    ) as Record<string, unknown>;
    const latency = performance.now() - t;
    const outcome = String(res.outcome ?? "error") as ArmRun["outcome"];
    return {
      outcome: outcome === "ok" ? "ok" : "error", // "max_turns" from the bridge = agent did not finish: failure, counted in the denominator
      latencyMs: latency,
      retrievalMs: latency,
      answerMs: null,
      hits: (res.hits ?? []) as RankedHit[],
      answer: String(res.answer ?? ""),
      readPages: (res.readPages ?? []) as ArmRun["readPages"],
      toolCalls: (res.toolCalls ?? []) as ArmRun["toolCalls"],
      usage: (res.usage ?? null) as ArmRun["usage"],
      error: res.error ? String(res.error) : (outcome === "timeout" ? `wall cap ${QUESTION_WALL_CAP_MS / 1000}s exceeded` : undefined),
    };
  }

  /* --------------------------------------------- run loop (all arms) */
  interface RunRow {
    id: string;
    type: string;
    language: string;
    question: string;
    docIds: string[];
    expected: Array<{ docId: string; page: number; section?: string; quoteSnippet?: string }>;
    expectedAnswer: string;
    probeTerm?: string;
    perArm: Record<string, ArmRun>;
  }
  const runRows: RunRow[] = [];
  const hybridHitsCache = new Map<string, RankedHit[]>();
  for (const q of questions) {
    const perArm: Record<string, ArmRun> = {};
    if (armNames.includes("fts")) {
      perArm.fts = await runArm("fts", async () => {
        const t = performance.now();
        const hits = await ftsRunner(q.question);
        const retrievalMs = performance.now() - t;
        const gen = await contextAnswer(q.question, hits);
        return {
          outcome: "ok", latencyMs: retrievalMs + gen.answerMs, retrievalMs, answerMs: gen.answerMs,
          hits, answer: gen.answer, readPages: [], toolCalls: [], usage: gen.usage,
        };
      });
    }
    if (armNames.includes("hybrid")) {
      perArm.hybrid = await runArm("hybrid", async () => {
        const t = performance.now();
        const hits = await hybridRunner(q.question);
        const retrievalMs = performance.now() - t;
        const gen = await contextAnswer(q.question, hits);
        return {
          outcome: "ok", latencyMs: retrievalMs + gen.answerMs, retrievalMs, answerMs: gen.answerMs,
          hits, answer: gen.answer, readPages: [], toolCalls: [], usage: gen.usage,
        };
      });
      hybridHitsCache.set(q.id, perArm.hybrid.hits);
    }
    if (armNames.includes("pageindex")) perArm.pageindex = await runArm("pageindex", () => pageindexRunner(q));
    if (armNames.includes("hybrid+tree")) perArm["hybrid+tree"] = await runArm("hybrid+tree", () => hybridTreeRunner(q));
    runRows.push({
      id: q.id, type: q.type, language: q.language, question: q.question, docIds: q.docIds,
      expected: q.expectedEvidence, expectedAnswer: q.expectedAnswer, probeTerm: q.probeTerm, perArm,
    });
    const done = runRows.length;
    if (done % 5 === 0) console.log(`[run] ${done}/${questions.length} questions done`);
  }
  const runMs = performance.now() - runStart;

  async function runArm(name: string, fn: () => Promise<ArmRun>): Promise<ArmRun> {
    const t = performance.now();
    try {
      const r = await fn();
      return r;
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      const outcome: ArmRun["outcome"] = msg.startsWith("WALLCAP") ? "timeout" : "error";
      return {
        outcome, latencyMs: performance.now() - t, retrievalMs: performance.now() - t, answerMs: null,
        hits: [], answer: "", readPages: [], toolCalls: [], usage: null, error: msg,
      };
    }
  }

  /* ----------------------------------------------------- phase: grade */
  const gradeStart = performance.now();
  const armReports: Record<string, unknown> = {};
  for (const name of armNames) {
    const answerable = runRows.filter((r) => r.expected.length > 0);
    const unanswerable = runRows.filter((r) => r.expected.length === 0);
    const perQuestion = answerable.map((r) => {
      const m10 = gradeRanked(r.perArm[name]?.hits ?? [], r.expected, 10);
      const m5 = gradeRanked(r.perArm[name]?.hits ?? [], r.expected, 5);
      const strict10 = gradeRanked(
        (r.perArm[name]?.hits ?? []).map((h) => ({ ...h, lastPage: h.page })),
        r.expected, 10
      );
      return {
        id: r.id, type: r.type,
        recallAt5: m5.recall, recallAt10: m10.recall, mrr: m10.mrr, ndcgAt10: m10.ndcg,
        docIdRecallAt10: m10.docIdRecall, firstPageRecallAt10: strict10.recall,
      };
    });
    const avg = (sel: (q: (typeof perQuestion)[number]) => number) =>
      perQuestion.length ? perQuestion.reduce((s, q) => s + sel(q), 0) / perQuestion.length : 0;

    const latencies = runRows.map((r) => r.perArm[name]?.latencyMs ?? 0);
    const retrievalLatencies = runRows.map((r) => r.perArm[name]?.retrievalMs ?? 0);
    const outcomeCount = (o: string) => runRows.filter((r) => r.perArm[name]?.outcome === o).length;
    const tokens = runRows.reduce(
      (acc, r) => {
        const u = r.perArm[name]?.usage;
        if (u) { acc.prompt += u.prompt_tokens; acc.completion += u.completion_tokens; acc.questions += 1; }
        return acc;
      }, { prompt: 0, completion: 0, questions: 0 });

    armReports[name] = {
      answerable: { count: answerable.length, perQuestion, recallAt10: avg((q) => q.recallAt10),
        recallAt5: avg((q) => q.recallAt5), mrr: avg((q) => q.mrr), ndcgAt10: avg((q) => q.ndcgAt10),
        docIdRecallAt10: avg((q) => q.docIdRecallAt10), firstPageRecallAt10: avg((q) => q.firstPageRecallAt10) },
      unanswerableCount: unanswerable.length,
      outcomes: { ok: outcomeCount("ok"), timeout: outcomeCount("timeout"), error: outcomeCount("error") },
      tokens,
      perf: {
        e2eP50Ms: percentile(latencies, 0.5),
        e2eP95Ms: percentile(latencies, 0.95),
        e2eMeanMs: latencies.reduce((s, v) => s + v, 0) / (latencies.length || 1),
        retrievalP50Ms: percentile(retrievalLatencies, 0.5),
        retrievalP95Ms: percentile(retrievalLatencies, 0.95),
        note: "e2e = retrieval + answer generation per question (budget metric); retrieval = search/agent portion only",
      },
    };
  }
  const gradeMs = performance.now() - gradeStart;
  sampler.stop();
  console.log(`[grade] done in ${(gradeMs / 1000).toFixed(1)}s; peak VRAM ${sampler.peak.vramUsedMaxMiB} MiB, peak llama RAM ${sampler.peak.ramWorkingSetMaxMB.toFixed(0)} MB`);

  /* ---------------------------------------------------------- output */
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  const slug = `pi2-${subset}-${armNames.join("+").replace(/\+/g, "_")}-${timestamp.replace(/[:.]/g, "-")}`;
  const resultFile = path.join(RESULTS_DIR, `${slug}.json`);
  const result = {
    meta: {
      timestamp, subset, arms: armNames, questionCount: questions.length,
      corpus: "document-trees-v1",
      model: { chat: CHAT_ALIAS, file: "qwen2.5-7b-instruct-q4_k_m split GGUF (sha256 in gpu7b-verify.md)",
        server: "llama.cpp b11233 CUDA 12.4 eval build, -ngl 99 -c 8192 --jinja", max_tokens: MAX_TOKENS, temperature: 0 },
      embedding: armNames.includes("hybrid") ? EMBED_RECIPE : null,
      chunking: { maxChunkSize: CHUNK_WORDS, overlap: CHUNK_OVERLAP, totalChunks, totalDocs: manifest.docs.length },
      answerRule: ANSWER_RULE,
      contextChunks: CTX_CHUNKS,
      selection: {
        pageindex: "answerable: expected doc set as scoped selection; unanswerable: full corpus (wall-budgeted)",
        "hybrid+tree": "hybrid top-3 distinct docs by best rank, tree exploration within those docs",
      },
      budgets: { perQuestionWallCapMs: QUESTION_WALL_CAP_MS, bridgeTimeoutS: BRIDGE_TIMEOUT_S, maxTurns: 14, chatTimeoutMs: CHAT_TIMEOUT_MS },
    },
    chatServer: { pid: chat!.pid, alias: CHAT_ALIAS },
    resources: { ...sampler.peak, note: "vramUsedMaxMiB = nvidia-smi total GPU memory used max; ramWorkingSetMaxMB = max working set over both llama-server pids" },
    phases: { ingestMs, indexMs, runMs, gradeMs, totalMs: performance.now() - t0 },
    retrievalGrade: armReports,
    questions: runRows,
    pageTexts: Object.fromEntries([...pageTextByDoc].map(([docId, pages]) => [docId, pages])),
  };
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  fs.appendFileSync(path.join(RESULTS_DIR, "history.jsonl"), JSON.stringify({
    timestamp, subset, variants: armNames, kind: "pi2",
    metrics: armReports,
  }) + "\n");
  console.log(`\n==== pi2-eval: subset=${subset} questions=${questions.length} arms=${armNames.join(",")} ====`);
  console.log(`phases: ingest ${(ingestMs / 1000).toFixed(1)}s | embed-index ${(indexMs / 1000).toFixed(1)}s | run ${(runMs / 1000).toFixed(1)}s | grade ${(gradeMs / 1000).toFixed(1)}s`);
  console.log("\narm          recall@10  docIdR@10  1stPgR@10  ok/timeout/error   e2e p50(ms)  e2e p95(ms)");
  for (const name of armNames) {
    const rep = armReports[name] as unknown as ArmReportShape;
    console.log([
      name.padEnd(12),
      fmt(rep.answerable.recallAt10).padEnd(10),
      fmt(rep.answerable.docIdRecallAt10).padEnd(10),
      fmt(rep.answerable.firstPageRecallAt10).padEnd(10),
      `${rep.outcomes.ok}/${rep.outcomes.timeout}/${rep.outcomes.error}`.padEnd(17),
      rep.perf.e2eP50Ms.toFixed(0).padEnd(11),
      rep.perf.e2eP95Ms.toFixed(0),
    ].join(" "));
  }
  console.log(`results: ${resultFile}`);
}

interface ArmReportShape {
  answerable: { recallAt10: number; docIdRecallAt10: number; firstPageRecallAt10: number };
  outcomes: { ok: number; timeout: number; error: number };
  perf: { e2eP50Ms: number; e2eP95Ms: number };
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? "-" : n.toFixed(3);
}

/* ----------------------------------------------------------------- utils */

function float32(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer);
}

interface ExpectedEvidence { docId: string; page: number }

/** Page-level grading of one ranked list (same rules as run-retrieval-eval). */
function gradeRanked(ranked: RankedHit[], expected: ExpectedEvidence[], k: number) {
  const top = ranked.slice(0, k);
  const remaining = new Set(expected.map((e) => `${e.docId}:${e.page}`));
  const expectedDocs = new Set(expected.map((e) => e.docId));
  let mrr = 0;
  let dcg = 0;
  const coveredDocs = new Set<string>();
  for (let i = 0; i < top.length; i++) {
    const h = top[i];
    const hitPages: string[] = [];
    for (let p = h.page; p <= h.lastPage; p++) hitPages.push(`${h.docId}:${p}`);
    const isHit = hitPages.some((key) => remaining.has(key));
    for (const key of hitPages) remaining.delete(key);
    if (isHit) {
      if (mrr === 0) mrr = 1 / (i + 1);
      dcg += 1 / Math.log2(i + 2);
    }
    if (expectedDocs.has(h.docId)) coveredDocs.add(h.docId);
  }
  const found = expected.length - remaining.size;
  const recall = expected.length ? found / expected.length : 1;
  const ideal = Array.from({ length: Math.min(expected.length, k) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
  const ndcg = ideal === 0 ? 1 : dcg / ideal;
  const docIdRecall = expectedDocs.size ? coveredDocs.size / expectedDocs.size : 1;
  return { recall, mrr, ndcg, docIdRecall };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

main().catch((err) => {
  console.error("pi2 eval failed:", err);
  process.exit(1);
});
