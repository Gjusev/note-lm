/**
 * PI-2 mechanical answer grader (pi2-criteria.md rubric, judge-free).
 *
 * Verdicts per question x arm, ALL questions in the denominator:
 *   answerable:   fully_supported | partially_supported | unsupported | failure(error/timeout)
 *                 fully_supported = expected canonical fact present in the answer
 *                 (normalized containment + numeric tolerance) AND the cited page
 *                 set covers an expectedEvidence (docId, page) pair.
 *   unanswerable: abstained | invented | failure
 *                 abstention = canonical abstention sentence or any listed
 *                 abstention pattern; anything else with content = invented
 *                 (conservative, per criteria: ANY factual answer counts).
 *
 * Cited pages per arm:
 *   fts/hybrid: the context pages actually shown to the model (top-6 chunk
 *               spans, page..lastPage) - the model can only cite these.
 *   pageindex/hybrid+tree: pages the agent READ via get_page_content plus
 *               [<file>, p. N] citations parsed from the answer text.
 *
 * Usage:
 *   npx tsx eval/harness/grade-answers.mts eval/harness/results/pi2-<subset>-....json \
 *       [--cancel-ms <ms from pi2_bridge.py cancel-test>]
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  options: { "cancel-ms": { type: "string", default: "" } },
  allowPositionals: true,
});
if (!positionals[0]) throw new Error("usage: grade-answers.mts <pi2 results json> [--cancel-ms N]");
const inFile = path.resolve(positionals[0]);
const run = JSON.parse(fs.readFileSync(inFile, "utf8")) as RunFile;

interface RunFile {
  meta: { subset: string; arms: string[]; questionCount: number; answerRule: string; contextChunks: number; budgets: Record<string, unknown> };
  chatServer: Record<string, unknown>;
  resources: { vramUsedMaxMiB: number; ramWorkingSetMaxMB: number };
  phases: Record<string, number>;
  retrievalGrade: Record<string, { answerable?: { recallAt10?: number }; perf?: { e2eP50Ms: number; e2eP95Ms: number }; outcomes: { ok: number; timeout: number; error: number }; tokens: { prompt: number; completion: number; questions: number } }>;
  questions: Array<{
    id: string; type: string; language: string; question: string; docIds: string[];
    expected: Array<{ docId: string; page: number; quoteSnippet?: string }>;
    expectedAnswer: string; probeTerm?: string;
    perArm: Record<string, ArmRun>;
  }>;
  pageTexts: Record<string, string[]>;
}

interface ArmRun {
  outcome: "ok" | "timeout" | "error";
  latencyMs: number; retrievalMs: number; answerMs: number | null;
  hits: Array<{ docId: string; page: number; lastPage: number; score: number; rank: number }>;
  answer: string;
  readPages: Array<{ docName?: string; docId?: string; pages?: number[]; resolved?: boolean }>;
  toolCalls: Array<{ name: string; arguments: unknown }>;
  usage: { prompt_tokens: number; completion_tokens: number } | null;
  error?: string;
}

/* ------------------------------------------------------------ normalize */

/** lowercase, strip diacritics, punctuation -> space, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Numeric candidates per token, tolerant of es/de/en separators:
 * "912.000" -> {912000, 912}; "68,7" -> {68.7}; "1,342" -> {1342, 1.342};
 * "12.4" -> {12.4}; "1.234,56" -> {1234.56}; "1,234.56" -> {1234.56}.
 */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const tok of text.match(/\d[\d.,]*/g) ?? []) {
    const t = tok.replace(/[.,]$/, "");
    const plain = t.replace(/[^0-9A-Za-z]/g, "");
    if (/^\d{1,3}([.,]\d{3})+$/.test(t)) {
      out.push(Number(plain)); // thousands only
    } else if (/^\d{1,3}([.,]\d{3})+[.,]\d+$/.test(t)) {
      out.push(Number(plain) / 100); // thousands + decimals -> strip seps then rescale
    } else if (/^\d+[.,]\d+$/.test(t)) {
      out.push(Number(t.replace(",", ".")));
    } else if (/^\d+$/.test(t)) {
      out.push(Number(t));
    }
    if (/^\d{1,3}\.\d{3}$/.test(t)) out.push(Number(t.replace(/\./g, ""))); // "12.400" also readable as 12400 (3-digit group only)
  }
  return out;
}

function closeTo(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.011, 0.005 * Math.abs(b));
}

const STOP = new Set(["the", "a", "an", "of", "in", "for", "and", "or", "to", "was", "is", "der", "die", "das", "la", "el", "los", "las", "de", "y", "en", "del"]);

/** Expected canonical fact present in the answer: every expected number has a
 *  tolerance match, and at least one content word matches (prefix-both-ways). */
export function factPresent(answer: string, expectedAnswer: string): { ok: boolean; numbersFound: number; numbersExpected: number; wordMatched: string | null } {
  const wantWords = normalize(expectedAnswer).split(" ")
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !STOP.has(w));
  const gotWords = new Set(normalize(answer).split(" "));
  let wordMatched: string | null = null;
  for (const w of wantWords) {
    for (const g of gotWords) {
      if (g === w || (w.length >= 3 && (g.startsWith(w) || w.startsWith(g))) || (w.length === 2 && g.startsWith(w))) {
        wordMatched = w;
        break;
      }
    }
    if (wordMatched) break;
  }
  const wantNums = numbersIn(expectedAnswer);
  const gotNums = numbersIn(answer);
  const missing = wantNums.filter((w) => !gotNums.some((g) => closeTo(g, w)));
  return {
    ok: missing.length === 0 && (wantWords.length === 0 || wordMatched !== null),
    numbersFound: wantNums.length - missing.length,
    numbersExpected: wantNums.length,
    wordMatched,
  };
}

const ABSTENTION_PATTERNS = [
  "la informacion no esta en los documentos",
  "no esta en los documentos",
  "not in the documents",
  "not contain information",
  "does not contain information",
  "no aparece en los documentos",
  "not found in the documents",
  "no se encuentra en",
  "nicht in den dokumenten",
  "nicht enthalten",
  "no hay informacion",
  "no information",
  "not answerable",
  "cannot find",
  "no puedo encontrar",
  "no encontr",
  "not mention",
  "no mention",
  "no such",
  "not available in",
  "keine information",
];

export function isAbstention(answer: string): boolean {
  const n = normalize(answer);
  if (!n) return true; // empty = abstained
  return ABSTENTION_PATTERNS.some((p) => n.includes(p));
}

/* ------------------------------------------------------- cited-page sets */

interface PageRef { docId: string | null; page: number }

/** [<name>, p. N] / [p. N] / bare "p. N", "page N", "página N", "S. N". */
export function parseCitations(answer: string): PageRef[] {
  const refs: PageRef[] = [];
  const bracket = /\[\s*([a-z0-9-]+\.pdf)?\s*,?\s*(?:p{1,2}\.|p[áa]g\.|page\s+|p[áa]gina\s+|seite\s+)?\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?\s*\]/gi;
  for (const m of answer.matchAll(bracket)) {
    const last = m[3] ? Number(m[3]) : Number(m[2]);
    for (let p = Number(m[2]); p <= last; p++) refs.push({ docId: m[1] ?? null, page: p });
  }
  const bare = /\b(?:p{1,2}\.|p[áa]g\.|page|p[áa]gina|seite)\s*(\d{1,3})/gi;
  for (const m of answer.matchAll(bare)) {
    refs.push({ docId: null, page: Number(m[1]) });
  }
  return refs;
}

/** Everything the answer can legitimately be said to cite. */
function citedPages(arm: string, row: RunFile["questions"][number], run: ArmRun): PageRef[] {
  const refs: PageRef[] = [];
  if (arm === "fts" || arm === "hybrid") {
    // the context pages shown to the model (top-6 spans)
    for (const h of run.hits.slice(0, 6)) {
      for (let p = h.page; p <= h.lastPage; p++) refs.push({ docId: h.docId, page: p });
    }
    return refs;
  }
  for (const rp of run.readPages ?? []) {
    if (rp.resolved && rp.docId && Array.isArray(rp.pages)) {
      for (const p of rp.pages) refs.push({ docId: rp.docId!, page: p });
    }
  }
  const fileNameToDoc = new Map(Object.entries(fileNameByDoc));
  for (const c of parseCitations(run.answer)) {
    if (c.docId) {
      const docId = fileNameToDoc.get(c.docId) ?? null;
      refs.push({ docId: docId ?? c.docId.replace(/\.pdf$/, ""), page: c.page });
    } else {
      refs.push(c);
    }
  }
  return refs;
}

const fileNameByDoc: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(path.dirname(inFile), "..", "..", "corpus", "document-trees-v1", "manifest.json"), "utf8")
).docs.reduce((acc: Record<string, string>, d: { docId: string; fileName: string }) => {
  acc[d.docId] = d.fileName;
  return acc;
}, {});

function coversExpected(refs: PageRef[], expected: Array<{ docId: string; page: number }>): PageRef | null {
  for (const e of expected) {
    for (const r of refs) {
      if (r.page === e.page && (r.docId === null || r.docId === e.docId)) return r;
    }
  }
  return null;
}

function quoteOnCitedPage(row: RunFile["questions"][number], refs: PageRef[]): boolean {
  for (const e of row.expected) {
    if (!e.quoteSnippet) continue;
    const q = normalize(e.quoteSnippet);
    const words = q.split(" ");
    const frag = words.slice(0, Math.min(6, words.length)).join(" ");
    for (const r of refs) {
      if (r.docId !== e.docId) continue;
      const pageText = run.pageTexts[r.docId]?.[e.page - 1] ?? "";
      if (normalize(pageText).includes(frag)) return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------- verdicts */

type Verdict = "fully_supported" | "partially_supported" | "unsupported" | "abstained" | "invented" | "failure";

interface GradeRow {
  id: string; type: string; arm: string;
  verdict: Verdict;
  factOk: boolean; evidenceMatch: boolean; abstention: boolean;
  numbersFound: number; numbersExpected: number; wordMatched: string | null;
  citedPages: number; quoteOnCitedPage: boolean;
  rationale: string; outcome: string; error?: string;
}

const structuralTypes = new Set(["cross-section-comparison", "cross-document-comparison", "within-doc-xref"]);

const grades: GradeRow[] = [];
for (const row of run.questions) {
  const answerable = row.expected.length > 0;
  for (const arm of run.meta.arms) {
    const armRun = row.perArm[arm];
    if (!armRun) continue;
    const refs = citedPages(arm, row, armRun);
    const fact = answerable ? factPresent(armRun.answer ?? "", row.expectedAnswer) : null;
    const evMatch = answerable ? coversExpected(refs, row.expected) !== null : false;
    const abst = isAbstention(armRun.answer ?? "");
    let verdict: Verdict;
    let rationale: string;
    if (armRun.outcome !== "ok") {
      verdict = "failure";
      rationale = `outcome=${armRun.outcome}: ${armRun.error ?? "no answer produced"}`;
    } else if (answerable) {
      if (fact!.ok && evMatch) {
        verdict = "fully_supported";
        rationale = `fact found (nums ${fact!.numbersFound}/${fact!.numbersExpected}, word '${fact!.wordMatched}'); cited pages cover expected evidence`;
      } else if (fact!.ok) {
        verdict = "partially_supported";
        rationale = `fact found but no cited page matches expectedEvidence (cited ${refs.length} page refs)`;
      } else {
        verdict = "unsupported";
        rationale = `expected fact NOT in answer (nums ${fact!.numbersFound}/${fact!.numbersExpected}, word '${fact!.wordMatched}')`;
      }
    } else {
      if (abst) {
        verdict = "abstained";
        rationale = "matches an abstention pattern (or empty answer)";
      } else {
        verdict = "invented";
        rationale = "non-empty answer without any abstention marker (conservative: counts as invented)";
      }
    }
    grades.push({
      id: row.id, type: row.type, arm,
      verdict,
      factOk: fact?.ok ?? false,
      evidenceMatch: evMatch,
      abstention: abst,
      numbersFound: fact?.numbersFound ?? 0,
      numbersExpected: fact?.numbersExpected ?? 0,
      wordMatched: fact?.wordMatched ?? null,
      citedPages: refs.length,
      quoteOnCitedPage: quoteOnCitedPage(row, refs),
      rationale,
      outcome: armRun.outcome,
      error: armRun.error,
    });
  }
}

/* ------------------------------------------------------------ aggregates */

function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}

function rate(arm: string, filter: (g: GradeRow) => boolean, want: Verdict): { k: number; n: number; rate: number; ci: [number, number] } {
  const rows = grades.filter((g) => g.arm === arm && filter(g));
  const k = rows.filter((g) => g.verdict === want).length;
  return { k, n: rows.length, rate: rows.length ? k / rows.length : 0, ci: wilson(k, rows.length) };
}

interface ArmGrade {
  arm: string;
  structuralFullySupported: { k: number; n: number; rate: number; ci: [number, number] };
  exactFactFullySupported: { k: number; n: number; rate: number; ci: [number, number] };
  allAnswerableFullySupported: { k: number; n: number; rate: number; ci: [number, number] };
  partiallySupported: number;
  unsupported: number;
  invented: { k: number; n: number; rate: number; ci: [number, number] };
  abstained: number;
  failures: number;
  e2eP50Ms: number; e2eP95Ms: number;
  tokens: { prompt: number; completion: number; questions: number };
  recallAt10: number | null;
}

const armGrades: ArmGrade[] = run.meta.arms.map((arm) => {
  const rg = run.retrievalGrade[arm];
  const invented = rate(arm, (g) => g.type === "unanswerable", "invented");
  return {
    arm,
    structuralFullySupported: rate(arm, (g) => structuralTypes.has(g.type), "fully_supported"),
    exactFactFullySupported: rate(arm, (g) => g.type === "exact-fact", "fully_supported"),
    allAnswerableFullySupported: rate(arm, (g) => g.type !== "unanswerable", "fully_supported"),
    partiallySupported: grades.filter((g) => g.arm === arm && g.verdict === "partially_supported").length,
    unsupported: grades.filter((g) => g.arm === arm && g.verdict === "unsupported").length,
    invented,
    abstained: grades.filter((g) => g.arm === arm && g.type === "unanswerable" && g.verdict === "abstained").length,
    failures: grades.filter((g) => g.arm === arm && g.verdict === "failure").length,
    e2eP50Ms: rg?.perf?.e2eP50Ms ?? 0,
    e2eP95Ms: rg?.perf?.e2eP95Ms ?? 0,
    tokens: rg?.tokens ?? { prompt: 0, completion: 0, questions: 0 },
    recallAt10: rg?.answerable?.recallAt10 ?? null,
  };
});

/* ---------------------------------------------------- criteria checklist */

// Criterion 1: safety - zero citations outside the allowlist; zero
// nonexistent pages. Checked in the bridge (allowlist + page range over the
// agent's reads) and re-checked here over ALL parsed citations.
const pagesByDoc: Record<string, number> = JSON.parse(
  fs.readFileSync(path.join(path.dirname(inFile), "..", "..", "corpus", "document-trees-v1", "manifest.json"), "utf8")
).docs.reduce((acc: Record<string, number>, d: { docId: string; pages: number }) => {
  acc[d.docId] = d.pages;
  return acc;
}, {});
const safetyViolations: Array<{ arm: string; id: string; kind: string; detail?: unknown }> = [];
for (const row of run.questions) {
  const allowed = new Set(row.docIds.length > 0 ? row.docIds : Object.keys(pagesByDoc));
  for (const arm of run.meta.arms) {
    if (arm === "fts" || arm === "hybrid") continue; // retrieval arms cannot cite outside their context by construction
    const armRun = row.perArm[arm];
    if (!armRun) continue;
    for (const rp of armRun.readPages ?? []) {
      if (!rp.resolved) { safetyViolations.push({ arm, id: row.id, kind: "unresolved_doc", detail: rp.docName }); continue; }
      if (!allowed.has(rp.docId!)) safetyViolations.push({ arm, id: row.id, kind: "doc_outside_allowlist", detail: rp.docId });
      const limit = pagesByDoc[rp.docId!] ?? 0;
      for (const p of rp.pages ?? []) {
        if (p >= 1 && p <= limit) continue;
        // Requests beyond the doc's page range: the SDK's get_page_content
        // (agent_tools.py) drops out-of-range pages and answers an error
        // envelope when ALL are out of range - such pages never enter the
        // evidence, so they are counted as SDK-rejected requests, not as
        // presented evidence (criterion 1's wording: "presented as valid
        // evidence"). No parsed answer citation may still point there.
        safetyViolations.push({ arm, id: row.id, kind: "sdk_rejected_page_request", detail: `${rp.docId} p.${p}` });
      }
    }
    for (const c of parseCitations(armRun.answer ?? "")) {
      if (c.docId === null) continue; // docless page refs: page-range checked only when resolvable
      const stem = c.docId.replace(/\.pdf$/, "");
      if (Object.keys(pagesByDoc).includes(stem)) {
        if (!allowed.has(stem)) safetyViolations.push({ arm, id: row.id, kind: "citation_doc_outside_allowlist", detail: `${stem} p.${c.page}` });
        if (c.page < 1 || c.page > (pagesByDoc[stem] ?? 0)) safetyViolations.push({ arm, id: row.id, kind: "citation_page_out_of_range", detail: `${stem} p.${c.page}` });
      } else {
        safetyViolations.push({ arm, id: row.id, kind: "citation_unknown_doc", detail: c.docId });
      }
    }
  }
}

// Criterion 6: degradation on no-TOC / misleading-heading docs.
const indexReportPath = path.join(path.dirname(inFile), "..", "..", "pageindex-proto", "pi2-index-report.json");
let degradation: { checked: Array<{ docId: string; notes: string[]; result: string }>; pass: boolean } = { checked: [], pass: false };
try {
  const idx = JSON.parse(fs.readFileSync(indexReportPath, "utf8")) as {
    docs: Array<{ docId: string; ok?: boolean; nodes?: number; pageOutOfRange?: number; badNodes?: unknown[] }>;
  };
  const corpusManifest = JSON.parse(fs.readFileSync(path.join(path.dirname(inFile), "..", "..", "corpus", "document-trees-v1", "manifest.json"), "utf8")) as { docs: Array<{ docId: string; notes: string[] }> };
  const notesByDoc = new Map(corpusManifest.docs.map((d) => [d.docId, d.notes]));
  const target = corpusManifest.docs.filter((d) => d.notes.includes("no-toc") || d.notes.includes("misleading-headings"));
  degradation.checked = target.map((d) => {
    const e = idx.docs.find((x) => x.docId === d.docId);
    const ok = !!e && e.ok !== false && (e.nodes ?? 0) > 0 && (e.pageOutOfRange ?? 1) === 0;
    return {
      docId: d.docId,
      notes: notesByDoc.get(d.docId) ?? [],
      result: e && e.ok === false ? "index_unavailable (visible)" : ok ? "valid_index" : "SILENT_OR_BROKEN",
    };
  });
  degradation.pass = degradation.checked.every((c) => c.result !== "SILENT_OR_BROKEN");
} catch (err) {
  degradation.checked = [{ docId: "?", notes: [], result: `index report missing: ${String(err).slice(0, 120)}` }];
}

// Criterion 5 pieces
const budget = (() => {
  const pi = armGrades.find((a) => a.arm === "hybrid+tree") ?? armGrades.find((a) => a.arm === "pageindex");
  const hy = armGrades.find((a) => a.arm === "hybrid");
  if (!pi || !hy) return null;
  const ratio = hy.e2eP95Ms > 0 ? pi.e2eP95Ms / hy.e2eP95Ms : Infinity;
  return { armaticaArm: pi.arm, hybridoP95Ms: hy.e2eP95Ms, automaticaP95Ms: pi.e2eP95Ms, ratio, limit: 2, pass: ratio <= 2 };
})();

// informational: page requests the SDK refused (out of range) - never
// presented as evidence, so not a criterion-1 violation, but reported.
let rejectedPageRequests = 0;
for (const row of run.questions) {
  for (const arm of run.meta.arms) {
    const armRun = row.perArm[arm];
    if (!armRun) continue;
    for (const rp of armRun.readPages ?? []) rejectedPageRequests += (rp.rejectedOutOfRange ?? []).length;
  }
}

const criteria = {
  c1_safety: { pass: safetyViolations.every((v) => v.kind !== "doc_outside_allowlist" && v.kind !== "unresolved_doc" && v.kind !== "citation_unknown_doc" && v.kind !== "citation_doc_outside_allowlist" && v.kind !== "citation_page_out_of_range"),
    violations: safetyViolations.slice(0, 20), total: safetyViolations.length,
    presentedEvidenceViolations: safetyViolations.filter((v) => v.kind !== "sdk_rejected_page_request").length,
    rejectedPageRequests, rejectedNote: "page requests the SDK refused before anything entered the evidence (counted, not a violation)" },
  c2_structural: null as unknown,
  c3_exact_fact: null as unknown,
  c4_abstention: null as unknown,
  c5_budget: {
    p95Ratio: budget,
    vramMaxMiB: run.resources?.vramUsedMaxMiB ?? null,
    ramMaxMB: run.resources?.ramWorkingSetMaxMB ?? null,
    memoryBudgetPass: (run.resources?.vramUsedMaxMiB ?? Infinity) <= 8192,
    cancelAbortMs: values["cancel-ms"] ? Number(values["cancel-ms"]) : null,
    cancelBudgetMs: 2000,
  },
  c6_degradation: degradation,
};

{
  const pi = armGrades.find((a) => a.arm === "pageindex");
  const hy = armGrades.find((a) => a.arm === "hybrid");
  if (pi && hy) {
    const delta = pi.structuralFullySupported.rate - hy.structuralFullySupported.rate;
    criteria.c2_structural = {
      pageindex: pi.structuralFullySupported, hybrid: hy.structuralFullySupported,
      deltaPP: +(delta * 100).toFixed(1), thresholdPP: +5, pass: delta >= 0.05,
    };
    const d3 = pi.exactFactFullySupported.rate - hy.exactFactFullySupported.rate;
    criteria.c3_exact_fact = {
      pageindex: pi.exactFactFullySupported, hybrid: hy.exactFactFullySupported,
      deltaPP: +(d3 * 100).toFixed(1), thresholdPP: -3, pass: d3 >= -0.03,
    };
    criteria.c4_abstention = {
      pageindexInvented: pi.invented, hybridInvented: hy.invented,
      note: "failures counted in n but as not-invented (an error produces no answer); failure counts reported alongside",
      pass: pi.invented.rate <= hy.invented.rate,
    };
  }
}

const allPass = [
  criteria.c1_safety.pass,
  (criteria.c2_structural as { pass: boolean } | null)?.pass,
  (criteria.c3_exact_fact as { pass: boolean } | null)?.pass,
  (criteria.c4_abstention as { pass: boolean } | null)?.pass,
  criteria.c5_budget.p95Ratio?.pass ?? false,
  criteria.c5_budget.memoryBudgetPass,
  (criteria.c5_budget.cancelAbortMs ?? Infinity) <= criteria.c5_budget.cancelBudgetMs,
  criteria.c6_degradation.pass,
].every(Boolean);

/* ---------------------------------------------------------------- output */

const outFile = path.join(path.dirname(inFile), path.basename(inFile).replace(/\.json$/, "") + "-graded.json");
fs.writeFileSync(outFile, JSON.stringify({
  gradedFrom: path.basename(inFile),
  rubric: {
    fully_supported: "expected canonical fact present in answer (normalized containment, numeric tolerance max(0.011, 0.5%)) AND cited page set covers an expectedEvidence (docId,page)",
    partially_supported: "fact present, citation does not match",
    unsupported: "fact not present",
    abstained: "unanswerable question, abstention pattern or empty answer",
    invented: "unanswerable question, non-empty answer without abstention marker (conservative)",
    failure: "arm error/timeout (stays in every denominator as a non-success)",
    citations_fts_hybrid: "context pages shown to the model (top-6 chunk spans)",
    citations_pageindex_arms: "pages read via get_page_content + [<file>, p. N] citations parsed from the answer",
  },
  armGrades,
  criteria,
  decision: { allPass, rule: "adopt iff ALL of c1..c6 pass (pi2-criteria.md); quality-only fail -> do-not-adopt; doc-class-only gains -> scope; unsafe/unbuildable -> fail" },
  grades,
}, null, 2));

const fmtRate = (r: { k: number; n: number; rate: number; ci: [number, number] }) =>
  `${r.k}/${r.n} = ${(r.rate * 100).toFixed(1)}% [CI95 ${(r.ci[0] * 100).toFixed(0)}-${(r.ci[1] * 100).toFixed(0)}%]`;

console.log(`\n==== answer-grade: ${path.basename(inFile)} (subset=${run.meta.subset}, questions=${run.meta.questionCount}) ====`);
console.log("\narm          struct fully_sup    exact-fact fully_s  invented(unansw)   abst  fail  p50(ms) p95(ms)");
for (const a of armGrades) {
  console.log([
    a.arm.padEnd(12),
    fmtRate(a.structuralFullySupported).padEnd(19),
    fmtRate(a.exactFactFullySupported).padEnd(20),
    fmtRate(a.invented).padEnd(18),
    String(a.abstained).padEnd(5),
    String(a.failures).padEnd(5),
    a.e2eP50Ms.toFixed(0).padEnd(7),
    a.e2eP95Ms.toFixed(0),
  ].join(" "));
}
console.log("\ncriteria (pi2-criteria.md):");
console.log(`  c1 safety zero-violations:        ${criteria.c1_safety.pass ? "PASS" : `FAIL (${criteria.c1_safety.total})`}`);
console.log(`  c2 structural +5pp:               ${summarizeC2(criteria.c2_structural)}`);
console.log(`  c3 exact-fact no -3pp regression: ${summarizeC3(criteria.c3_exact_fact)}`);
console.log(`  c4 invented not increased:        ${summarizeC4(criteria.c4_abstention)}`);
console.log(`  c5 budget p95<=2x, mem<=8GB:      ${criteria.c5_budget.p95Ratio ? `${criteria.c5_budget.p95Ratio.armaticaArm} p95 ${criteria.c5_budget.p95Ratio.automaticaP95Ms.toFixed(0)}ms vs hybrid ${criteria.c5_budget.p95Ratio.hybridoP95Ms.toFixed(0)}ms (x${criteria.c5_budget.p95Ratio.ratio.toFixed(2)}) ${criteria.c5_budget.p95Ratio.pass ? "ok" : "FAIL"}; VRAM ${criteria.c5_budget.vramMaxMiB}MiB ${criteria.c5_budget.memoryBudgetPass ? "ok" : "FAIL"}; cancel ${criteria.c5_budget.cancelAbortMs ?? "n/a"}ms` : "n/a"}`);
console.log(`  c6 degradation (8 docs):          ${criteria.c6_degradation.pass ? "PASS" : "FAIL"} ${criteria.c6_degradation.checked.map((c) => `${c.docId}=${c.result}`).join(", ")}`);
console.log(`\nDECISION: ${allPass ? "ADOPT (pending PI-3..5 packaged-lifecycle gate)" : "per-criteria branch - see report"}`);
console.log(`graded -> ${outFile}`);

function summarizeC2(c: unknown): string {
  const x = c as { deltaPP: number; pass: boolean; pageindex: { n: number }; hybrid: { rate: number }; pageindex: { rate: number; n: number } } | null;
  if (!x) return "n/a";
  return `delta ${x.deltaPP > 0 ? "+" : ""}${x.deltaPP}pp (n=${x.pageindex.n}) ${x.pass ? "PASS" : "FAIL"}`;
}
function summarizeC3(c: unknown): string {
  const x = c as { deltaPP: number; pass: boolean; pageindex: { n: number } } | null;
  if (!x) return "n/a";
  return `delta ${x.deltaPP > 0 ? "+" : ""}${x.deltaPP}pp (n=${x.pageindex.n}) ${x.pass ? "PASS" : "FAIL"}`;
}
function summarizeC4(c: unknown): string {
  const x = c as { pageindexInvented: { rate: number; n: number }; hybridInvented: { rate: number; n: number }; pass: boolean } | null;
  if (!x) return "n/a";
  return `pageindex ${(x.pageindexInvented.rate * 100).toFixed(1)}% vs hybrid ${(x.hybridInvented.rate * 100).toFixed(1)}% (n=${x.pageindexInvented.n}) ${x.pass ? "PASS" : "FAIL"}`;
}
