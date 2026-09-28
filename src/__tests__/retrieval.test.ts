import { describe, it, expect } from "vitest";
import { fuseRankings } from "@/lib/services/retrieval";

describe("hybrid retrieval fusion (RRF)", () => {
  it("fuses FTS and vector rankings by reciprocal rank fusion", () => {
    // Worked example from docs/specs/local-ai-rag-plan.md:
    // score(d) = Σ 1 / (60 + position), positions from 1.
    // FTS: [a, b, c]; Vector: [b, d]  →  order must be b, a, d, c
    const fused = fuseRankings({
      fts: ["a", "b", "c"],
      vector: ["b", "d"],
    });

    expect(fused.map((r) => r.key)).toEqual(["b", "a", "d", "c"]);
    // b = 1/(60+2) + 1/(60+1) — hand-computed from the formula
    expect(fused[0].score).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(fused[1].score).toBeCloseTo(1 / 61, 10);
  });

  it("applies source filters before truncating, so excluded sources take no quota", () => {
    const fused = fuseRankings(
      {
        fts: ["a", "b", "c"],
        vector: ["b", "d"],
      },
      { limit: 2, isAllowed: (key) => key !== "b" }
    );

    // b is excluded entirely; the limit counts only allowed candidates
    expect(fused.map((r) => r.key)).toEqual(["a", "d"]);
  });

  it("degrades to the textual order when no vector branch is available", () => {
    const fused = fuseRankings({ fts: ["a", "b"], vector: [] });
    expect(fused.map((r) => r.key)).toEqual(["a", "b"]);
  });
});
