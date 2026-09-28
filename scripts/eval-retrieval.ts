/**
 * Retrieval evaluation runner (issue #6): FTS-only vs hybrid (real local
 * embeddings when llama artifacts are present). Usage: npm run eval:retrieval
 */
import fs from "node:fs";
import path from "node:path";
import { loadCorpus, buildCorpusDb, runRetrievalEval, disposeCorpusDb } from "../src/lib/services/retrieval-eval";
import { getChunksByNotebook } from "../src/lib/services/sources";
import { registerEmbeddingProfile } from "../src/lib/services/embedding-profiles";
import { ensureVecTable, insertVector, vectorSearch } from "../src/lib/services/vector-index";
import { startLlama } from "../src/lib/ai/llama-supervisor";

const REPO = path.resolve(import.meta.dirname, "..");
const CORPUS = path.join(REPO, "eval", "corpus", "retrieval-v1.json");
const LLAMA_DIR = path.join(REPO, ".probe-downloads", "llama-bin");
const MODEL = path.join(REPO, ".probe-downloads", "bge-small-en-v1.5-q8_0.gguf");

const fmt = (n: number) => n.toFixed(3);

function printReports(title: string, reports: Array<{ mode: string; average: { recallAt10: number; mrr: number; ndcgAt10: number }; questions: Array<{ questionId: string; recallAt10: number; mrr: number }> }>) {
  console.log(`\n──── ${title} ────`);
  console.log("mode    recall@10  MRR    nDCG@10");
  for (const r of reports) {
    console.log(
      `${r.mode.padEnd(7)} ${fmt(r.average.recallAt10).padEnd(10)} ${fmt(r.average.mrr).padEnd(6)} ${fmt(r.average.ndcgAt10)}`
    );
  }
  const first = reports[0];
  console.log("\nper question (recall@10 / MRR):");
  for (let i = 0; i < first.questions.length; i++) {
    const row = reports.map((r) => `${fmt(r.questions[i].recallAt10)}/${fmt(r.questions[i].mrr)}`).join("  |  ");
    console.log(`  ${first.questions[i].questionId.padEnd(18)} ${row}`);
  }
}

async function main() {
  const corpusData = loadCorpus(CORPUS);
  const corpus = await buildCorpusDb(corpusData);
  const reports = [] as Array<Awaited<ReturnType<typeof runRetrievalEval>>>;

  try {
    // 1) FTS baseline
    reports.push(await runRetrievalEval(corpus, corpusData, { mode: "fts" }));

    // 2) Hybrid with real local embeddings when artifacts exist
    if (fs.existsSync(path.join(LLAMA_DIR, "llama-server.exe")) && fs.existsSync(MODEL)) {
      const llama = await startLlama({ exeDir: LLAMA_DIR, modelPath: MODEL });
      try {
        const profile = await registerEmbeddingProfile(corpus.db, {
          provider: "llamacpp", model: "bge-small-en-v1.5", revision: "q8_0",
          dimension: 384, pooling: "mean",
        });
        ensureVecTable(corpus.db, profile._id, 384);

        // precompute embeddings (sync lookup for the sync seams)
        const chunks = getChunksByNotebook(corpus.db, corpus.notebookId);
        const vectors = new Map<string, Buffer>();
        for (const c of chunks) {
          const v = await llama.embed(c.content);
          vectors.set(c._id, float32(v));
          insertVector(corpus.db, profile._id, c._id, corpus.notebookId, vectors.get(c._id)!, c.sourceId);
        }
        // sanity: KNN works before running the eval
        const probe = vectorSearch(corpus.db, profile._id, vectors.get(chunks[0]._id)!, corpus.notebookId, 1);
        if (!probe.length || probe[0].chunkId !== chunks[0]._id) throw new Error("vector sanity check failed");

        const embedQuery = (q: string): Buffer => {
          // queries are embedded up-front below; sync map avoids async seams
          const hit = queryVectors.get(q);
          if (!hit) throw new Error(`query not pre-embedded: ${q}`);
          return hit;
        };
        const queryVectors = new Map<string, Buffer>();
        for (const question of corpusData.questions) {
          queryVectors.set(question.query, float32(await llama.embed(question.query)));
        }

        reports.push(
          await runRetrievalEval(corpus, corpusData, {
            mode: "hybrid",
            profile: { id: profile._id, dimension: 384 },
            embedQuery,
          })
        );
      } finally {
        await llama.stop();
      }
    } else {
      console.log("llama artifacts not present — FTS baseline only (fetch via the #2 probe to run hybrid)");
    }

    printReports(`corpus retrieval-v1 (${corpusData.documents.length} docs, ${corpusData.questions.length} questions)`, reports);
  } finally {
    disposeCorpusDb(corpus);
  }
}

function float32(values: number[]): Buffer {
  const buf = new Float32Array(values);
  return Buffer.from(buf.buffer);
}

main().catch((err) => {
  console.error("eval failed:", err);
  process.exit(1);
});
