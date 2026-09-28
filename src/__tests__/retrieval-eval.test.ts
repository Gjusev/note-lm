// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import {
  buildCorpusDb,
  runRetrievalEval,
  disposeCorpusDb,
  type CorpusDb,
  type EvalCorpus,
} from "@/lib/services/retrieval-eval";

let corpus: CorpusDb | null = null;

afterEach(() => {
  if (corpus) disposeCorpusDb(corpus);
  corpus = null;
});

const MINI: EvalCorpus = {
  version: 0,
  documents: [
    { id: "doc-a", text: "Quantenphysik Teilchen und Wellen im Doppelspaltexperiment" },
    { id: "doc-b", text: "Kartoffeln wachsen unter der Erde" },
  ],
  questions: [
    { id: "q1", query: "Doppelspaltexperiment", relevant: ["doc-a"] },
    { id: "q2", query: "Kartoffeln", relevant: ["doc-b"] },
    { id: "q-none", query: "Blockchainspezulation", relevant: [] },
  ],
};

describe("retrieval eval harness (issue #6)", () => {
  it("runs FTS mode over a corpus and reports exact-match recall", async () => {
    corpus = await buildCorpusDb(MINI);
    const report = await runRetrievalEval(corpus, MINI, { mode: "fts" });

    expect(report.mode).toBe("fts");
    expect(report.corpusVersion).toBe(0);
    expect(report.questions).toHaveLength(3);
    expect(report.average.recallAt10).toBe(1); // exact single-term queries hit
    expect(report.questions.find((q) => q.questionId === "q1")?.mrr).toBe(1);
    expect(report.questions.find((q) => q.questionId === "q-none")?.recallAt10).toBe(1);
  });
});
