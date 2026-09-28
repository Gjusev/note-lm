import { describe, expect, it } from "vitest";
import { buildEvidenceContext, resolveEvidenceReferences } from "@/lib/services/evidence";
const chunk = (sourceId: string, content = "An exact excerpt from a document.") => ({ sourceId, chunkIndex: 0, fileName: `${sourceId}.pdf`, content });

describe("evidence context", () => {
  it("bounds oversized chunks and JSON escaping, preserving the exact excerpt", () => {
    const original = 'Text "quoted"\n'.repeat(5_000);
    const evidence = buildEvidenceContext([chunk("a", original)], 300);
    expect(evidence.context.length).toBeLessThanOrEqual(300);
    expect(evidence.excerpts).toHaveLength(1);
    const entry = JSON.parse(evidence.context);
    expect(entry.text).toBe(evidence.excerpts[0].content);
    expect(original.startsWith(entry.text)).toBe(true);
  });
  it("omits chunks that do not fit and rejects references to those chunks", () => {
    const first = buildEvidenceContext([chunk("a")]);
    const evidence = buildEvidenceContext([chunk("a"), chunk("b")], first.context.length);
    expect(evidence.excerpts.map((e) => e.sourceId)).toEqual(["a"]);
    const result = resolveEvidenceReferences("Answer [E1]. Fabricated [E2].", evidence);
    expect(result.citations.map((c) => c.sourceId)).toEqual(["a"]);
    expect(result.response).toBe("Answer [1]. Fabricated [Quelle nicht verfügbar].");
  });
  it("deduplicates chunks without collapsing distinct chunks in one source", () => {
    const evidence = buildEvidenceContext([chunk("a"), chunk("a"), { ...chunk("a"), chunkIndex: 1 }, chunk("b", "  ")]);
    expect(evidence.excerpts.map((e) => e.chunkIndex)).toEqual([0, 1]);
    expect(buildEvidenceContext([chunk("a")], 0).excerpts).toEqual([]);
  });
  it("stores only cited excerpts in first-use order and reuses their displayed numbers", () => {
    const evidence = buildEvidenceContext([chunk("a"), chunk("b"), chunk("unused")]);
    const result = resolveEvidenceReferences("B [E2]. A [E1]. B again [E2].", evidence);
    expect(result.response).toBe("B [1]. A [2]. B again [1].");
    expect(result.citations.map((c) => c.sourceId)).toEqual(["b", "a"]);
    expect(result.citations[0].text).toBe(evidence.excerpts[1].content);
    expect(resolveEvidenceReferences("No support found.", evidence).citations).toEqual([]);
  });
});
