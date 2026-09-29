/**
 * T3 multilingual retrieval eval — eval/multilingual-proto
 * Adapted from eval/harness/run-retrieval-eval.mts (PageIndex PI harness).
 *
 * Arms (each recipe = own fresh DB + own registered embedding profile; the
 * app rule "recipe change = new index" is mirrored by construction):
 *   bge    — baseline bge-small-en-v1.5 q8_0 (384-dim, mean) via hybrid search
 *   qwen3  — Qwen3-Embedding-0.6B q8_0 (1024-dim) via llama-server /v1/embeddings
 *   rerank — Qwen3-Reranker-0.6B q8_0 /v1/rerank over the bge arm's top-20
 *
 * Usage:
 *   npx tsx eval/multilingual-proto/run-multilingual-eval.mts --recipe bge --subset dev
 *   npx tsx eval/multilingual-proto/run-multilingual-eval.mts --recipe qwen3 --subset dev --qwen-instruct on|off
 *   npx tsx eval/multilingual-proto/run-multilingual-eval.mts --recipe rerank --subset eval --rerank-depth 20
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
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
import { searchHybrid } from "../../src/lib/services/hybrid-search";
import { registerEmbeddingProfile } from "../../src/lib/services/embedding-profiles";
import { indexNotebookChunks, vectorSearch } from "../../src/lib/services/vector-index";
import { llamaEmbed, waitForLlamaHealth } from "../../src/lib/ai/llama-supervisor";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const CORPUS_DIR = path.join(REPO, "eval", "multilingual-proto", "corpus");
const RESULTS_DIR = path.join(REPO, "eval", "multilingual-proto", "results");
const LLAMA_DIR = path.join(REPO, ".probe-downloads", "llama-cuda");
const OWNER = "t3-multilingual-eval";
const TOP_K = 10;
const CHUNK_WORDS = 100;
const CHUNK_OVERLAP = 20;

const RECIPES = {
  bge: {
    label: "bge-small-en-v1.5 (baseline, app recipe)",
    modelFile: "bge-small-en-v1.5-q8_0.gguf",
    embedRecipe: { provider: "llamacpp", model: "bge-small-en-v1.5", revision: "q8_0", dimension: 384, pooling: "mean" },
    serverArgs: ["--embeddings", "--pooling", "mean", "--ctx-size", "1024", "--ubatch-size", "1024", "-ngl", "99"],
    instructCapable: false,
  },
  qwen3: {
    label: "Qwen3-Embedding-0.6B q8_0",
    modelFile: "qwen3-embedding-0.6b-q8_0.gguf",
    embedRecipe: { provider: "llamacpp", model: "Qwen3-Embedding-0.6B", revision: "q8_0", dimension: 1024, pooling: "last" },
    // pooling is NOT forced: the GGUF metadata carries the right pooler
    serverArgs: ["--embeddings", "--ctx-size", "8192", "--ubatch-size", "1024", "-ngl", "99"],
    instructCapable: true,
  },
} as const;

interface RankedHit { docId: string; page: number; lastPage: number; score: number; rank: number; }
interface Question {
  id: string; subset: "dev" | "eval"; type: string; language: string; pair: string;
  question: string; docIds: string[];
  expectedEvidence: Array<{ docId: string; page: number; section: string; quoteSnippet: string }>;
  probeTerm?: string;
}

const { values } = parseArgs({
  options: {
    recipe: { type: "string" },
    subset: { type: "string", default: "dev" },
    "qwen-instruct": { type: "string", default: "off" },
    "rerank-depth": { type: "string", default: "20" },
    mode: { type: "string", default: "hybrid" },
    limit: { type: "string", default: "" },
  },
});
const recipeName = values.recipe as string;
if (!recipeName || !(recipeName in RECIPES) && recipeName !== "rerank") {
  throw new Error("--recipe must be one of bge|qwen3|rerank");
}
const subset = values.subset as "dev" | "eval";
if (subset !== "dev" && subset !== "eval") throw new Error("--subset must be dev|eval");
const qwenInstruct = values["qwen-instruct"] === "on";
if (qwenInstruct && recipeName !== "qwen3") throw new Error("--qwen-instruct only applies to recipe qwen3");
const rerankDepth = Number(values["rerank-depth"]);
const mode = values.mode as "hybrid" | "vector";
if (mode !== "hybrid" && mode !== "vector") throw new Error("--mode must be hybrid|vector");
if (mode === "vector" && recipeName === "rerank") throw new Error("rerank arm runs on hybrid candidates");
const limit = values.limit ? Number(values.limit) : Infinity;

/* ------------------------------------------------------- llama (eval-only spawn) */

interface EmbedHandle { baseUrl: string; token: string; dim: number; embed(input: string): Promise<number[]>; stop(): Promise<void>; }

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

async function startEmbedServer(modelFile: string, extraArgs: string[]): Promise<EmbedHandle> {
  const modelPath = path.join(REPO, ".probe-downloads", modelFile);
  if (!fs.existsSync(path.join(LLAMA_DIR, "llama-server.exe")) || !fs.existsSync(modelPath)) {
    throw new Error(`missing llama artifacts: ${modelFile} (see .probe-downloads)`);
  }
  const port = await freePort();
  const token = randomBytes(24).toString("hex");
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    path.join(LLAMA_DIR, "llama-server.exe"),
    ["-m", modelPath, "--host", "127.0.0.1", "--port", String(port), "--no-webui", ...extraArgs],
    { cwd: LLAMA_DIR, env: { ...process.env, LLAMA_API_KEY: token }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
  );
  child.stderr?.on("data", () => {});
  try {
    await waitForLlamaHealth(baseUrl, 120_000);
  } catch (err) {
    await stopTree(child);
    throw err;
  }
  return { baseUrl, token, dim: -1, embed: (input) => llamaEmbed(baseUrl, token, input), stop: () => stopTree(child) };
}

/* --------------------------------------------------------------- rerank */

async function llamaRerank(baseUrl: string, token: string, query: string, documents: string[]): Promise<Array<{ index: number; relevance_score: number }>> {
  const res = await fetch(`${baseUrl}/v1/rerank`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: "qwen3-reranker", query, documents }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`rerank failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { results?: Array<{ index: number; relevance_score: number }> };
  if (!data.results) throw new Error("rerank: unexpected response shape");
  return data.results;
}

/* ----------------------------------------------------------------- main */

async function runEval() {
  const t0 = performance.now();

  /* phase: ingest (fresh DB per invocation — indexes never mix) */
  const ingestStart = performance.now();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-t3-eval-"));
  const db = openLocalDb(dataDir);
  const notebookId = await createNotebook(db, { ownerId: OWNER, title: `T3 multilingual corpus (${recipeName} ${subset})` });

  const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, "manifest.json"), "utf8")) as {
    docs: Array<{ docId: string; fileName: string; language: string; pages: number }>;
  };
  const allQuestions = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, "questions.json"), "utf8")) as { questions: Question[] };
  const questions = allQuestions.questions.filter((q) => q.subset === subset).slice(0, limit);

  const pageStartByDoc = new Map<string, number[]>();
  const wordCountByDoc = new Map<string, number>();
  const docIdBySourceId = new Map<string, string>();
  let totalChunks = 0;
  const chunkTexts = new Map<string, string>(); // chunkId -> text (for the rerank arm)
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
      throw new Error(`${doc.docId}: pdf pages ${pageTexts.length} != manifest ${doc.pages}`);
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
  console.log(`[ingest] ${manifest.docs.length} docs, ${totalChunks} chunks in ${(ingestMs / 1000).toFixed(1)}s`);

  /* phase: index (own profile per recipe) */
  let indexMs = 0;
  let profileId: string | null = null;
  let embedHandle: EmbedHandle | null = null;
  let rerankHandle: EmbedHandle | null = null;
  let totalIndexed = 0;
  let dimObserved = 0;
  let vectorBytes = 0;
  if (recipeName === "bge" || recipeName === "qwen3" || recipeName === "rerank") {
    const cfg = RECIPES[recipeName === "rerank" ? "bge" : recipeName];
    const embedRecipe: Record<string, unknown> = { ...cfg.embedRecipe };
    if (recipeName === "qwen3") {
      // query-instruction prefix is part of the profile identity (app rule)
      embedRecipe.queryPrefix = qwenInstruct
        ? "Instruct: Retrieve the passage that answers the user's question\nQuery: "
        : "";
    }
    const indexStart = performance.now();
    embedHandle = await startEmbedServer(cfg.modelFile, [...cfg.serverArgs]);
    const probe = await embedHandle.embed("probe");
    dimObserved = probe.length;
    if (dimObserved !== cfg.embedRecipe.dimension) {
      throw new Error(`dimension mismatch: server returned ${dimObserved}, recipe says ${cfg.embedRecipe.dimension}`);
    }
    vectorBytes = totalChunks * cfg.embedRecipe.dimension * 4;
    const profile = await registerEmbeddingProfile(db, embedRecipe as never);
    profileId = profile._id;
    for (;;) {
      const r = await indexNotebookChunks(db, {
        profileId,
        dimension: cfg.embedRecipe.dimension,
        notebookId,
        batchSize: 16,
        embed: async (texts) => {
          const out: Buffer[] = [];
          for (const t of texts) out.push(Buffer.from(new Float32Array(await embedHandle!.embed(t)).buffer));
          return out;
        },
      });
      if (r.indexed + r.skipped === 0) break;
      totalIndexed += r.indexed;
    }
    indexMs = performance.now() - indexStart;
    console.log(`[index] ${totalIndexed} chunks via ${cfg.label} (dim ${dimObserved}) in ${(indexMs / 1000).toFixed(1)}s`);
    if (recipeName === "rerank") {
      rerankHandle = await startEmbedServer("qwen3-reranker-0.6b-q8_0.gguf", ["--rerank", "--ctx-size", "8192", "-ngl", "99"]);
      console.log("[index] reranker server up (Qwen3-Reranker-0.6B q8_0, /v1/rerank)");
    }
  }

  /* phase: run */
  const runStart = performance.now();
  const queryVectors = new Map<string, Buffer>();
  const queryEmbedMs: number[] = [];
  if (embedHandle) {
    const qPrefix = recipeName === "qwen3" && qwenInstruct
      ? "Instruct: Retrieve the passage that answers the user's question\nQuery: "
      : "";
    for (const q of questions) {
      const t = performance.now();
      queryVectors.set(q.question, Buffer.from(new Float32Array(await embedHandle.embed(qPrefix + q.question)).buffer));
      queryEmbedMs.push(performance.now() - t);
    }
  }

  const chunkMeta = new Map<string, { docId: string; page: number; lastPage: number }>();
  const chunkRows = getChunksByNotebook(db, notebookId);
  for (const c of chunkRows) {
    chunkTexts.set(c._id, (c as unknown as { content: string }).content);
  }
  const chunkIdsBySource = new Map<string, string[]>();
  for (const c of chunkRows) {
    const arr = chunkIdsBySource.get(c.sourceId) ?? [];
    arr.push(c._id);
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
        for (let p = 0; p < pageStart.length; p++) if (pageStart[p] <= word) page = p;
        return page + 1;
      };
      chunkMeta.set(chunkId, { docId, page: pageOf(startWord), lastPage: pageOf(endWord) });
    });
  }

  const hybridRunner = async (question: string): Promise<RankedHit[]> => {
    const result = await searchHybrid(db, {
      notebookId,
      query: question,
      profile: profileId ? { id: profileId, dimension: RECIPES[recipeName === "rerank" ? "bge" : recipeName].embedRecipe.dimension } : null,
      embedQuery: (q) => {
        const v = queryVectors.get(q);
        if (!v) throw new Error(`query not pre-embedded: ${q}`);
        return v;
      },
      limit: TOP_K,
    });
    if (result.vectorStatus !== "ok") {
      console.warn(`[warn] vectorStatus=${result.vectorStatus} for: ${question.slice(0, 50)}`);
    }
    return result.hits.map((h, i) => {
      const meta = chunkMeta.get(h.chunkId) ?? { docId: "?", page: -1, lastPage: -1 };
      return { docId: meta.docId, page: meta.page, lastPage: meta.lastPage, score: h.score, rank: i + 1 };
    });
  };

  const rerankRunner = async (question: string): Promise<RankedHit[]> => {
    // candidates from the bge hybrid index, deeper than TOP_K, then rerank
    const deep = await searchHybrid(db, {
      notebookId,
      query: question,
      profile: profileId ? { id: profileId!, dimension: RECIPES.bge.embedRecipe.dimension } : null,
      embedQuery: (q) => {
        const v = queryVectors.get(q);
        if (!v) throw new Error(`query not pre-embedded: ${q}`);
        return v;
      },
      limit: Math.max(rerankDepth, TOP_K),
    });
    const candidates = deep.hits.map((h) => {
      const meta = chunkMeta.get(h.chunkId) ?? { docId: "?", page: -1, lastPage: -1 };
      return { chunkId: h.chunkId, ...meta };
    });
    const docs = candidates.map((c) => chunkTexts.get(c.chunkId) ?? "");
    const t = performance.now();
    const scores = await llamaRerank(rerankHandle!.baseUrl, rerankHandle!.token, question, docs);
    const rerankMs = performance.now() - t;
    lastRerankMs = rerankMs;
    return scores
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, TOP_K)
      .map((s, i) => ({
        docId: candidates[s.index].docId,
        page: candidates[s.index].page,
        lastPage: candidates[s.index].lastPage,
        score: s.relevance_score,
        rank: i + 1,
      }));
  };
  let lastRerankMs = 0;

  interface RunRow {
    id: string; type: string; language: string; pair: string; question: string;
    expected: Array<{ docId: string; page: number }>;
    perArm: { latencyMs: number; rerankMs?: number; hits: RankedHit[] };
  }
  const runRows: RunRow[] = [];
  const vectorOnlyRunner = async (question: string): Promise<RankedHit[]> => {
    const v = queryVectors.get(question);
    if (!v) throw new Error("query not pre-embedded");
    const hits = vectorSearch(db, profileId!, v, notebookId, TOP_K);
    return hits.map((h, i) => {
      const meta = chunkMeta.get(h.chunkId) ?? { docId: "?", page: -1, lastPage: -1 };
      return { docId: meta.docId, page: meta.page, lastPage: meta.lastPage, score: -h.distance, rank: i + 1 };
    });
  };

  const runner = recipeName === "rerank" ? rerankRunner : mode === "vector" ? vectorOnlyRunner : hybridRunner;
  for (const q of questions) {
    const t = performance.now();
    lastRerankMs = 0;
    const hits = await runner(q.question);
    const row: RunRow = {
      id: q.id, type: q.type, language: q.language, pair: q.pair, question: q.question,
      expected: q.expectedEvidence.map((e) => ({ docId: e.docId, page: e.page })),
      perArm: { latencyMs: performance.now() - t, hits },
    };
    if (recipeName === "rerank") row.perArm.rerankMs = lastRerankMs;
    runRows.push(row);
  }
  const runMs = performance.now() - runStart;

  /* phase: grade */
  const gradeStart = performance.now();
  const answerable = runRows.filter((r) => r.expected.length > 0);
  const unanswerable = runRows.filter((r) => r.expected.length === 0);

  function gradeRanked(ranked: RankedHit[], expected: Array<{ docId: string; page: number }>, k: number) {
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
    return { recall, mrr, ndcg, docIdRecall: expectedDocs.size ? coveredDocs.size / expectedDocs.size : 1 };
  }

  const perQuestion = answerable.map((r) => {
    const m10 = gradeRanked(r.perArm.hits, r.expected, 10);
    const m5 = gradeRanked(r.perArm.hits, r.expected, 5);
    const strict10 = gradeRanked(r.perArm.hits.map((h) => ({ ...h, lastPage: h.page })), r.expected, 10);
    return {
      id: r.id, type: r.type, language: r.language, pair: r.pair,
      recallAt5: m5.recall, recallAt10: m10.recall, mrr: m10.mrr, ndcgAt10: m10.ndcg,
      firstPageRecallAt10: strict10.recall, docIdRecallAt10: m10.docIdRecall,
    };
  });
  const avg = (sel: (q: (typeof perQuestion)[number]) => number) =>
    perQuestion.length ? perQuestion.reduce((s, q) => s + sel(q), 0) / perQuestion.length : 0;

  const groupBy = (rows: typeof perQuestion, key: (q: (typeof perQuestion)[number]) => string) => {
    const out: Record<string, { count: number; recallAt5?: number; recallAt10?: number; mrr?: number; ndcgAt10?: number }> = {};
    for (const q of rows) {
      const k = key(q);
      out[k] = out[k] ?? { count: 0 };
      out[k].count++;
      out[k].recallAt5 = (out[k].recallAt5 ?? 0) + q.recallAt5;
      out[k].recallAt10 = (out[k].recallAt10 ?? 0) + q.recallAt10;
      out[k].mrr = (out[k].mrr ?? 0) + q.mrr;
      out[k].ndcgAt10 = (out[k].ndcgAt10 ?? 0) + q.ndcgAt10;
    }
    for (const k of Object.keys(out)) {
      out[k].recallAt5 = out[k].recallAt5! / out[k].count;
      out[k].recallAt10 = out[k].recallAt10! / out[k].count;
      out[k].mrr = out[k].mrr! / out[k].count;
      out[k].ndcgAt10 = out[k].ndcgAt10! / out[k].count;
    }
    return out;
  };

  const topScores = answerable.map((r) => r.perArm.hits[0]?.score ?? -Infinity);
  const threshold = percentile(topScores, 0.1);
  const pressured = unanswerable.filter((r) => (r.perArm.hits[0]?.score ?? -Infinity) >= threshold);

  const latencies = runRows.map((r) => r.perArm.latencyMs);
  const rerankMsAll = runRows.map((r) => r.perArm.rerankMs).filter((v): v is number => v !== undefined);

  let dbFileBytes = 0;
  for (const f of fs.readdirSync(dataDir)) {
    const p = path.join(dataDir, f);
    if (fs.statSync(p).isFile()) dbFileBytes += fs.statSync(p).size;
  }

  const qPrefixStr = recipeName === "qwen3" && qwenInstruct
    ? "Instruct: Retrieve the passage that answers the user's question\nQuery: "
    : "";
  const report = {
    meta: {
      timestamp: new Date().toISOString(),
      experiment: "T3-multilingual-proto-v1",
      subset, recipe: recipeName, mode,
      qwenInstruct: recipeName === "qwen3" ? (qwenInstruct ? "on" : "off") : null,
      rerankDepth: recipeName === "rerank" ? rerankDepth : null,
      questionCount: questions.length,
      corpus: "multilingual-proto-v1",
      embedding: recipeName === "qwen3"
        ? { ...RECIPES.qwen3.embedRecipe, queryPrefix: qPrefixStr }
        : recipeName === "bge" ? RECIPES.bge.embedRecipe
        : { ...RECIPES.bge.embedRecipe, note: "bge index reranked by Qwen3-Reranker-0.6B q8_0 over top-" + rerankDepth },
      chunking: { maxChunkSize: CHUNK_WORDS, overlap: CHUNK_OVERLAP, totalChunks, totalDocs: manifest.docs.length },
    },
    phases: { ingestMs, indexMs, runMs, gradeMs: performance.now() - gradeStart, totalMs: performance.now() - t0 },
    costs: {
      chunksIndexed: totalIndexed,
      dimensionObserved: dimObserved,
      vectorStoreBytesF32: vectorBytes,
      dbFileBytes,
      indexSeconds: indexMs / 1000,
    },
    overall: {
      answerable: {
        count: answerable.length,
        recallAt5: avg((q) => q.recallAt5),
        recallAt10: avg((q) => q.recallAt10),
        mrr: avg((q) => q.mrr),
        ndcgAt10: avg((q) => q.ndcgAt10),
        docIdRecallAt10: avg((q) => q.docIdRecallAt10),
        firstPageRecallAt10: avg((q) => q.firstPageRecallAt10),
      },
      unanswerable: {
        count: unanswerable.length,
        evidencePressure: unanswerable.length ? pressured.length / unanswerable.length : 0,
        pressuredQuestionIds: pressured.map((r) => r.id),
        threshold,
        thresholdRule: "10th percentile of top-1 score over this run's answerable questions (same arm)",
      },
    },
    byPair: groupBy(perQuestion, (q) => q.pair),
    byType: groupBy(perQuestion, (q) => q.type),
    perf: {
      retrievalP50Ms: percentile(latencies, 0.5),
      retrievalP95Ms: percentile(latencies, 0.95),
      retrievalMeanMs: latencies.reduce((s, v) => s + v, 0) / (latencies.length || 1),
      queryEmbedP50Ms: queryEmbedMs.length ? percentile(queryEmbedMs, 0.5) : null,
      queryEmbedP95Ms: queryEmbedMs.length ? percentile(queryEmbedMs, 0.95) : null,
      rerankP50Ms: rerankMsAll.length ? percentile(rerankMsAll, 0.5) : null,
      rerankP95Ms: rerankMsAll.length ? percentile(rerankMsAll, 0.95) : null,
      note: "retrieval latency excludes the query-embedding HTTP call (queries pre-embedded); queryEmbed* reports it; rerank* is the /v1/rerank HTTP call",
    },
    perQuestion,
    questions: runRows,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const slug = `t3-${subset}-${recipeName}${recipeName === "qwen3" ? (qwenInstruct ? "-instruct" : "-plain") : ""}${mode === "vector" ? "-vec" : ""}`;
  const resultFile = path.join(RESULTS_DIR, `${slug}.json`);
  fs.writeFileSync(resultFile, JSON.stringify(report, null, 2));

  fs.appendFileSync(
    path.join(RESULTS_DIR, "history.jsonl"),
    JSON.stringify({
      timestamp: report.meta.timestamp, slug, subset, recipe: recipeName,
      qwenInstruct: report.meta.qwenInstruct,
      recallAt10: report.overall.answerable.recallAt10,
      crossRecallAt10: report.byType["cross-lingual-fact"]?.recallAt10 ?? null,
      monoRecallAt10: report.byType["exact-fact"]?.recallAt10 ?? null,
      pressure: report.overall.unanswerable.evidencePressure,
      queryEmbedP95Ms: report.perf.queryEmbedP95Ms,
      indexSeconds: report.costs.indexSeconds,
    }) + "\n"
  );

  const fmt = (n: number | null) => (n === null ? "-" : n.toFixed(3));
  console.log(`\n==== t3 eval: ${slug} questions=${questions.length} ====`);
  console.log(`phases: ingest ${(ingestMs / 1000).toFixed(1)}s | index ${(indexMs / 1000).toFixed(1)}s | run ${(runMs / 1000).toFixed(1)}s`);
  console.log(`overall: R@5=${fmt(report.overall.answerable.recallAt5)} R@10=${fmt(report.overall.answerable.recallAt10)} MRR=${fmt(report.overall.answerable.mrr)} nDCG@10=${fmt(report.overall.answerable.ndcgAt10)} pressure=${fmt(report.overall.unanswerable.evidencePressure)}`);
  console.log("by pair (R@5 / R@10 / MRR):");
  for (const [p, v] of Object.entries(report.byPair)) {
    console.log(`  ${p.padEnd(18)} n=${String(v.count).padEnd(3)} R@5=${fmt(v.recallAt5).padEnd(7)} R@10=${fmt(v.recallAt10).padEnd(7)} MRR=${fmt(v.mrr)}`);
  }
  console.log(`perf: retrieval p50=${report.perf.retrievalP50Ms.toFixed(1)}ms p95=${report.perf.retrievalP95Ms.toFixed(1)}ms | qEmbed p50=${report.perf.queryEmbedP50Ms?.toFixed(1) ?? "-"}ms p95=${report.perf.queryEmbedP95Ms?.toFixed(1) ?? "-"}ms${report.perf.rerankP95Ms !== null ? ` | rerank p50=${report.perf.rerankP50Ms!.toFixed(1)}ms p95=${report.perf.rerankP95Ms!.toFixed(1)}ms` : ""}`);
  console.log(`costs: chunks=${totalChunks} dim=${dimObserved} vectorBytes=${vectorBytes} dbBytes=${dbFileBytes}`);
  console.log(`results: ${resultFile}`);
  return { embedHandle, rerankHandle, dataDir, db };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

let cleanup: (() => Promise<void>) | null = null;
try {
  const { embedHandle, rerankHandle, dataDir, db } = await runEval();
  cleanup = async () => {
    await embedHandle?.stop();
    await rerankHandle?.stop();
    closeLocalDb(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
} finally {
  await cleanup?.();
}
