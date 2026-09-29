#!/usr/bin/env node
/**
 * Open benchmark - single reproducible entry point
 * (docs/specs/open-source-innovation-strategy section 10: publish the
 * benchmark with synthetic/redistributable documents, questions, expected
 * evidence, configuration and NEGATIVE results).
 *
 * Runs, in order:
 *   1. generate + validate both corpora (document-trees-v1 + version-pairs-v1)
 *      by calling the existing node generators/validators as child processes
 *   2. the retrieval eval - eval/harness/run-retrieval-eval.mts via tsx,
 *      --subset eval --variants fts,hybrid. The harness itself hard-fails
 *      when the hybrid arm is requested without the llama.cpp artifacts, so
 *      this script probes them first: with artifacts it runs fts,hybrid;
 *      without, it runs --variants fts (the fts arm needs nothing) and the
 *      summary reports the embedding arm as SKIPPED, not failed - fresh
 *      clones still get corpora + FTS + E1/E2.
 *   3. the E1/E2 change-review suite (vitest) - the suite itself writes the
 *      machine-readable eval/reports/e1-e2-run.json
 *   4. writes eval/reports/benchmark-summary.md with the headline tables and
 *      a pointer to the recorded PI-2 negative result (never rerun here -
 *      it is expensive and its verdict is recorded).
 *
 * No network required: FTS needs nothing; hybrid embeds via a locally spawned
 * llama-server ONLY when .probe-downloads has the artifacts (fetch via
 * npm run fetch:llama). Idempotent: reruns regenerate the corpora
 * deterministically (byte-identical PDFs) and overwrite the summary.
 *
 * Run:  node scripts/run-benchmark.mjs   (or npm run eval:benchmark)
 */
import { spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORTS_DIR = path.join(REPO, "eval", "reports");
const RESULTS_DIR = path.join(REPO, "eval", "harness", "results");
const CORPUS_TREES = path.join(REPO, "eval", "corpus", "document-trees-v1");
const CORPUS_PAIRS = path.join(REPO, "eval", "corpus", "version-pairs-v1");
const LLAMA_EXE = path.join(REPO, ".probe-downloads", "llama-bin", "llama-server.exe");
const EMBED_MODEL = path.join(REPO, ".probe-downloads", "bge-small-en-v1.5-q8_0.gguf");

const steps = [];
const run = (name, fn) => {
  const t0 = Date.now();
  try {
    const info = fn();
    steps.push({ name, status: "ok", seconds: (Date.now() - t0) / 1000, info });
    console.log(`=== ${name}: ok (${((Date.now() - t0) / 1000).toFixed(1)}s) ===`);
  } catch (err) {
    steps.push({ name, status: "FAIL", seconds: (Date.now() - t0) / 1000, info: err.message });
    console.error(`=== ${name}: FAILED ===`);
    console.error(err.message);
    throw err;
  }
};

const sh = (cmd, args, extra = {}) => {
  const r = spawnSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: REPO,
    shell: process.platform === "win32" && cmd !== process.execPath,
    encoding: "utf8",
    ...extra,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.status !== 0) {
    throw new Error("`" + cmd + " " + args.join(" ") + "` exited " + r.status + "\n" + out.slice(-2000));
  }
  return out;
};
const lastLine = (out) => out.split("\n").at(-1);

/** Newest eval result JSON written by this run (slug carries the timestamp). */
function newestRetrievalResult(before) {
  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => /^eval-.*\.json$/.test(f) && !before.has(f));
  if (files.length === 0) throw new Error("no new retrieval result file written");
  return path.join(RESULTS_DIR, files.sort().at(-1));
}

/* ------------------------------------------------------------------ steps */

let failed = false;
const hasEmbedArtifacts = fs.existsSync(LLAMA_EXE) && fs.existsSync(EMBED_MODEL);
const variants = hasEmbedArtifacts ? "fts,hybrid" : "fts";
try {
  run("corpus: document-trees-v1 generate", () => {
    sh(process.execPath, [path.join(CORPUS_TREES, "generate-corpus.mjs")]);
    const m = JSON.parse(fs.readFileSync(path.join(CORPUS_TREES, "manifest.json"), "utf8"));
    return m.docs.length + " docs, " + m.totals.pages + " pages";
  });

  run("corpus: document-trees-v1 validate", () =>
    lastLine(sh(process.execPath, [path.join(CORPUS_TREES, "validate-corpus.mjs")]))
  );

  run("corpus: version-pairs-v1 generate", () => {
    sh(process.execPath, [path.join(CORPUS_PAIRS, "generate-version-pairs.mjs")]);
    const m = JSON.parse(fs.readFileSync(path.join(CORPUS_PAIRS, "manifest.json"), "utf8"));
    return m.totals.pairs + " pairs, " + m.totals.claims + " claims";
  });

  run("corpus: version-pairs-v1 validate", () =>
    lastLine(sh(process.execPath, [path.join(CORPUS_PAIRS, "validate-version-pairs.mjs")]))
  );

  run("retrieval eval (subset=eval, variants=" + variants + ")", () => {
    const before = new Set(fs.existsSync(RESULTS_DIR) ? fs.readdirSync(RESULTS_DIR) : []);
    sh("npx", ["tsx", "eval/harness/run-retrieval-eval.mts", "--subset", "eval", "--variants", variants]);
    return newestRetrievalResult(before);
  });

  run("E1/E2 change-review suite (vitest)", () => {
    const out = sh("npx", ["vitest", "run", "src/__tests__/change-review.test.ts"]);
    const clean = out.split(String.fromCharCode(27)).map((piece) => piece.replace(/^[[0-9;]*m/, "")).join("");
    const testFiles = clean.match(/Test Files\s+(.+)/)?.[1]?.trim() ?? "?";
    const tests = clean.match(/Tests\s+(.+)/)?.[1]?.trim() ?? "?";
    if (!fs.existsSync(path.join(REPORTS_DIR, "e1-e2-run.json"))) {
      throw new Error("suite passed but eval/reports/e1-e2-run.json was not written");
    }
    return "Test Files " + testFiles + ", Tests " + tests;
  });
} catch {
  failed = true;
}

/* ------------------------------------------------------------ summary md */

function writeSummary(didFail) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const retrievalFile = steps.find((s) => s.name.startsWith("retrieval"))?.info;
  const vitestLine = steps.find((s) => s.name.startsWith("E1/E2"))?.info ?? "not run";
  const vitestOk = steps.find((s) => s.name.startsWith("E1/E2"))?.status === "ok";
  const e1e2 = vitestOk && fs.existsSync(path.join(REPORTS_DIR, "e1-e2-run.json"))
    ? JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, "e1-e2-run.json"), "utf8"))
    : null;
  const retrieval = retrievalFile && fs.existsSync(retrievalFile)
    ? JSON.parse(fs.readFileSync(retrievalFile, "utf8"))
    : null;
  let head = "";
  try {
    head = execSync("git rev-parse --short HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch { /* detached or no git */ }

  const corpusRows = steps
    .filter((s) => s.name.startsWith("corpus:"))
    .map((s) => "| " + s.name.replace("corpus: ", "") + " | " + (s.status === "ok" ? "PASS" : "FAIL") + " | " + s.seconds.toFixed(1) + "s | " + s.info + " |")
    .join("\n");

  const retrievalTable = retrieval
    ? [
        "| variant | n (answerable) | recall@5 | recall@10 | MRR | nDCG@10 | docIdR@10 | 1stPgR@10 | pressure | p50 ms | p95 ms |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ...Object.entries(retrieval.variants).map(([name, v]) =>
          [
            name,
            v.answerable.count,
            v.answerable.recallAt5.toFixed(3),
            v.answerable.recallAt10.toFixed(3),
            v.answerable.mrr.toFixed(3),
            v.answerable.ndcgAt10.toFixed(3),
            v.answerable.docIdRecallAt10.toFixed(3),
            v.answerable.firstPageRecallAt10.toFixed(3),
            v.unanswerable.evidencePressure.toFixed(3),
            v.perf.retrievalP50Ms.toFixed(1),
            v.perf.retrievalP95Ms.toFixed(1),
          ].join(" | ")
        ),
      ].map((r) => (r.startsWith("|") ? "| " + r.slice(1).trim().replace(/[|]$/, "").trim() + " |" : "| " + r + " |")).join("\n")
    : "_retrieval eval did not run_";

  const hybridNote = hasEmbedArtifacts
    ? null
    : "SKIPPED: the hybrid arm needs .probe-downloads/llama-bin/llama-server.exe and .probe-downloads/bge-small-en-v1.5-q8_0.gguf (fetch via npm run fetch:llama); this run executed the FTS arm only.";

  const e1e2Rows = e1e2
    ? [
        "| metric | value |",
        "| --- | --- |",
        "| vitest suite | " + vitestLine + " |",
        "| pairs | " + e1e2.totals.pairs + " |",
        "| claims graded | " + e1e2.totals.claims + " |",
        "| expected proposals | " + e1e2.totals.expectedProposals + " |",
        "| confusion (tp/fp/fn/tn) | " + [e1e2.confusion.tp, e1e2.confusion.fp, e1e2.confusion.fn, e1e2.confusion.tn].join(" / ") + " |",
        "| precision | **" + (e1e2.precision * 100).toFixed(1) + "%** (criterion >= 90%) |",
        "| recall | **" + (e1e2.recall * 100).toFixed(1) + "%** (criterion >= 80%) |",
        "| deterministic propagation | " + e1e2.deterministicPropagation.ok + "/" + e1e2.deterministicPropagation.expectedExactPairs + " pairs exact |",
      ].join("\n")
    : [
        "| metric | value |",
        "| --- | --- |",
        "| vitest suite | " + (steps.find((s) => s.name.startsWith("E1/E2"))?.status === "FAIL" ? "FAILED - see step output" : "not run") + " |",
      ].join("\n");

  const stepRows = steps
    .map((s) => "| " + s.name + " | " + (s.status === "ok" ? "PASS" : "FAIL") + " | " + s.seconds.toFixed(1) + "s |")
    .join("\n");

  const md = [
    "# Open benchmark summary",
    "",
    "Generated by `npm run eval:benchmark` (`scripts/run-benchmark.mjs`) on",
    new Date().toISOString() + (head ? ", repo HEAD `" + head + "`" : "") + ".",
    "Corpora are deterministic and byte-reproducible; every number below is",
    "regenerated by this command, no result is hand-entered.",
    "",
    "## Steps",
    "",
    "| step | status | time |",
    "| --- | --- | --- |",
    stepRows,
    didFail ? "" : null,
    didFail ? "> One or more steps FAILED; tables below reflect whatever completed." : null,
    "",
    "## Corpora (synthetic, we authored, redistributable - MIT with the repo)",
    "",
    "| check | status | time | result |",
    "| --- | --- | --- | --- |",
    corpusRows,
    "",
    "- `eval/corpus/document-trees-v1` - 21 synthetic multi-section PDFs (en/es/de) + 80 annotated questions (50 eval).",
    "- `eval/corpus/version-pairs-v1` - 20 deterministic PDF version pairs (material-change / moved / deleted / format-only), 60 claims, 15 expected proposals.",
    "",
    "## Retrieval eval (page-level, eval subset n=" + (retrieval?.meta.questionCount ?? "?") + ")",
    "",
    retrievalTable,
    hybridNote ? "" : null,
    hybridNote ? "**" + hybridNote + "**" : null,
    "",
    "Grading rules, chunking and the embedding recipe are recorded inside the",
    "results JSON under `meta`. Raw run: `" + path.relative(REPO, retrievalFile ?? ".").split(path.sep).join("/") + "`;",
    "trend: `eval/harness/results/history.jsonl`.",
    "",
    "## E1/E2 change review (version-pairs-v1)",
    "",
    e1e2Rows,
    "",
    "Machine-readable: `eval/reports/e1-e2-run.json`; write-up:",
    "`eval/reports/e1-e2-change-review.md`. The vitest file",
    "(`src/__tests__/change-review.test.ts`) asserts the criteria before writing it.",
    "",
    "## Negative results (published, not hidden)",
    "",
    "- **PI-2 - PageIndex Analisis profundo: DO NOT ADOPT.** Quality failed",
    "  (structural fully_supported -13.6 pp vs hybrid), latency failed (p95 3.4x",
    "  hybrid) and the pre-registered Flash mode cannot index this corpus (21/21",
    "  docs unbuildable).",
    "  Full decision report: `eval/pageindex-proto/pi2-decision-report.md`",
    "  (pre-registered criteria in `pi2-criteria.md`, raw runs under",
    "  `eval/harness/results/pi2-*.json`). This benchmark does NOT rerun PI-2 -",
    "  it is expensive (7B LLM indexing, ~20 min) and its verdict is recorded.",
  ]
    .filter((l) => l !== null)
    .join("\n");
  fs.writeFileSync(path.join(REPORTS_DIR, "benchmark-summary.md"), md);
  console.log("\nsummary written: " + path.join(REPORTS_DIR, "benchmark-summary.md"));
}

/* ------------------------------------------------------------------ main */

writeSummary(failed);
if (failed) {
  console.error("\nbenchmark FAILED - details in eval/reports/benchmark-summary.md");
  process.exit(1);
}
