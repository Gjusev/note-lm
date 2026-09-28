import { describe, it, expect } from "vitest";
import { computeRetrievalMetrics } from "@/lib/services/retrieval-metrics";

describe("retrieval metrics (issue #6 — worked examples computed by hand)", () => {
  it("computes recall@10, MRR and nDCG@10 for binary relevance", () => {
    // ranked: 10 results; relevant = {b, j, x} (x never retrieved)
    const ranked = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const relevant = new Set(["b", "j", "x"]);

    const m = computeRetrievalMetrics(ranked, relevant);

    // recall@10 = 2 of 3 relevant found
    expect(m.recallAt10).toBeCloseTo(2 / 3, 6);
    // first relevant at rank 2 → 1/2
    expect(m.mrr).toBeCloseTo(1 / 2, 6);
    // DCG = 1/log2(3) + 1/log2(11); IDCG = 1/log2(2)+1/log2(3)+1/log2(4)
    const dcg = 1 / Math.log2(3) + 1 / Math.log2(11);
    const idcg = 1 / Math.log2(2) + 1 / Math.log2(3) + 1 / Math.log2(4);
    expect(m.ndcgAt10).toBeCloseTo(dcg / idcg, 6);
  });

  it("perfect ranking scores 1 everywhere", () => {
    const m = computeRetrievalMetrics(["b", "j", "x", "filler"], new Set(["b", "j", "x"]));
    expect(m.recallAt10).toBe(1);
    expect(m.mrr).toBe(1);
    expect(m.ndcgAt10).toBeCloseTo(1, 6);
  });

  it("no relevant found scores 0 without NaN", () => {
    const m = computeRetrievalMetrics(["a", "b"], new Set(["z"]));
    expect(m.recallAt10).toBe(0);
    expect(m.mrr).toBe(0);
    expect(m.ndcgAt10).toBe(0);
  });

  it("empty relevance is a perfect result (no-answer questions)", () => {
    const m = computeRetrievalMetrics(["a", "b"], new Set());
    expect(m.recallAt10).toBe(1);
    expect(m.mrr).toBe(0); // no relevant → no rank to invert
    expect(m.ndcgAt10).toBe(1); // nothing to gain, nothing lost
  });
});
