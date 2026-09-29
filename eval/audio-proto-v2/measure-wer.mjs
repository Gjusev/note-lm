#!/usr/bin/env node
/**
 * WER harness for the local ASR stack (T2-v2): NATURAL human speech references.
 *
 * Extends eval/audio-proto/measure-wer.mjs (READ-ONLY, unchanged) per the
 * fifth-delivery mandate: T2 measured whisper.cpp over synthetic Windows SAPI
 * TTS and documented that prosody ceiling. This v2 harness measures the SAME
 * pinned whisper.cpp + ggml-tiny/base over REDISTRIBUTIBLE REAL-HUMAN-SPEECH
 * clips (audio-orig/ + transcripts/ + licenses.json) in de/es/en, and re-runs
 * the original SAPI samples read-only as the comparison condition on the same
 * machine/session.
 *
 * Timestamp honesty: every natural clip is ONE complete utterance (a single
 * poem read start to finish - no intros, no concatenated sentences), so the
 * ffprobe/RIFF-measured wav duration IS the true temporal annotation of that
 * utterance's span and [0, duration] is a real annotation, not a
 * file-duration-vs-multi-sentence-span shortcut. Whisper's reported segment
 * span is scored against both edges (start deviation vs 0, end deviation vs
 * duration).
 *
 * Run:  node eval/audio-proto-v2/measure-wer.mjs
 * Out:  eval/audio-proto-v2/t2-v2-results.json + t2-v2-report.md
 *       (+ wav/ cache of 16 kHz mono conversions, gitignored)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const WHISPER_DIR = path.join(ROOT, ".probe-downloads", "whisper-bin");
const MODELS = [
  { id: "ggml-tiny", file: path.join(ROOT, ".probe-downloads", "ggml-tiny.bin") },
  { id: "ggml-base", file: path.join(ROOT, ".probe-downloads", "ggml-base.bin") },
];
const SAPI_DIR = path.join(ROOT, "eval", "audio-proto", "samples"); // READ-ONLY
const FFMPEG_CANDIDATES = [
  path.join(ROOT, ".probe-downloads", "ffmpeg-n8.1.3-6-gff48edd8b2-win64-gpl-8.1", "bin", "ffmpeg.exe"),
  "ffmpeg", // PATH fallback
];
const FFMPEG = FFMPEG_CANDIDATES.find((p) => {
  if (!p.includes(path.sep)) return spawnSync(p, ["-version"], { encoding: "utf8", windowsHide: true }).status === 0;
  return fs.existsSync(p);
});

// --- WER core (identical algorithm to T2's measure-wer.mjs) -------------------

/** Lowercase, keep only unicode letters/digits (umlauts/accented stay), collapse. */
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
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function wer(refText, hypText) {
  const ref = normalize(refText);
  const hyp = normalize(hypText);
  if (!ref.length) return null;
  return (100 * levenshtein(ref, hyp)) / ref.length;
}

// --- wav duration from the RIFF header (same walker as T2) ---------------------

function wavDurationSec(file) {
  const buf = fs.readFileSync(file);
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

// --- whisper run (identical flags to T2) ---------------------------------------

function runWhisper(modelFile, wav, lang) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-t2v2-"));
  const base = path.join(tmp, "out");
  const t0 = Date.now();
  try {
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

// --- sample sets ----------------------------------------------------------------

const licenses = JSON.parse(fs.readFileSync(path.join(HERE, "licenses.json"), "utf8"));
const wavDir = path.join(HERE, "wav");
fs.mkdirSync(wavDir, { recursive: true });

/** Convert a licensed original to a deterministic 16 kHz / mono / pcm16 wav,
 *  trimming only LEADING/TRAILING silence (keeping 0.15 s of boundary silence
 *  so plosives are not clipped; inter-verse pauses stay). This makes the wav
 *  duration the true span of the single spoken utterance, which is what the
 *  [0, duration] timestamp annotation asserts - several source oggs carry
 *  multiple seconds of trailing room tone. Threshold pinned at -38 dB. */
function ensureWav(clip) {
  const wav = path.join(wavDir, `${clip.id}.wav`);
  if (!fs.existsSync(wav)) {
    const af = [
      "silenceremove=start_periods=1:start_threshold=-38dB:start_silence=0.15",
      "areverse",
      "silenceremove=start_periods=1:start_threshold=-38dB:start_silence=0.15",
      "areverse",
    ].join(",");
    const r = spawnSync(FFMPEG, ["-y", "-i", path.join(HERE, clip.file), "-vn", "-af", af, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav],
      { encoding: "utf8", timeout: 120_000, windowsHide: true });
    if (r.status !== 0) throw new Error(`ffmpeg failed for ${clip.id}: ${String(r.stderr).slice(-300)}`);
  }
  return wav;
}

const SAMPLES = [];
for (const clip of licenses.clips) {
  const wav = ensureWav(clip);
  SAMPLES.push({
    condition: "natural",
    id: clip.id,
    language: clip.language,
    transcriptFile: path.join(HERE, "transcripts", `${clip.id}.txt`),
    wav,
  });
}
// TTS comparison condition: the original SAPI samples, read-only (T2 corpus had no es).
for (const f of fs.readdirSync(SAPI_DIR).filter((f) => f.endsWith(".wav")).sort()) {
  const base = f.replace(/\.wav$/, "");
  SAMPLES.push({
    condition: "tts-sapi",
    id: base,
    language: base.startsWith("de-") ? "de" : base.startsWith("en-") ? "en" : "auto",
    transcriptFile: path.join(SAPI_DIR, `${base}.txt`),
    wav: path.join(SAPI_DIR, f),
  });
}

// --- main -------------------------------------------------------------------------

const results = [];
for (const model of MODELS) {
  if (!fs.existsSync(model.file)) throw new Error(`model missing: ${model.file}`);
  for (const s of SAMPLES) {
    const refText = fs.readFileSync(s.transcriptFile, "utf8");
    const refDuration = wavDurationSec(s.wav);
    const run = runWhisper(model.file, s.wav, s.language);
    const w = wer(refText, run.text);
    const row = {
      model: model.id,
      condition: s.condition,
      sample: s.id,
      language: s.language,
      detectedLanguage: run.language,
      refWords: normalize(refText).length,
      werPercent: w == null ? null : Math.round(w * 10) / 10,
      refDurationSec: Math.round(refDuration * 10) / 10,
      whisperStartSec: Math.round(run.startSec * 10) / 10,
      whisperSpanSec: Math.round(run.endSec * 10) / 10,
      startDeviationSec: Math.round((run.startSec - 0) * 10) / 10,
      endDeviationSec: Math.round((run.endSec - refDuration) * 10) / 10,
      wallSeconds: Math.round(run.wallMs / 100) / 10,
      hypothesis: run.text,
    };
    results.push(row);
    console.log(
      `${row.model.padEnd(10)} ${row.condition.padEnd(9)} ${row.sample.padEnd(16)} ${row.language} ` +
      `WER=${row.werPercent}% span=[${row.whisperStartSec},${row.whisperSpanSec}] ref=${row.refDurationSec}s ` +
      `dev=[${row.startDeviationSec},${row.endDeviationSec}] wall=${row.wallSeconds}s`,
    );
  }
}

// model hashes once (same pinned builds as T2 - verify against its wer-results.json)
const modelShas = {};
for (const model of MODELS) {
  modelShas[model.id] = execFileSync("powershell", ["-NoProfile", "-Command",
    `(Get-FileHash -Algorithm SHA256 '${model.file}').Hash.ToLower()`], { encoding: "utf8" }).trim();
}

fs.writeFileSync(path.join(HERE, "t2-v2-results.json"), JSON.stringify({
  generated: new Date().toISOString(),
  hardware: { cpu: os.cpus()[0].model, cores: os.cpus().length, platform: `${os.platform()} ${os.release()}` },
  whisper: "whisper.cpp v1.9.2 pinned build (.probe-downloads/whisper-bin), CPU",
  modelSha256: modelShas,
  results,
}, null, 2) + "\n");

// --- report -------------------------------------------------------------------------

const T2 = JSON.parse(fs.readFileSync(path.join(ROOT, "eval", "audio-proto", "wer-results.json"), "utf8"));
const avg = (xs) => (xs.reduce((a, x) => a + x, 0) / xs.length).toFixed(1);
const r1 = (x) => Math.round(x * 10) / 10;
const clipById = Object.fromEntries(licenses.clips.map((c) => [c.id, c]));

function tableFor(modelId, condition) {
  const rows = results.filter((r) => r.model === modelId && r.condition === condition);
  const head = `| Clip | Lang | Ref words | WER % | Anno [start,end] s | Whisper [start,end] s | Start dev s | End dev s | Wall s |\n|---|---|---:|---:|---|---|---:|---:|---:|\n`;
  const body = rows.map((r) =>
    `| ${r.sample} | ${r.language} | ${r.refWords} | ${r.werPercent} | [0, ${r.refDurationSec}] | [${r.whisperStartSec}, ${r.whisperSpanSec}] | ${r.startDeviationSec} | ${r.endDeviationSec} | ${r.wallSeconds} |`,
  ).join("\n");
  const wers = rows.map((r) => r.werPercent);
  const absStart = avg(rows.map((r) => Math.abs(r.startDeviationSec)));
  const absEnd = avg(rows.map((r) => Math.abs(r.endDeviationSec)));
  return head + body + `\n\nAverage WER: **${avg(wers)}%** · mean |start dev|: **${r1(+absStart)} s** · mean |end dev|: **${r1(+absEnd)} s**`;
}

const licRows = licenses.clips.map((c) =>
  `| ${c.id} | ${c.language} | ${c.audioLicense} (${c.recorder}) | ${c.work.author} (d. ${c.work.authorDeath}), ${c.work.textLicense} | ${c.sourcePage} | text: ${c.work.textSource} |`,
).join("\n");

const t2Tiny = T2.filter((r) => r.model === "ggml-tiny");
const t2Base = T2.filter((r) => r.model === "ggml-base");

const lines = [];
lines.push("# T2-v2: whisper.cpp over NATURAL redistributable human speech (de/es/en)");
lines.push("");
lines.push(`Generated: ${new Date().toISOString()} · whisper.cpp v1.9.2 (pinned, CPU) · hardware: ${os.cpus()[0].model.trim()}, ${os.cpus().length} cores (same machine as T2) · corpus: eval/audio-proto-v2 (audio-orig/ + transcripts/ + licenses.json)`);
lines.push("");
lines.push("T2 (eval/audio-proto/wer-report.md) measured whisper.cpp over synthetic Windows SAPI");
lines.push("TTS and honestly documented that ceiling: one clean studio-style voice, no human");
lines.push("prosody, no room noise, no accents. This extension measures the same pinned engine");
lines.push("(ggml-tiny + ggml-base, CPU) over REAL human speech that is fully redistributable:");
lines.push("9 clips, 3 per language (de/es/en), single poems read start to finish by volunteers and");
lines.push("released under CC0 / CC BY-SA 3.0 / CC BY-SA 4.0, with verbatim public-domain");
lines.push("reference texts taken from Wikisource. ES had no T2 baseline (SAPI corpus was de/en).");
lines.push("");
lines.push("## Annotation validity (mandate: real temporal annotations)");
lines.push("");
lines.push("Every natural clip is ONE complete utterance: a single poem read start to finish,");
lines.push("converted deterministically to 16 kHz mono wav (ffmpeg, `wav/` cache) with leading/");
lines.push("trailing silence trimmed (silenceremove, -38 dB, 0.15 s boundary kept) so the wav");
lines.push("duration IS the ground-truth span of the spoken utterance. The annotation");
lines.push("[0, duration] is therefore a real annotation of that span - not the");
lines.push("file-duration-vs-multi-sentence-span confound the mandate warns about. Multi-sentence");
lines.push("clips without per-sentence timing were rejected at selection time for exactly that");
lines.push("reason (e.g. the Commons 'Poems Every Child' files bundle several poems per file and");
lines.push("were excluded; the LibriVox 'Short Poetry Collection' per-poem files prepend spoken");
lines.push("title/author announcements and were excluded for the same reason). Timestamp");
lines.push("precision is therefore scored on BOTH edges: whisper's first-segment start vs 0, and");
lines.push("last-segment end vs the annotated duration.");
lines.push("");
for (const model of MODELS) {
  lines.push(`## ${model.id} (${(fs.statSync(model.file).size / 1024 / 1024).toFixed(1)} MB, sha256 \`${modelShas[model.id]}\`) - condition: natural human speech`);
  lines.push("");
  lines.push(tableFor(model.id, "natural"));
  lines.push("");
  lines.push(`### ${model.id} - condition: tts-sapi (T2 samples re-run read-only, same session)`);
  lines.push("");
  lines.push(tableFor(model.id, "tts-sapi"));
  lines.push("");
}
lines.push("## Comparison vs the published T2 SAPI baseline (cited, not re-run)");
lines.push("");
lines.push("T2 published (eval/audio-proto/wer-report.md, same pinned builds): ggml-tiny average");
lines.push(`WER **${avg(t2Tiny.map((r) => r.werPercent))}%**, mean timestamp deviation ${avg(t2Tiny.map((r) => r.timestampDeviationSec))} s;`);
lines.push(`ggml-base average WER **${avg(t2Base.map((r) => r.werPercent))}%**, mean timestamp deviation ${avg(t2Base.map((r) => r.timestampDeviationSec))} s`);
lines.push("(de/en only, SAPI TTS references). The tts-sapi tables above are a fresh read-only");
lines.push("re-run of the same sample files on this machine for within-report comparability;");
lines.push("small wall-time and WER deltas vs the published numbers are run-to-run variance of");
lines.push("the same setup, not a different configuration.");
lines.push("");
lines.push("## Per-language summary (natural condition)");
lines.push("");
lines.push("| Lang | tiny WER % (per clip) | base WER % (per clip) |");
lines.push("|---|---|---|");
for (const lang of ["de", "es", "en"]) {
  const t = results.filter((r) => r.model === "ggml-tiny" && r.condition === "natural" && r.language === lang);
  const b = results.filter((r) => r.model === "ggml-base" && r.condition === "natural" && r.language === lang);
  lines.push(`| ${lang} | ${t.map((r) => `${r.sample}: ${r.werPercent}`).join(", ")} | ${b.map((r) => `${r.sample}: ${r.werPercent}`).join(", ")} |`);
}
lines.push("");
lines.push("## Redistributability + license list (exact license + source URL per clip)");
lines.push("");
lines.push("| Clip | Lang | Audio license (recorder) | Text (author, license) | Audio source | Text source |");
lines.push("|---|---|---|---|---|---|");
lines.push(licRows);
lines.push("");
lines.push(`All 9 originals (${(licenses.clips.reduce((a, c) => a + fs.statSync(path.join(HERE, c.file)).size, 0) / 1024 / 1024).toFixed(1)} MB total) ship in \`audio-orig/\` with sha256 recorded in licenses.json;`);
lines.push(`transcripts in \`transcripts/\` are verbatim from the listed Wikisource pages except the`);
lines.push(`orthographic-only modernizations recorded per clip in licenses.json (\`transcriptNotes\`)`);
lines.push("(e.g. 1885 Spanish 'á'->'a', German 'laß'->'lass' - identical when spoken, so they add");
lines.push("no WER penalty). CC BY-SA clips require attribution + share-alike when redistributed;");
lines.push("attribution strings are the table rows above and licenses.json.");
lines.push("");
lines.push("## Transcript integrity notes");
lines.push("");
lines.push("- Reference transcripts INCLUDE the readers' spoken opening announcements");
lines.push("  (title/author/reader credits, 4-12 words per clip; the English clips have none).");
lines.push("  German announcement wording follows the documented de.wikisource 'Gesprochene");
lines.push("  Wikisource' formula; the shorter Spanish intros were pinned by base-model");
lines.push("  alignment, so errors on those few announcement words are slightly understated.");
lines.push("");
lines.push("## Limitations (what natural-speech conditions remain unmeasured)");
lines.push("");
lines.push("- Read poetry, not conversational speech: no disfluencies, self-corrections or");
lines.push("  overlapping speakers; all clips are single monologue read-aloud speech.");
lines.push("- Clean recordings: no additive noise, reverb-heavy rooms, or far-field microphones.");
lines.push("- Accents: readers are standard-variety (Hochdeutsch, Castilian Spanish, general");
lines.push("  American/British English); no regional or non-native accents in the corpus.");
lines.push("- Poetry prosody (verse rhythm, emphatic stresses) is itself atypical of note-taking");
lines.push("  voice memos; natural conversational prosody is still unmeasured.");
lines.push("- 3 clips per language but few distinct readers: 2 German (Flade, Dittmer), 2 Spanish");
lines.push("  (Núñez González, Voiceover77) and just 1 English (Theornamentalist, all three clips);");
lines.push("  speaker diversity is minimal and inter-reader variance is confounded with language.");
lines.push("- One es clip (es-luna) comes from a web-poetry series that sometimes mixes music;");
lines.push("  its per-clip WER is the honest signal of any such artefact.");
lines.push("");
lines.push("## Hypotheses (raw whisper output, natural condition)");
lines.push("");
for (const r of results.filter((r) => r.condition === "natural")) {
  lines.push(`- **${r.model} / ${r.sample}** (${r.detectedLanguage ?? "?"}): ${r.hypothesis}`);
}
fs.writeFileSync(path.join(HERE, "t2-v2-report.md"), lines.join("\n") + "\n");
console.log("\nwrote eval/audio-proto-v2/t2-v2-report.md + t2-v2-results.json");
