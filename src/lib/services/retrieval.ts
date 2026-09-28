/**
 * Hybrid retrieval fusion — Reciprocal Rank Fusion over the FTS5/BM25 and
 * vector branches (docs/specs/local-ai-rag-plan.md §Búsqueda híbrida).
 *
 * score(d) = Σ 1 / (60 + position(d)), positions from 1. The plan fixes this
 * formula and the candidate handling: filters apply BEFORE truncation, an
 * excluded source never takes quota from the selected ones.
 */

export interface FusedResult<K = string> {
  key: K;
  score: number;
  /** Branches that contributed (for debugging and explainability). */
  branches: Array<"fts" | "vector">;
}

const RRF_K = 60;

export function fuseRankings<K = string>(
  rankings: { fts: K[]; vector: K[] },
  options?: { limit?: number; isAllowed?: (key: K) => boolean }
): FusedResult<K>[] {
  const isAllowed = options?.isAllowed ?? (() => true);
  const scores = new Map<K, { score: number; branches: Set<"fts" | "vector"> }>();

  const absorb = (branch: "fts" | "vector", ranking: K[]) => {
    // positions are counted within the branch as received; disallowed keys
    // consume no position of the fused result (they are dropped here, before
    // any truncation — an excluded source must not take quota)
    let position = 0;
    for (const key of ranking) {
      position += 1;
      if (!isAllowed(key)) continue;
      const entry = scores.get(key) ?? { score: 0, branches: new Set() };
      entry.score += 1 / (RRF_K + position);
      entry.branches.add(branch);
      scores.set(key, entry);
    }
  };

  absorb("fts", rankings.fts);
  absorb("vector", rankings.vector);

  const fused: FusedResult<K>[] = [...scores.entries()]
    .map(([key, { score, branches }]) => ({ key, score, branches: [...branches] }))
    .sort((a, b) => b.score - a.score);

  return options?.limit !== undefined ? fused.slice(0, options.limit) : fused;
}
