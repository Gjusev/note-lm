#!/usr/bin/env node
/**
 * WER harness for the local ASR stack (T2): runs the pinned whisper.cpp CLI
 * (v1.9.2, .probe-downloads/whisper-bin) with ggml-tiny AND ggml-base over the
 * deterministic SAPI reference samples (eval/audio-proto/samples/) and scores
 * them against the exact reference transcripts with a standard word-level
 * Levenshtein WER. Also measures the timestamp span whisper reports against
 * the real wav duration and the wall time per model+sample.
 *
 * Honesty note (also in wer-report.md): the references are SYNTHETIC TTS
 * speech - clean single voice, no prosody of real human speech, no noise.
 * WER on TTS is an upper-bound-flattering estimate; real-world WER will be
 * worse. The harness measures the mechanics (runtime, times, digits) more
 * than acoustic robustness.
 *
 * Run:  node eval/audio-proto/measure-wer.mjs
 * Out:  eval/audio-proto/wer-report.md + wer-results.json
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SAMPLES = path.join(ROOT, "eval", "audio-proto", "samples");
const WHISPER_DIR = path.join(ROOT, ".probe-downloads", "whisper-bin");
const MODELS = [
  { id: "ggml-tiny", file: path.join(ROOT, ".probe-downloads", "ggml-tiny.bin") },
  { id: "ggml-base", file: path.join(ROOT, ".probe-downloads", "ggml-base.bin") },
];
/** Forced language per sample (SAPI TTS is clearly one language; auto-detect
 *  on 20 s clips can flip - forcing keeps the measurement controlled). */
const LANG = { "de-wirtschaft": "de", "en-briefing": "en", "de-zahlen": "de" };

// --- WER core (standard word-level Levenshtein, no dependency) -------------

/** Lowercase, keep only unicode letters/digits (umlauts stay), collapse. */
function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n < m ? n + 1 : m + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,                       // deletion
        cur[j - 1] + 1,                    // insertion
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** WER in percent; null when the reference is empty. */
function wer(refText, hypText) {
  const ref = normalize(refText);
  const hyp = normalize(hypText);
  if (!ref.length) return null;
  return (100 * levenshtein(ref, hyp)) / ref.length;
}

// --- wav duration from the header (16 kHz mono pcm16 produced by SAPI) -----

function wavDurationSec(file) {
  const buf = fs.readFileSync(file);
  // walk RIFF chunks to find "fmt " + "data" (robust against extra chunks)
  let off = 12, fmt = null, dataLen = 0, dataOff = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    } else if (id === "data") {
      dataLen = size;
      dataOff = off + 8;
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !fmt.channels || !fmt.rate) return null;
  return (dataLen || buf.length - dataOff) / ((fmt.rate * fmt.bits * fmt.channels) / 8);
}

// --- whisper run -------------------------------------------------------------

function runWhisper(modelFile, wav, lang) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-wer-"));
  const base = path.join(tmp, "out");
  const t0 = Date.now();
  try {
    // cwd = whisper dir so the ggml DLLs resolve (same as src/lib/ai/whisper.ts)
    const r = spawnSync(path.join(WHISPER_DIR, "whisper-cli.exe"), [
      "-m", modelFile, "-f", wav, "-oj", "-of", base, "-l", lang,
    ], { cwd: WHISPER_DIR, encoding: "utf8", timeout: 300_000, windowsHide: true });
    if (r.status !== 0) throw new Error(`whisper-cli failed (${r.status}): ${String(r.stderr).slice(-300)}`);
    const json = JSON.parse(fs.readFileSync(`${base}.json`, "utf8"));
    const segments = (json.transcription ?? []).map((s) => ({
      startSec: (s.offsets?.from ?? 0) / 1000,
      endSec: (s.offsets?.to ?? 0) / 1000,
      text: (s.text ?? "").trim(),
    }));
    return {
      text: segments.map((s) => s.text).join(" "),
      startSec: segments[0]?.startSec ?? 0,
      endSec: segments.at(-1)?.endSec ?? 0,
      language: json.result?.language ?? null,
      wallMs: Date.now() - t0,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// --- main ---------------------------------------------------------------------

const files = fs.readdirSync(SAMPLES).filter((f) => f.endsWith(".wav")).sort();
if (!files.length) throw new Error(`no wav samples in ${SAMPLES} - run generate-samples.ps1 first`);

const results = [];
for (const model of MODELS) {
  if (!fs.existsSync(model.file)) throw new Error(`model missing: ${model.file} (run npm run fetch:whisper's model download)`);
  const modelSha = execFileSync("powershell", ["-NoProfile", "-Command",
    `(Get-FileHash -Algorithm SHA256 '${model.file}').Hash.ToLower()`], { encoding: "utf8" }).trim();
  for (const file of files) {
    const base = file.replace(/\.wav$/, "");
    const lang = LANG[base] ?? "auto";
    const refText = fs.readFileSync(path.join(SAMPLES, `${base}.txt`), "utf8");
    const refDuration = wavDurationSec(path.join(SAMPLES, file));
    const run = runWhisper(model.file, path.join(SAMPLES, file), lang);
    const w = wer(refText, run.text);
    const row = {
      model: model.id,
      modelSha256: modelSha,
      sample: base,
      language: lang,
      detectedLanguage: run.language,
      refWords: normalize(refText).length,
      werPercent: w == null ? null : Math.round(w * 10) / 10,
      refDurationSec: Math.round(refDuration * 10) / 10,
      whisperSpanSec: Math.round(run.endSec * 10) / 10,
      timestampDeviationSec: Math.round((run.endSec - refDuration) * 10) / 10,
      wallSeconds: Math.round(run.wallMs / 100) / 10,
      hypothesis: run.text,
    };
    results.push(row);
    console.log(
      `${row.model.padEnd(10)} ${base.padEnd(14)} ${String(row.language).padEnd(4)} ` +
      `WER=${row.werPercent}% span=${row.whisperSpanSec}s ref=${row.refDurationSec}s ` +
      `dev=${row.timestampDeviationSec}s wall=${row.wallSeconds}s`
    );
  }
}

fs.writeFileSync(path.join(ROOT, "eval", "audio-proto", "wer-results.json"), JSON.stringify(results, null, 2) + "\n");

// markdown report: one table per model, rows per sample
const lines = [
  "# WER harness (T2): local whisper.cpp over synthetic TTS references",
  "",
  `Generated: ${new Date().toISOString()} · whisper.cpp v1.9.2 (pinned, CPU) · samples: eval/audio-proto/samples (SAPI TTS, 16 kHz mono, deterministic per voice)`,
  "",
  "> **Ceiling note (read before quoting these numbers):** the references are",
  "> synthetic Windows SAPI speech - a single clean studio voice, no room noise,",
  "> no real human prosody. WER on TTS flatters the models (upper-bound",
  "> estimate); real microphone speech will score worse. The harness measures",
  "> runtime mechanics (wall time, timestamp span, number handling) more than",
  "> acoustic robustness. Timestamps deviation compares whisper's reported",
  "> segment span with the true wav duration from the RIFF header.",
  "",
];
for (const model of MODELS) {
  const rows = results.filter((r) => r.model === model.id);
  lines.push(`## ${model.id} (${(fs.statSync(model.file).size / 1024 / 1024).toFixed(1)} MB)`);
  lines.push("");
  lines.push("| Sample | Lang | Ref words | WER % | Ref dur s | Whisper span s | Deviation s | Wall s |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|");
  for (const r of rows) {
    lines.push(
      `| ${r.sample} | ${r.language} | ${r.refWords} | ${r.werPercent} | ${r.refDurationSec} | ` +
      `${r.whisperSpanSec} | ${r.timestampDeviationSec} | ${r.wallSeconds} |`
    );
  }
  const avg = (rows.reduce((a, r) => a + r.werPercent, 0) / rows.length).toFixed(1);
  const dev = rows.reduce((a, r) => a + r.timestampDeviationSec, 0) / rows.length;
  lines.push("");
  lines.push(`Average WER: **${avg}%** · average timestamp deviation: **${dev.toFixed(1)} s** · model sha256: \`${rows[0].modelSha256}\``);
  lines.push("");
}
lines.push("## Hypotheses (raw whisper output)");
lines.push("");
for (const r of results) {
  lines.push(`- **${r.model} / ${r.sample}** (${r.detectedLanguage ?? "?"}): ${r.hypothesis}`);
}
fs.writeFileSync(path.join(ROOT, "eval", "audio-proto", "wer-report.md"), lines.join("\n") + "\n");
console.log("\nwrote eval/audio-proto/wer-report.md + wer-results.json");
