/**
 * Retrieval evaluation metrics (issue #6): recall@10, MRR and nDCG@10 with
 * binary relevance. No-answer questions (empty relevant set) score full
 * recall/nDCG and zero MRR — retrieving nothing relevant is the goal there,
 * and these metrics measure ranking quality, not abstention.
 */

export interface RetrievalMetrics {
  recallAt10: number;
  mrr: number;
  ndcgAt10: number;
}

export function computeRetrievalMetrics(ranked: string[], relevant: Set<string>): RetrievalMetrics {
  const top = ranked.slice(0, 10);
  const found = top.filter((id) => relevant.has(id));
  const recallAt10 = relevant.size === 0 ? 1 : found.length / relevant.size;

  let mrr = 0;
  for (let i = 0; i < top.length; i++) {
    if (relevant.has(top[i])) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  const dcg = top.reduce((sum, id, i) => (relevant.has(id) ? sum + 1 / Math.log2(i + 2) : sum), 0);
  const ideal = Array.from({ length: Math.min(relevant.size, 10) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
  const ndcgAt10 = ideal === 0 ? 1 : dcg / ideal;

  return { recallAt10, mrr, ndcgAt10 };
}
