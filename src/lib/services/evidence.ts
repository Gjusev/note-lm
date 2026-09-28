/** Transport-independent evidence contract for HTTP and the desktop engine. */
export interface EvidenceChunk {
  sourceId: string;
  chunkIndex: number;
  content: string;
  fileName: string;
}

export interface EvidenceExcerpt extends EvidenceChunk { reference: string }
export interface EvidenceContext { context: string; excerpts: EvidenceExcerpt[] }

/** The budget includes labels and JSON escaping as well as the document text. */
export function buildEvidenceContext(chunks: EvidenceChunk[], budget = 24_000, maxExcerptLength = 4_000): EvidenceContext {
  const excerpts: EvidenceExcerpt[] = [];
  const blocks: string[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const chunk of chunks) {
    const key = JSON.stringify([chunk.sourceId, chunk.chunkIndex]);
    if (seen.has(key) || !chunk.content.trim()) continue;
    seen.add(key);
    const excerpt: EvidenceExcerpt = {
      ...chunk, fileName: chunk.fileName.slice(0, 160), reference: `E${excerpts.length + 1}`,
      content: chunk.content.slice(0, Math.max(0, maxExcerptLength)),
    };
    const serialize = () => JSON.stringify({
      reference: excerpt.reference, fileName: excerpt.fileName,
      chunkIndex: excerpt.chunkIndex, text: excerpt.content,
    });
    const remaining = Math.max(0, budget - used - (blocks.length ? 1 : 0));
    let block = serialize();
    // Find the longest prefix that fits, including escaped control characters.
    if (block.length > remaining) {
      const original = excerpt.content;
      let low = 0;
      let high = original.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        excerpt.content = original.slice(0, middle);
        if (serialize().length <= remaining) low = middle;
        else high = middle - 1;
      }
      excerpt.content = original.slice(0, low);
      block = serialize();
    }
    if (!excerpt.content.trim() || block.length > remaining) continue;
    used += block.length + (blocks.length ? 1 : 0);
    blocks.push(block);
    excerpts.push(excerpt);
  }
  return { context: blocks.join("\n"), excerpts };
}

/** Only references emitted by the model and present in its context become citations. */
export function resolveEvidenceReferences(response: string, evidence: EvidenceContext) {
  const available = new Map(evidence.excerpts.map((excerpt) => [excerpt.reference, excerpt]));
  const cited = new Map<string, number>();
  const citations: { sourceId: string; chunkIndex: number; text: string; fileName: string }[] = [];
  const content = response.replace(/\[E\d+\]/g, (marker) => {
    const reference = marker.slice(1, -1);
    const excerpt = available.get(reference);
    if (!excerpt) return "[Quelle nicht verfügbar]";
    let number = cited.get(reference);
    if (!number) {
      number = citations.length + 1;
      cited.set(reference, number);
      citations.push({ sourceId: excerpt.sourceId, chunkIndex: excerpt.chunkIndex, text: excerpt.content, fileName: excerpt.fileName });
    }
    return `[${number}]`;
  });
  return { response: content, citations };
}
