/**
 * P3 fusion-policy eval — eval/fusion-proto
 * Adapted from eval/multilingual-proto/run-multilingual-eval.mts (T3).
 *
 * Compares searchHybrid fusion policies on identical indexes:
 *   --policy rrf | protected-vector   (post-retrieval transform only)
 *   --recipe bge | qwen3              (embedding profile, fresh DB per run)
 *   --corpus fusion | t3              (fusion = the reserved decision corpus;
 *                                      t3 = regression demonstration only)
 *   --subset dev | eval, --runs N     (run 0 is the warmup when N > 1)
 *
 * Usage:
 *   npx tsx eval/fusion-proto/run-fusion-eval.mts --recipe qwen3 --policy protected-vector --subset dev --runs 4
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
import { indexNotebookChunks } from "../../src/lib/services/vector-index";
import { llamaEmbed, waitForLlamaHealth } from "../../src/lib/ai/llama-supervisor";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const LLAMA_DIR = path.join(REPO, ".probe-downloads", "llama-cuda");
const RESULTS_DIR = path.join(REPO, "eval", "fusion-proto", "results");
const OWNER = "p3-fusion-eval";
const TOP_K = 10;
// Amendment 1 (dev-driven, recorded in p3-criteria.md BEFORE the reserved
// run): first dev pass chunked 100/20 -> 33 chunks, so top-10 covered 30% of
// the index and the baseline saturated (T3 amendment-1 failure mode). 50/10
// hardens to ~2x the chunks; same corpus bytes, same questions.
const CHUNK_WORDS = 50;
const CHUNK_OVERLAP = 10;

const CORPORA = {
  fusion: {
    dir: path.join(REPO, "eval", "fusion-proto", "corpus"),
    id: "fusion-proto-v1",
  },
  t3: {
    // READ-ONLY reuse: the T3 regression corpus, never written to
    dir: path.join(REPO, "eval", "multilingual-proto", "corpus"),
    id: "multilingual-proto-v1",
  },
} as const;

const RECIPES = {
  bge: {
    label: "bge-small-en-v1.5 (baseline, app recipe)",
    modelFile: "bge-small-en-v1.5-q8_0.gguf",
    embedRecipe: { provider: "llamacpp", model: "bge-small-en-v1.5", revision: "q8_0", dimension: 384, pooling: "mean" },
    serverArgs: ["--embeddings", "--pooling", "mean", "--ctx-size", "1024", "--ubatch-size", "1024", "-ngl", "99"],
  },
  qwen3: {
    label: "Qwen3-Embedding-0.6B q8_0",
    modelFile: "qwen3-embedding-0.6b-q8_0.gguf",
    embedRecipe: { provider: "llamacpp", model: "Qwen3-Embedding-0.6B", revision: "q8_0", dimension: 1024, pooling: "last" },
    // pooling is NOT forced: the GGUF metadata carries the right pooler
    serverArgs: ["--embeddings", "--ctx-size", "8192", "--ubatch-size", "1024", "-ngl", "99"],
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
    recipe: { type: "string", default: "bge" },
    policy: { type: "string", default: "rrf" },
    corpus: { type: "string", default: "fusion" },
    subset: { type: "string", default: "dev" },
    runs: { type: "string", default: "1" },
  },
});
const recipeName = values.recipe as keyof typeof RECIPES;
if (!(recipeName in RECIPES)) throw new Error("--recipe must be bge|qwen3");
const policy = values.policy as "rrf" | "protected-vector";
if (policy !== "rrf" && policy !== "protected-vector") throw new Error("--policy must be rrf|protected-vector");
const corpusName = values.corpus as keyof typeof CORPORA;
if (!(corpusName in CORPORA)) throw new Error("--corpus must be fusion|t3");
const subset = values.subset as "dev" | "eval";
if (subset !== "dev" && subset !== "eval") throw new Error("--subset must be dev|eval");
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
const CORPUS_DIR = CORPORA[corpusName].dir;

/* ------------------------------------------------------- llama (eval-only spawn) */

interface EmbedHandle { baseUrl: string; token: string; embed(input: string): Promise<number[]>; stop(): Promise<void>; }

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
  return { baseUrl, token, embed: (input) => llamaEmbed(baseUrl, token, input), stop: () => stopTree(child) };
}

/* ----------------------------------------------------------------- grading */

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

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

/* ----------------------------------------------------------------- main */

async function runEval() {
  const t0 = performance.now();

  /* phase: ingest (fresh DB per invocation — indexes never mix) */
  const ingestStart = performance.now();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-p3-eval-"));
  const db = openLocalDb(dataDir);
  const notebookId = await createNotebook(db, { ownerId: OWNER, title: `P3 fusion corpus (${corpusName} ${recipeName} ${policy})` });

  const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, "manifest.json"), "utf8")) as {
    docs: Array<{ docId: string; fileName: string; language: string; pages: number }>;
  };
  const allQuestions = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, "questions.json"), "utf8")) as { questions: Question[] };
  const questions = allQuestions.questions.filter((q) => q.subset === subset);

  const pageStartByDoc = new Map<string, number[]>();
  const wordCountByDoc = new Map<string, number>();
  const docIdBySourceId = new Map<string, string>();
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
  const cfg = RECIPES[recipeName];
  const indexStart = performance.now();
  const embedHandle = await startEmbedServer(cfg.modelFile, [...cfg.serverArgs]);
  const probe = await embedHandle.embed("probe");
  if (probe.length !== cfg.embedRecipe.dimension) {
    throw new Error(`dimension mismatch: server returned ${probe.length}, recipe says ${cfg.embedRecipe.dimension}`);
  }
  const profile = await registerEmbeddingProfile(db, cfg.embedRecipe as never);
  const profileId = profile._id;
  let totalIndexed = 0;
  for (;;) {
    const r = await indexNotebookChunks(db, {
      profileId,
      dimension: cfg.embedRecipe.dimension,
      notebookId,
      batchSize: 16,
      embed: async (texts) => {
        const out: Buffer[] = [];
        for (const t of texts) out.push(Buffer.from(new Float32Array(await embedHandle.embed(t)).buffer));
        return out;
      },
    });
    if (r.indexed + r.skipped === 0) break;
    totalIndexed += r.indexed;
  }
  const indexMs = performance.now() - indexStart;
  console.log(`[index] ${totalIndexed} chunks via ${cfg.label} in ${(indexMs / 1000).toFixed(1)}s`);

  /* chunk -> (docId, page span) mapping, T3 word-position math */
  const chunkMeta = new Map<string, { docId: string; page: number; lastPage: number }>();
  const chunkRows = getChunksByNotebook(db, notebookId);
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

  /* phase: runs (run 0 = warmup when runs > 1) */
  const searchChunks = (await import("../../src/lib/services/search")).searchChunks;
  const vectorSearch = (await import("../../src/lib/services/vector-index")).vectorSearch;
  const chunkIdByDocPage = new Map<string, string[]>(); // "docId:page" -> chunk ids covering it
  for (const [chunkId, meta] of chunkMeta) {
    for (let p = meta.page; p <= meta.lastPage; p++) {
      const key = `${meta.docId}:${p}`;
      chunkIdByDocPage.set(key, [...(chunkIdByDocPage.get(key) ?? []), chunkId]);
    }
  }

  const runPass = async () => {
    const rows: Array<{
      id: string; type: string; language: string; pair: string;
      embedMs: number; retrievalMs: number; endToEndMs: number; hits: RankedHit[];
      branchRanks?: { evidence: string; vectorRank: number | null; ftsRank: number | null };
    }> = [];
    const queryVectors = new Map<string, Buffer>();
    for (const q of questions) {
      const tTotal = performance.now();
      const tEmb = performance.now();
      const vec = Buffer.from(new Float32Array(await embedHandle.embed(q.question)).buffer);
      const embedMs = performance.now() - tEmb;
      queryVectors.set(q.question, vec);
      const tRet = performance.now();
      const result = await searchHybrid(db, {
        notebookId,
        query: q.question,
        profile: { id: profileId, dimension: cfg.embedRecipe.dimension },
        embedQuery: (qq) => {
          const v = queryVectors.get(qq);
          if (!v) throw new Error(`query not pre-embedded: ${qq}`);
          return v;
        },
        limit: TOP_K,
        fusionPolicy: policy,
      });
      const retrievalMs = performance.now() - tRet;
      if (result.vectorStatus !== "ok") {
        console.warn(`[warn] vectorStatus=${result.vectorStatus} for: ${q.question.slice(0, 50)}`);
      }
      // branch diagnostics: best raw rank of an evidence chunk in each branch
      // (candidate depth = the app's 40) — justifies N and localizes misses
      // to the embedding (vector rank > 3) vs the fusion (rank <= 3 but absent
      // from the fused page)
      let branchRanks: { evidence: string; vectorRank: number | null; ftsRank: number | null } | undefined;
      if (q.expectedEvidence.length) {
        const ev = q.expectedEvidence[0];
        const evIds = new Set(chunkIdByDocPage.get(`${ev.docId}:${ev.page}`) ?? []);
        const vecIds = vectorSearch(db, profileId, vec, notebookId, 40).map((h) => h.chunkId);
        const ftsIds = searchChunks(db, notebookId, q.question, 40).map((h) => h.chunkId);
        branchRanks = {
          evidence: `${ev.docId}:p${ev.page}`,
          vectorRank: vecIds.findIndex((id) => evIds.has(id)) + 1 || null,
          ftsRank: ftsIds.findIndex((id) => evIds.has(id)) + 1 || null,
        };
      }
      rows.push({
        id: q.id, type: q.type, language: q.language, pair: q.pair,
        embedMs, retrievalMs, endToEndMs: performance.now() - tTotal, branchRanks,
        hits: result.hits.map((h, i) => {
          const meta = chunkMeta.get(h.chunkId) ?? { docId: "?", page: -1, lastPage: -1 };
          return { docId: meta.docId, page: meta.page, lastPage: meta.lastPage, score: h.score, rank: i + 1 };
        }),
      });
    }
    return rows;
  };

  interface RunRow { id: string; type: string; language: string; pair: string; question: string;
    expected: Array<{ docId: string; page: number }>;
    perArm: { embedMs: number; retrievalMs: number; endToEndMs: number; hits: RankedHit[]; branchRanks?: { evidence: string; vectorRank: number | null; ftsRank: number | null } };
  }
  const allRuns: { rows: RunRow[]; ms: number }[] = [];
  const runStartAll = performance.now();
  for (let r = 0; r < runs; r++) {
    const runStart = performance.now();
    const measured = await runPass();
    const rows: RunRow[] = measured.map((m) => {
      const q = questions.find((x) => x.id === m.id)!;
      return {
        id: m.id, type: m.type, language: m.language, pair: m.pair, question: q.question,
        expected: q.expectedEvidence.map((e) => ({ docId: e.docId, page: e.page })),
        perArm: { embedMs: m.embedMs, retrievalMs: m.retrievalMs, endToEndMs: m.endToEndMs, hits: m.hits, branchRanks: m.branchRanks },
      };
    });
    allRuns.push({ rows, ms: performance.now() - runStart });
    console.log(`[run ${r}${r === 0 && runs > 1 ? " (warmup)" : ""}] ${rows.length} questions in ${(allRuns[r].ms / 1000).toFixed(2)}s`);
  }
  const runsMs = performance.now() - runStartAll;

  /* phase: grade — metrics from the LAST run; latency aggregates exclude the
     warmup run when runs > 1. Determinism drift across runs is counted. */
  const gradeStart = performance.now();
  const graded = allRuns[allRuns.length - 1].rows;
  const answerable = graded.filter((r) => r.expected.length > 0);
  const unanswerable = graded.filter((r) => r.expected.length === 0);

  const perQuestion = answerable.map((r) => {
    const m10 = gradeRanked(r.perArm.hits, r.expected, 10);
    return {
      id: r.id, type: r.type, language: r.language, pair: r.pair,
      recallAt10: m10.recall, mrr: m10.mrr, ndcgAt10: m10.ndcg, docIdRecallAt10: m10.docIdRecall,
      branchRanks: r.perArm.branchRanks ?? null,
    };
  });
  const avg = (sel: (q: (typeof perQuestion)[number]) => number) =>
    perQuestion.length ? perQuestion.reduce((s, q) => s + sel(q), 0) / perQuestion.length : 0;

  const groupBy = (rows: typeof perQuestion, key: (q: (typeof perQuestion)[number]) => string) => {
    const out: Record<string, { count: number; recallAt10?: number; mrr?: number; ndcgAt10?: number }> = {};
    for (const q of rows) {
      const k = key(q);
      out[k] = out[k] ?? { count: 0 };
      out[k].count++;
      out[k].recallAt10 = (out[k].recallAt10 ?? 0) + q.recallAt10;
      out[k].mrr = (out[k].mrr ?? 0) + q.mrr;
      out[k].ndcgAt10 = (out[k].ndcgAt10 ?? 0) + q.ndcgAt10;
    }
    for (const k of Object.keys(out)) {
      out[k].recallAt10 = out[k].recallAt10! / out[k].count;
      out[k].mrr = out[k].mrr! / out[k].count;
      out[k].ndcgAt10 = out[k].ndcgAt10! / out[k].count;
    }
    return out;
  };

  const topScores = answerable.map((r) => r.perArm.hits[0]?.score ?? -Infinity);
  const threshold = percentile(topScores, 0.1);
  const pressured = unanswerable.filter((r) => (r.perArm.hits[0]?.score ?? -Infinity) >= threshold);

  const measuredRuns = allRuns.slice(runs > 1 ? 1 : 0);
  const lat = {
    retrieval: measuredRuns.flatMap((run) => run.rows.map((r) => r.perArm.retrievalMs)),
    embed: measuredRuns.flatMap((run) => run.rows.map((r) => r.perArm.embedMs)),
    endToEnd: measuredRuns.flatMap((run) => run.rows.map((r) => r.perArm.endToEndMs)),
  };
  let metricDrift = 0;
  if (allRuns.length > 1) {
    const ref = JSON.stringify(allRuns[allRuns.length - 1].rows.map((r) => r.perArm.hits.map((h) => h.docId)));
    for (const run of allRuns.slice(0, -1)) {
      if (JSON.stringify(run.rows.map((r) => r.perArm.hits.map((h) => h.docId))) !== ref) metricDrift++;
    }
  }

  let dbFileBytes = 0;
  for (const f of fs.readdirSync(dataDir)) {
    const p = path.join(dataDir, f);
    if (fs.statSync(p).isFile()) dbFileBytes += fs.statSync(p).size;
  }

  const report = {
    meta: {
      timestamp: new Date().toISOString(),
      experiment: "P3-fusion-proto-v1",
      corpus: CORPORA[corpusName].id,
      corpusRole: corpusName === "t3" ? "REGRESSION ONLY (inspected during T3; not a decision source)" : corpusName === "fusion" && subset === "eval" ? "RESERVED decision set" : "dev",
      subset, recipe: recipeName, policy,
      questionCount: questions.length,
      embedding: RECIPES[recipeName].embedRecipe,
      fusion: { policy, protectedHead: policy === "protected-vector" ? 3 : null, rrfK: 60 },
      chunking: { maxChunkSize: CHUNK_WORDS, overlap: CHUNK_OVERLAP, totalChunks, totalDocs: manifest.docs.length },
      runs,
    },
    phases: { ingestMs, indexMs, runsMs, gradeMs: performance.now() - gradeStart, totalMs: performance.now() - t0 },
    overall: {
      answerable: {
        count: answerable.length,
        recallAt10: avg((q) => q.recallAt10),
        mrr: avg((q) => q.mrr),
        ndcgAt10: avg((q) => q.ndcgAt10),
        docIdRecallAt10: avg((q) => q.docIdRecallAt10),
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
    crossLingualAggregate: (() => {
      // "cross-lingual-fact" is the T3 corpus's type name for the same class
      const cross = perQuestion.filter((q) => q.type.startsWith("cross"));
      return cross.length ? {
        count: cross.length,
        recallAt10: cross.reduce((s, q) => s + q.recallAt10, 0) / cross.length,
        mrr: cross.reduce((s, q) => s + q.mrr, 0) / cross.length,
        ndcgAt10: cross.reduce((s, q) => s + q.ndcgAt10, 0) / cross.length,
      } : null;
    })(),
    monoAggregate: (() => {
      // "exact-fact" is the T3 corpus's monolingual control type
      const mono = perQuestion.filter((q) => q.type === "mono-fact" || q.type === "exact-fact");
      return mono.length ? {
        count: mono.length,
        recallAt10: mono.reduce((s, q) => s + q.recallAt10, 0) / mono.length,
        mrr: mono.reduce((s, q) => s + q.mrr, 0) / mono.length,
        ndcgAt10: mono.reduce((s, q) => s + q.ndcgAt10, 0) / mono.length,
      } : null;
    })(),
    perf: {
      measuredRuns: measuredRuns.length,
      warmupRuns: runs - measuredRuns.length,
      retrievalP50Ms: percentile(lat.retrieval, 0.5),
      retrievalP95Ms: percentile(lat.retrieval, 0.95),
      retrievalMeanMs: lat.retrieval.reduce((s, v) => s + v, 0) / (lat.retrieval.length || 1),
      queryEmbedP50Ms: percentile(lat.embed, 0.5),
      queryEmbedP95Ms: percentile(lat.embed, 0.95),
      endToEndP50Ms: percentile(lat.endToEnd, 0.5),
      endToEndP95Ms: percentile(lat.endToEnd, 0.95),
      metricDriftRuns: metricDrift,
      note: "retrievalMs = searchHybrid call with pre-embedded query; endToEndMs = query-embedding HTTP + searchHybrid (the honest user-facing wall time); latency aggregates exclude the warmup run",
    },
    perQuestion,
    questions: graded,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const slug = `p3-${corpusName}-${subset}-${recipeName}-${policy}`;
  const resultFile = path.join(RESULTS_DIR, `${slug}.json`);
  fs.writeFileSync(resultFile, JSON.stringify(report, null, 2));

  fs.appendFileSync(
    path.join(RESULTS_DIR, "history.jsonl"),
    JSON.stringify({
      timestamp: report.meta.timestamp, slug, corpus: corpusName, subset, recipe: recipeName, policy,
      recallAt10: report.overall.answerable.recallAt10,
      crossRecallAt10: report.crossLingualAggregate ? report.crossLingualAggregate.recallAt10 : null,
      monoRecallAt10: report.monoAggregate ? report.monoAggregate.recallAt10 : null,
      pressure: report.overall.unanswerable.evidencePressure,
      retrievalP95Ms: report.perf.retrievalP95Ms,
      endToEndP95Ms: report.perf.endToEndP95Ms,
      indexSeconds: indexMs / 1000,
    }) + "\n"
  );

  const fmt = (n: number | null) => (n === null ? "-" : n.toFixed(3));
  const cross = report.crossLingualAggregate;
  const mono = report.monoAggregate;
  console.log(`\n==== p3 eval: ${slug} questions=${questions.length} runs=${runs} ====`);
  console.log(`phases: ingest ${(ingestMs / 1000).toFixed(1)}s | index ${(indexMs / 1000).toFixed(1)}s | runs ${(runsMs / 1000).toFixed(1)}s`);
  console.log(`cross: R@10=${fmt(cross?.recallAt10 ?? null)} MRR=${fmt(cross?.mrr ?? null)} | mono: R@10=${fmt(mono?.recallAt10 ?? null)} MRR=${fmt(mono?.mrr ?? null)} | pressure=${fmt(report.overall.unanswerable.evidencePressure)}`);
  console.log("by type (R@10 / MRR):");
  for (const [p, v] of Object.entries(report.byType)) {
    console.log(`  ${p.padEnd(18)} n=${String(v.count).padEnd(3)} R@10=${fmt(v.recallAt10).padEnd(7)} MRR=${fmt(v.mrr)}`);
  }
  console.log(`perf (measured runs=${measuredRuns.length}): retrieval p50=${report.perf.retrievalP50Ms.toFixed(2)}ms p95=${report.perf.retrievalP95Ms.toFixed(2)}ms | embed p95=${report.perf.queryEmbedP95Ms.toFixed(1)}ms | endToEnd p50=${report.perf.endToEndP50Ms.toFixed(2)}ms p95=${report.perf.endToEndP95Ms.toFixed(2)}ms | drift=${metricDrift}`);
  console.log(`results: ${resultFile}`);
  return { embedHandle, dataDir, db };
}

let cleanup: (() => Promise<void>) | null = null;
try {
  const { embedHandle, dataDir, db } = await runEval();
  cleanup = async () => {
    await embedHandle?.stop();
    closeLocalDb(db);
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
} finally {
  await cleanup?.();
}
