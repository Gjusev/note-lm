/**
 * Retrieval-eval harness for the PageIndex evaluation
 * (docs/specs/pageindex-integration-plan.md, PI arms "fts" and "hybrid").
 *
 * The fts arm = src/lib/services/search.ts searchChunks (the same FTS5/BM25
 * branch searchHybrid uses); the hybrid arm = searchHybrid (FTS5 + vec0 KNN
 * fused with RRF) over llama-server bge-small embeddings via the resumable
 * indexNotebookChunks service.
 *
 * Phases: ingest (21 PDFs -> one notebook, chunks + chunk->page map) ->
 * index -> run (per question x variant, top-10) -> grade (page-level
 * recall@5/@10, MRR, nDCG@10; evidence-pressure on unanswerable questions).
 *
 * Usage:
 *   npx tsx eval/harness/run-retrieval-eval.mts --subset dev --variants fts,hybrid --limit 5
 *
 * Variant interface (where the PageIndex arm plugs in, see README):
 *   VariantRunner = (question: string) => Promise<RankedHit[]>
 *   RankedHit = { docId: string; page: number; score: number; rank: number }
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
const OWNER = "eval-harness";
const DIMENSION = 384;
// Eval-sized chunks: corpus docs are ~800 words over 8 short pages, so the
// production default (1000/200) would give 1 chunk = whole doc = no page
// granularity. 180 words keeps every observed chunk under bge's 512-token
// training context (this corpus tokenises at up to ~2.6 tok/word on tables
// and German); --ctx-size 1024 below is headroom for outliers, not a target.
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

/* ------------------------------------------------------------------ types */

export interface RankedHit {
  docId: string;
  /** page the chunk starts on; the chunk may span through lastPage. */
  page: number;
  /** last page the chunk's words reach (page-span grading uses page..lastPage). */
  lastPage: number;
  /**
   * fts: -bm25(chunks_fts) rank (lower bm25 = better, negated so that
   * higher score = better for every variant); hybrid: RRF score.
   */
  score: number;
  rank: number;
}

/** The documented plug-in point for future arms (e.g. "pageindex"). */
export type VariantRunner = (question: string) => Promise<RankedHit[]>;

interface Question {
  id: string;
  subset: "dev" | "eval";
  type: string;
  language: string;
  question: string;
  expectedEvidence: Array<{ docId: string; page: number }>;
}

/* -------------------------------------------------------------------- cli */

const { values } = parseArgs({
  options: {
    subset: { type: "string", default: "dev" },
    variants: { type: "string", default: "fts,hybrid" },
    limit: { type: "string", default: "" },
  },
});
const subset = values.subset as "dev" | "eval";
if (subset !== "dev" && subset !== "eval") throw new Error(`--subset must be dev|eval, got ${values.subset}`);
const variantNames = values.variants.split(",").map((v) => v.trim()).filter(Boolean);
const limit = values.limit ? Number(values.limit) : Infinity;

/* ------------------------------------------------------------------- main */

async function main(): Promise<void> {
  const t0 = performance.now();
  let llama: LlamaHandle | null = null;
  let dataDir: string | null = null;
  let db: ReturnType<typeof openLocalDb> | null = null;
  try {
    ({ llama, dataDir, db } = await runEval());
  } finally {
    await llama?.stop();
    if (db) closeLocalDb(db);
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

interface EvalContext {
  llama: LlamaHandle | null;
  dataDir: string;
  db: ReturnType<typeof openLocalDb>;
}

/**
 * Local spawn of the pinned llama-server (same loopback + per-session-token
 * pattern as src/lib/ai/llama-supervisor.ts, reusing its llamaEmbed and
 * waitForLlamaHealth). The extra --batch-size is the ONLY difference:
 * startLlama's fixed flags leave the 512 physical-batch default, and this
 * corpus tokenises at up to ~2.6 tok/word, so 200-word chunks overflow it
 * (llama-server answers 500 "input too large"). Eval code only - the app
 * itself keeps startLlama (--ubatch-size, not --batch-size: the 500 names
 * the PHYSICAL batch, n_ubatch).
 */
interface LlamaHandle {
  baseUrl: string;
  token: string;
  embed(input: string): Promise<number[]>;
  stop(): Promise<void>;
}

async function startEmbedServer(modelPath: string): Promise<LlamaHandle> {
  const port = await freePort();
  const token = randomBytes(24).toString("hex");
  const baseUrl = `http://127.0.0.1:${port}`;
  const exeDir = LLAMA_DIR;
  const child = spawn(
    path.join(exeDir, "llama-server.exe"),
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
      cwd: exeDir,
      env: { ...process.env, LLAMA_API_KEY: token },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    }
  );
  child.stderr?.on("data", () => {});
  try {
    await waitForLlamaHealth(baseUrl, 60_000);
  } catch (err) {
    await stopLlama(child);
    throw err;
  }
  return {
    baseUrl,
    token,
    embed: (input) => llamaEmbed(baseUrl, token, input),
    stop: () => stopLlama(child),
  };
}

/** Grab a free loopback port without racing (bind, read, release). */
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
function stopLlama(child: ChildProcess): Promise<void> {
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

async function runEval(): Promise<EvalContext> {
  const t0 = performance.now();

  /* ---------------------------------------------------- phase: ingest */
  const ingestStart = performance.now();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-pi-eval-"));
  const db = openLocalDb(dataDir);
  const notebookId = await createNotebook(db, { ownerId: OWNER, title: `PageIndex corpus (${subset})` });

  const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, "manifest.json"), "utf8")) as {
    docs: Array<{ docId: string; fileName: string; pages: number }>;
  };
  const allQuestions = JSON.parse(
    fs.readFileSync(path.join(CORPUS_DIR, "questions.json"), "utf8")
  ) as { questions: Question[] };
  const questions = allQuestions.questions.filter((q) => q.subset === subset).slice(0, limit);

  // docId -> word offset where each page starts, in the whitespace-split word
  // sequence of the full extracted text (same split chunkText uses, so chunk
  // word indices map onto pages exactly).
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
      throw new Error(`${doc.docId}: pdf has ${pageTexts.length} pages, manifest says ${doc.pages}`);
    }

    // Same page join as src/lib/text-extraction.extractTextFromPDF so
    // chunking matches production input exactly.
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
  console.log(`[ingest] ${manifest.docs.length} docs, ${totalChunks} chunks in ${(ingestMs / 1000).toFixed(1)}s (db: ${dataDir})`);

  /* ----------------------------------------------------- phase: index */
  let indexMs = 0;
  let profileId: string | null = null;
  let llama: LlamaHandle | null = null;
  let totalIndexed = 0;
  if (variantNames.includes("hybrid")) {
    if (!fs.existsSync(path.join(LLAMA_DIR, "llama-server.exe")) || !fs.existsSync(MODEL)) {
      throw new Error("hybrid variant needs llama artifacts (run scripts/fetch-llama.mjs / probe #2 first)");
    }
    const indexStart = performance.now();
    llama = await startEmbedServer(MODEL);
    const profile = await registerEmbeddingProfile(db, { ...EMBED_RECIPE });
    profileId = profile._id;
    // resumable as implemented: loop until no pending chunk remains
    for (;;) {
      const r = await indexNotebookChunks(db, {
        profileId,
        dimension: DIMENSION,
        notebookId,
        batchSize: 16,
        embed: async (texts) => {
          const out: Buffer[] = [];
          for (const t of texts) out.push(float32(await llama!.embed(t)));
          return out;
        },
      });
      if (r.indexed + r.skipped === 0) break;
      totalIndexed += r.indexed;
    }
    indexMs = performance.now() - indexStart;
    console.log(`[index] ${totalIndexed} chunks embedded via ${EMBED_RECIPE.model} in ${(indexMs / 1000).toFixed(1)}s`);
  }

  /* ------------------------------------------------------- phase: run */
  const runStart = performance.now();
  // Pre-embed all queries once: deterministic (fixed model), and it keeps the
  // measured retrieval latency free of HTTP variance. searchHybrid's
  // embedQuery seam is sync, hence the pre-computed map.
  const queryVectors = new Map<string, Buffer>();
  const queryEmbedMs: number[] = [];
  if (llama) {
    for (const q of questions) {
      const t = performance.now();
      queryVectors.set(q.question, float32(await llama.embed(q.question)));
      queryEmbedMs.push(performance.now() - t);
    }
  }

  // chunkId -> {docId, page}: chunk j of a doc starts at word
  // j*(CHUNK_WORDS-CHUNK_OVERLAP) of the same word sequence the pageStart
  // offsets were computed from, so the page is exact for the chunk's first
  // word. First-page approximation: a chunk spanning a page boundary is
  // graded against the page where it STARTS (see README caveat).
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
        for (let p = 0; p < pageStart.length; p++) {
          if (pageStart[p] <= word) page = p;
        }
        return page + 1; // 1-based
      };
      chunkMeta.set(chunkId, { docId, page: pageOf(startWord), lastPage: pageOf(endWord) });
    });
  }

  const ftsRunner: VariantRunner = async (question) => {
    const hits = searchChunks(db, notebookId, question, TOP_K);
    // bm25(): lower = better - negate so higher score = better for every
    // variant and the evidence-pressure threshold is comparable.
    return hits.map((h, i) => {
      const meta = chunkMeta.get(h.chunkId) ?? { docId: "?", page: -1, lastPage: -1 };
      return { docId: meta.docId, page: meta.page, lastPage: meta.lastPage, score: -h.rank, rank: i + 1 };
    });
  };

  const hybridRunner: VariantRunner = async (question) => {
    const result = await searchHybrid(db, {
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
    if (result.vectorStatus !== "ok") {
      console.warn(`[warn] hybrid vectorStatus=${result.vectorStatus} for: ${question.slice(0, 60)}`);
    }
    return result.hits.map((h, i) => {
      const meta = chunkMeta.get(h.chunkId) ?? { docId: "?", page: -1, lastPage: -1 };
      return { docId: meta.docId, page: meta.page, lastPage: meta.lastPage, score: h.score, rank: i + 1 };
    });
  };

  /** The variant registry - the PageIndex arm plugs in here (see README). */
  const variants: Record<string, VariantRunner> = { fts: ftsRunner };
  if (variantNames.includes("hybrid")) variants.hybrid = hybridRunner;
  for (const name of variantNames) {
    if (!variants[name]) throw new Error(`unknown variant: ${name} (known: fts, hybrid)`);
  }

  interface RunRow {
    id: string;
    type: string;
    language: string;
    question: string;
    expected: Array<{ docId: string; page: number }>;
    perVariant: Record<string, { latencyMs: number; hits: RankedHit[] }>;
  }
  const runRows: RunRow[] = [];
  for (const q of questions) {
    const perVariant: Record<string, { latencyMs: number; hits: RankedHit[] }> = {};
    for (const [name, runner] of Object.entries(variants)) {
      const t = performance.now();
      const hits = await runner(q.question);
      perVariant[name] = { latencyMs: performance.now() - t, hits };
    }
    runRows.push({
      id: q.id,
      type: q.type,
      language: q.language,
      question: q.question,
      expected: q.expectedEvidence.map((e) => ({ docId: e.docId, page: e.page })),
      perVariant,
    });
  }
  const runMs = performance.now() - runStart;

  /* ----------------------------------------------------- phase: grade */
  const gradeStart = performance.now();
  const variantReports: Record<string, VariantReport> = {};
  for (const name of Object.keys(variants)) {
    const answerable = runRows.filter((r) => r.expected.length > 0);
    const unanswerable = runRows.filter((r) => r.expected.length === 0);

    const perQuestion = answerable.map((r) => {
      const m10 = gradeRanked(r.perVariant[name].hits, r.expected, 10);
      const m5 = gradeRanked(r.perVariant[name].hits, r.expected, 5);
      // strict variant: the chunk's START page must be the evidence page
      const strict10 = gradeRanked(
        r.perVariant[name].hits.map((h) => ({ ...h, lastPage: h.page })),
        r.expected,
        10
      );
      return {
        id: r.id,
        type: r.type,
        language: r.language,
        recallAt5: m5.recall,
        recallAt10: m10.recall,
        mrr: m10.mrr,
        ndcgAt10: m10.ndcg,
        firstPageRecallAt10: strict10.recall,
        // partial credit, documented separately: right document, wrong page
        docIdRecallAt10: m10.docIdRecall,
      };
    });
    const avg = (sel: (q: (typeof perQuestion)[number]) => number) =>
      perQuestion.length ? perQuestion.reduce((s, q) => s + sel(q), 0) / perQuestion.length : 0;

    // Evidence pressure (unanswerable questions): fraction whose top-1 score
    // reaches the threshold. Threshold = 10th percentile of top-1 scores over
    // this run's ANSWERABLE questions (same variant): 90% of answerable
    // questions sit above it, so an unanswerable question crossing it behaves
    // like a confident retrieval of evidence that does not exist.
    const topScores = answerable.map((r) => r.perVariant[name].hits[0]?.score ?? -Infinity);
    const threshold = percentile(topScores, 0.1);
    const pressured = unanswerable.filter(
      (r) => (r.perVariant[name].hits[0]?.score ?? -Infinity) >= threshold
    );

    const latencies = runRows.map((r) => r.perVariant[name].latencyMs);
    variantReports[name] = {
      answerable: {
        count: answerable.length,
        recallAt5: avg((q) => q.recallAt5),
        recallAt10: avg((q) => q.recallAt10),
        mrr: avg((q) => q.mrr),
        ndcgAt10: avg((q) => q.ndcgAt10),
        docIdRecallAt10: avg((q) => q.docIdRecallAt10),
        firstPageRecallAt10: avg((q) => q.firstPageRecallAt10),
        perQuestion,
      },
      unanswerable: {
        count: unanswerable.length,
        evidencePressure: unanswerable.length ? pressured.length / unanswerable.length : 0,
        pressuredQuestionIds: pressured.map((r) => r.id),
        threshold,
        thresholdRule: "10th percentile of top-1 score over this run's answerable questions (same variant)",
      },
      perType: Object.fromEntries(
        [...new Set(runRows.map((r) => r.type))].map((type) => {
          const rows = perQuestion.filter((q) => q.type === type);
          return [
            type,
            rows.length
              ? {
                  count: rows.length,
                  recallAt10: rows.reduce((s, q) => s + q.recallAt10, 0) / rows.length,
                  mrr: rows.reduce((s, q) => s + q.mrr, 0) / rows.length,
                }
              : { count: 0 },
          ];
        })
      ),
      perf: {
        retrievalP50Ms: percentile(latencies, 0.5),
        retrievalP95Ms: percentile(latencies, 0.95),
        retrievalMeanMs: latencies.reduce((s, v) => s + v, 0) / (latencies.length || 1),
        queryEmbedP50Ms: queryEmbedMs.length ? percentile(queryEmbedMs, 0.5) : null,
        queryEmbedP95Ms: queryEmbedMs.length ? percentile(queryEmbedMs, 0.95) : null,
        note: "retrieval latency excludes the query-embedding HTTP call (queries are pre-embedded for determinism); queryEmbed* reports it separately",
      },
    };
  }
  const gradeMs = performance.now() - gradeStart;

  /* ---------------------------------------------------------- output */
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  const slug = `${subset}-${variantNames.join("+")}-${timestamp.replace(/[:.]/g, "-")}`;
  const resultFile = path.join(RESULTS_DIR, `${slug}.json`);
  const result = {
    meta: {
      timestamp,
      subset,
      variants: variantNames,
      questionCount: questions.length,
      corpus: "document-trees-v1",
      embedding: variantNames.includes("hybrid") ? EMBED_RECIPE : null,
      chunking: { maxChunkSize: CHUNK_WORDS, overlap: CHUNK_OVERLAP, totalChunks, totalDocs: manifest.docs.length },
      grading: {
        hit: "expected (docId, page) covered by a retrieved hit: docId matches and the evidence page lies in the hit's page span (chunk start..end page); firstPageRecallAt10 is the strict variant requiring the chunk to START on the evidence page (boundary chunks -> earlier page)",
        partialCredit: "docIdRecallAt10 = expected docId present in top-10 regardless of page",
        unanswerable: "evidence-pressure = top-1 score >= threshold (see variants.*.unanswerable.thresholdRule)",
      },
    },
    phases: { ingestMs, indexMs, runMs, gradeMs, totalMs: performance.now() - t0 },
    variants: variantReports,
    questions: runRows,
  };
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));

  const historyLine = {
    timestamp,
    subset,
    variants: variantNames,
    metrics: Object.fromEntries(
      Object.entries(variantReports).map(([name, rep]) => [
        name,
        {
          recallAt5: rep.answerable.recallAt5,
          recallAt10: rep.answerable.recallAt10,
          mrr: rep.answerable.mrr,
          ndcgAt10: rep.answerable.ndcgAt10,
          docIdRecallAt10: rep.answerable.docIdRecallAt10,
          firstPageRecallAt10: rep.answerable.firstPageRecallAt10,
          evidencePressure: rep.unanswerable.evidencePressure,
          retrievalP50Ms: rep.perf.retrievalP50Ms,
          retrievalP95Ms: rep.perf.retrievalP95Ms,
        },
      ])
    ),
  };
  fs.appendFileSync(path.join(RESULTS_DIR, "history.jsonl"), JSON.stringify(historyLine) + "\n");

  printSummary(result, resultFile);
  return { llama, dataDir, db };
}

interface VariantReport {
  answerable: {
    count: number;
    recallAt5: number;
    recallAt10: number;
    mrr: number;
    ndcgAt10: number;
    docIdRecallAt10: number;
    firstPageRecallAt10: number;
    perQuestion: Array<Record<string, unknown>>;
  };
  unanswerable: {
    count: number;
    evidencePressure: number;
    pressuredQuestionIds: string[];
    threshold: number;
    thresholdRule: string;
  };
  perType: Record<string, { count: number; recallAt10?: number; mrr?: number }>;
  perf: {
    retrievalP50Ms: number;
    retrievalP95Ms: number;
    retrievalMeanMs: number;
    queryEmbedP50Ms: number | null;
    queryEmbedP95Ms: number | null;
    note: string;
  };
}

/* ----------------------------------------------------------------- utils */

function float32(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer);
}

interface ExpectedEvidence {
  docId: string;
  page: number;
}

/**
 * Page-level grading of one ranked list. A hit covers an expected item when
 * the docId matches and the evidence page lies inside the hit's page span
 * (page..lastPage); a hit counts once regardless of how many expected pages
 * it covers (overlap chunks never count twice - duplicates collapse to the
 * first rank). Binary relevance.
 */
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
  const ideal = Array.from(
    { length: Math.min(expected.length, k) },
    (_, i) => 1 / Math.log2(i + 2)
  ).reduce((a, b) => a + b, 0);
  const ndcg = ideal === 0 ? 1 : dcg / ideal;
  const docIdRecall = expectedDocs.size ? coveredDocs.size / expectedDocs.size : 1;
  return { recall, mrr, ndcg, docIdRecall };
}

/** Nearest-rank percentile of an unsorted numeric array. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

function printSummary(
  result: {
    meta: { questionCount: number; subset: string; variants: string[] };
    phases: Record<string, number>;
    variants: Record<string, VariantReport>;
  },
  file: string
): void {
  const fmt = (n: number | null) => (n === null ? "-" : n.toFixed(3));
  console.log(`\n==== retrieval-eval: subset=${result.meta.subset} questions=${result.meta.questionCount} variants=${result.meta.variants.join(",")} ====`);
  console.log(
    `phases: ingest ${(result.phases.ingestMs / 1000).toFixed(1)}s | index ${(result.phases.indexMs / 1000).toFixed(1)}s | run ${(result.phases.runMs / 1000).toFixed(1)}s | grade ${(result.phases.gradeMs / 1000).toFixed(1)}s`
  );
  console.log("\nvariant   recall@5  recall@10  MRR     nDCG@10  docIdR@10  1stPgR@10  pressure  p50(ms)  p95(ms)");
  for (const [name, rep] of Object.entries(result.variants)) {
    console.log(
      [
        name.padEnd(9),
        fmt(rep.answerable.recallAt5).padEnd(9),
        fmt(rep.answerable.recallAt10).padEnd(10),
        fmt(rep.answerable.mrr).padEnd(7),
        fmt(rep.answerable.ndcgAt10).padEnd(8),
        fmt(rep.answerable.docIdRecallAt10).padEnd(10),
        fmt(rep.answerable.firstPageRecallAt10).padEnd(10),
        fmt(rep.unanswerable.evidencePressure).padEnd(9),
        rep.perf.retrievalP50Ms.toFixed(1).padEnd(8),
        rep.perf.retrievalP95Ms.toFixed(1),
      ].join(" ")
    );
  }
  for (const [name, rep] of Object.entries(result.variants)) {
    const perType = Object.entries(rep.perType)
      .map(([t, v]) => `${t}=${v.recallAt10 !== undefined ? v.recallAt10.toFixed(3) : "-"}(${v.count})`)
      .join("  ");
    console.log(`\n${name} by type (recall@10): ${perType}`);
  }
  console.log(`\nresults: ${file}`);
}

main().catch((err) => {
  console.error("eval failed:", err);
  process.exit(1);
});
