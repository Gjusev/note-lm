/**
 * Retrieval evaluation harness (issue #6): builds a corpus database and runs
 * FTS-only vs hybrid retrieval over annotated questions, reporting
 * recall@10 / MRR / nDCG@10. Deterministic embedders test the mechanics;
 * real pinned models validate distribution quality (plan rule).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLocalDb, closeLocalDb, type LocalDb } from "@/db/local";
import { createNotebook } from "./notebooks";
import { createSource, replaceChunks, updateSourceStatus } from "./sources";
import { searchChunks } from "./search";
import { searchHybrid } from "./hybrid-search";
import { computeRetrievalMetrics, type RetrievalMetrics } from "./retrieval-metrics";

export interface EvalCorpus {
  version: number;
  documents: Array<{ id: string; text: string }>;
  questions: Array<{ id: string; query: string; relevant: string[] }>;
}

export interface EvalQuestionResult extends RetrievalMetrics {
  questionId: string;
  hits: number;
}

export interface EvalReport {
  mode: "fts" | "hybrid";
  corpusVersion: number;
  questions: EvalQuestionResult[];
  average: RetrievalMetrics;
}

export interface CorpusDb {
  db: LocalDb;
  dir: string;
  notebookId: string;
  /** corpus doc id → chunk id (single-chunk docs) */
  chunkByDoc: Map<string, string>;
}

export function loadCorpus(corpusPath: string): EvalCorpus {
  return JSON.parse(fs.readFileSync(corpusPath, "utf8")) as EvalCorpus;
}

export async function buildCorpusDb(corpus: EvalCorpus): Promise<CorpusDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-eval-"));
  const db = openLocalDb(dir);
  const notebookId = await createNotebook(db, { ownerId: "eval", title: "Corpus" });

  const chunkByDoc = new Map<string, string>();
  for (const doc of corpus.documents) {
    const sourceId = await createSource(db, {
      ownerId: "eval",
      notebookId,
      fileName: `${doc.id}.txt`,
      fileType: "text/plain",
      fileSize: doc.text.length,
    });
    await replaceChunks(db, { ownerId: "eval", sourceId, notebookId }, [doc.text]);
    await updateSourceStatus(db, sourceId, { status: "completed" });
    const { getChunksBySource } = await import("./sources");
    chunkByDoc.set(doc.id, getChunksBySource(db, sourceId)[0]._id);
  }
  return { db, dir, notebookId, chunkByDoc };
}

export function disposeCorpusDb(corpus: CorpusDb): void {
  closeLocalDb(corpus.db);
  fs.rmSync(corpus.dir, { recursive: true, force: true });
}

export async function runRetrievalEval(
  corpus: CorpusDb,
  data: EvalCorpus,
  opts: {
    mode: "fts" | "hybrid";
    profile?: { id: string; dimension: number } | null;
    embedQuery?: ((query: string) => Buffer) | null;
    limit?: number;
  }
): Promise<EvalReport> {
  const docByChunk = new Map(
    [...corpus.chunkByDoc.entries()].map(([doc, chunk]) => [chunk, doc])
  );
  const questions: EvalQuestionResult[] = [];

  for (const q of data.questions) {
    let rankedDocs: string[];
    if (opts.mode === "hybrid") {
      const result = await searchHybrid(corpus.db, {
        notebookId: corpus.notebookId,
        query: q.query,
        profile: opts.profile ?? null,
        embedQuery: opts.embedQuery ?? null,
        limit: opts.limit ?? 10,
      });
      rankedDocs = result.hits.map((h) => docByChunk.get(h.chunkId)).filter((d): d is string => !!d);
    } else {
      const hits = searchChunks(corpus.db, corpus.notebookId, q.query, opts.limit ?? 10);
      rankedDocs = hits.map((h) => docByChunk.get(h.chunkId)).filter((d): d is string => !!d);
    }
    const metrics = computeRetrievalMetrics(
      rankedDocs,
      new Set(q.relevant.filter((d) => corpus.chunkByDoc.has(d))
        .map((d) => String(d)))
    );
    questions.push({ questionId: q.id, hits: rankedDocs.length, ...metrics });
  }

  const avg = (sel: (q: EvalQuestionResult) => number) =>
    questions.reduce((s, q) => s + sel(q), 0) / questions.length;
  return {
    mode: opts.mode,
    corpusVersion: data.version,
    questions,
    average: {
      recallAt10: avg((q) => q.recallAt10),
      mrr: avg((q) => q.mrr),
      ndcgAt10: avg((q) => q.ndcgAt10),
    },
  };
}
