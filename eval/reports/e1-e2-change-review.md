# E1 + E2 — Anchor safety and change-review quality (version-pairs-v1)

Executed 2026-09-29 against `main`. Implements §10 rows E1/E2 of
`docs/specs/open-source-innovation-strategy.md` (criteria: E1 zero citations
that silently open another version or an invented location; E2 material-warning
precision ≥ 90 %, recall ≥ 80 %, deterministic propagation correct on ALL
fixtures). Fixtures are the corpus's own; the PI-2 reserved question set
(`docs/specs/pageindex-integration-plan.md` — decision was "do not adopt
PageIndex") is deliberately not reused.

All runs use the real services: `recordVersion` (real pdf-parse page extraction
of the generated PDFs, sidecars under `files/versions/`, `{unchanged}` dedupe),
`createClaim` + anchors with pages from the v1 sidecars, `scanForStaleness`
(triggered by the v2 `recordVersion` import itself), `resolveReview`
(accept/reject), and `evidence.open` through `handleEngineRequest`.

## 1. Corpus: eval/corpus/version-pairs-v1/

20 deterministic PDF version pairs, 5 per category (the strategy table fixes
"20 pairs"; "4 each" in the execution order is read as a minimum: 4 categories
× 5 = 20).

| Category | v2 change | Expected proposal |
| --- | --- | --- |
| material-change | a fact sentence is rewritten (value `42→57`, `13.5→11.2`, `128→164`; or station name `Elbingen→Altmoor`, `Bärenbach→Steinach`), same page | `quote_missing` |
| moved | wording identical; an "Inserted Annex" page before section 3 reflows the claim one page down | `quote_moved` |
| deleted | fact sentence absent in v2, layout otherwise identical | `quote_missing` |
| format-only | fact sentences byte-identical; only heading case (ALL CAPS), trailing `.`→`!` in intro lines and a doubled space in filler text differ — outside every quoted sentence | none (must NOT trigger) |

Each document: title page + 3 sections, 4–7 pages in v1 (4–8 in v2), 3 known
fact sentences (claims A/B/C) placed as the first sentence of their section's
first paragraph, so every claim page is known by construction. Per pair the
generator emits `vpXX-<category>.v1.pdf/.v1.json/.v2.pdf/.v2.json` plus the
top-level `manifest.json`: per pair `{pairId, category, topic, v1File, v2File,
v1Pages, v2Pages, claims: [{quote, v1Page, v2Expected: page|'moved'|'missing',
v2Page?}], expectedProposals: [{quote, reason}]}`. (`v2Expected: null` is
reserved in the schema but never needed here.)

- Generator: `eval/corpus/version-pairs-v1/generate-version-pairs.mjs` — fixed
  literal tables, pinned PDF metadata dates, explicit page breaks, post-build
  page-count assertion. **Deterministic: two consecutive runs are byte-identical
  (82 files, sha256-compared).**
- Validator: `eval/corpus/version-pairs-v1/validate-version-pairs.mjs` —
  re-extracts every PDF with pdf-parse (the same engine `recordVersion` uses)
  and searches all 60 claims with the same normalization as `findQuotePage`
  (replicated 1:1: whitespace collapsed, lowercase). Checks quote-on-page for
  v1 and the per-category v2 expectation (absent / moved to the exact page /
  still found at the exact page) plus manifest consistency. Output: `ALL
  CHECKS PASSED` (60 claims checked).

## 2. E2: change-review quality

The fixture-driven suite runs the real `scanForStaleness` over all 20 pairs
(v2 import via `recordVersion` triggers the scan; claims seeded against v1
with pages from the v1 sidecars) and asserts the per-pair outcome exactly.

**Result: 20/20 pairs exact, 20/20 deterministic.**

Confusion matrix over all 60 claims (proposal = positive):

| | expected | not expected |
| --- | --- | --- |
| proposed | TP = 15 | FP = 0 |
| not proposed | FN = 0 | TN = 45 |

- Precision = 15/15 = **100 %** (criterion ≥ 90 % — met)
- Recall = 15/15 = **100 %** (criterion ≥ 80 % — met)

Per-pair table (expected vs got; every row ok):

| Pair | Category | Expected | Got | ok |
| --- | --- | --- | --- | --- |
| vp01-material-change | material-change | quote_missing | quote_missing | ok |
| vp02-material-change | material-change | quote_missing | quote_missing | ok |
| vp03-material-change | material-change | quote_missing | quote_missing | ok |
| vp04-material-change | material-change | quote_missing | quote_missing | ok |
| vp05-material-change | material-change | quote_missing | quote_missing | ok |
| vp06-moved | moved | quote_moved | quote_moved | ok |
| vp07-moved | moved | quote_moved | quote_moved | ok |
| vp08-moved | moved | quote_moved | quote_moved | ok |
| vp09-moved | moved | quote_moved | quote_moved | ok |
| vp10-moved | moved | quote_moved | quote_moved | ok |
| vp11-deleted | deleted | quote_missing | quote_missing | ok |
| vp12-deleted | deleted | quote_missing | quote_missing | ok |
| vp13-deleted | deleted | quote_missing | quote_missing | ok |
| vp14-deleted | deleted | quote_missing | quote_missing | ok |
| vp15-deleted | deleted | quote_missing | quote_missing | ok |
| vp16-format-only | format-only | none | none | ok |
| vp17-format-only | format-only | none | none | ok |
| vp18-format-only | format-only | none | none | ok |
| vp19-format-only | format-only | none | none | ok |
| vp20-format-only | format-only | none | none | ok |

Full machine-readable output incl. reasons: `eval/reports/e1-e2-run.json`
(written by the grading test on each green run).

Accept/reject roundtrip on the 4 roundtrip pairs (one per category, listed in
`manifest.roundtripPairs`: vp01, vp06, vp11, vp16) — both decisions per pair
(reject on source A, accept on source B of the same pair):

- **reject**: proposal row keeps `fromVersion=1, toVersion=2`, verbatim note
  and `resolvedAt`; anchor stays on v1 bytes (`version=1`, v1 page); claim
  stays `active`.
- **accept**: proposal row keeps from/to + note + `resolvedAt` (history of the
  move survives); claim becomes `reviewed`.
  - moved (vp06): anchor re-anchored to the v2 row with the page the quote
    really sits on in the v2 sidecar (manifest `v2Page`, p4→p5).
  - material-change (vp01) and deleted (vp11): the old quote is absent in v2,
    so accept does NOT invent a page — the anchor stays resolvable on the v1
    bytes.
  - format-only (vp16): nothing to decide — zero proposals, anchors untouched.

## 3. E1: anchor safety

Walkthrough (asserted in the suite, not a manual claim):

1. Import v1 PDF (real pdf-parse extraction) → claims seeded with anchors that
   carry the v1 sidecar page.
2. Import v2 (material change, moved, deleted or format-only) → the anchors are
   NOT moved by the scan; they still point at the v1 version row.
3. `evidence.open` on an anchor after the v2 import returns the **v1** storage
   id and the on-disk v1 path — no silent switch to the new version, no
   invented page (page = the v1 page, quote = the saved quote).
4. Re-anchoring happens only on an explicit human accept, and only when
   `findQuotePage` really finds the quote in the confirmed version's sidecar;
   otherwise the anchor stays on the old bytes (no invented page, honest
   unresolvable state).

E1 assertions in the suite (test names):

- `E1 anchor safety (fixture corpus version-pairs-v1) > format-only pairs: zero proposals and untouched anchors after importing v2`
- `E1 anchor safety (fixture corpus version-pairs-v1) > after importing v2, anchors still open the v1 bytes via evidence.open (no silent version switch)`
- `E1 anchor safety (fixture corpus version-pairs-v1) > accept re-anchors to the confirmed version only when the quote is really found there`

Plus, across all 20 propagation tests: after the v2 import every anchor still
carries `sourceVersionId = v1`, `version = 1` and the original v1 page — no
page invention anywhere in the corpus.

**E1 criterion met: zero citations open another version silently or an
invented location; unresolvable references stay resolvable on the old bytes or
are reported honestly (quote_missing accept keeps the v1 anchor).**

## 4. Limitations

- **Synthetic quotes.** All 60 claims are generated fact sentences with clean
  wording; real-world formatting variance (ligatures, hyphenation across line
  breaks, OCR text, tables, two-column layouts, RTL) is NOT covered. The
  normalizer only collapses whitespace and lowercases — a punctuation change
  INSIDE a quoted span would fire `quote_missing` (a known, honest-but-coarse
  behavior); the format-only fixtures therefore vary punctuation only outside
  quoted spans, and the corpus says so explicitly.
- **Reason vocabulary is coarse.** `material-change` and `deleted` both surface
  as `quote_missing`: the scan proves "the data you used changed" (5B, the
  deterministic half) but does not claim the conclusion is false — semantic
  distinction is left to the human reviewer, as the strategy requires.
- Single-file PDFs, Latin script, one claim style; page moves are modeled as
  an inserted page before a section, not organic multi-column reflow.
- 100 %/100 % on this corpus says the deterministic propagation is correct on
  these fixtures — it does not predict precision on messy real documents.

## 5. Reproduce

```bash
# 1. regenerate the corpus (deterministic; run twice + sha256-compare to verify)
node eval/corpus/version-pairs-v1/generate-version-pairs.mjs

# 2. validate manifest expectations against the generated PDFs
node eval/corpus/version-pairs-v1/validate-version-pairs.mjs

# 3. fixture tests: 20/20 deterministic propagation + E1 asserts + grading
#    (writes eval/reports/e1-e2-run.json on green)
npx vitest run src/__tests__/change-review.test.ts

# determinism spot-check (optional)
cd eval/corpus/version-pairs-v1 && sha256sum *.pdf *.json | sort > /tmp/h1 \
  && node generate-version-pairs.mjs >/dev/null \
  && sha256sum *.pdf *.json | sort > /tmp/h2 && diff /tmp/h1 /tmp/h2 && echo deterministic
```

Results from the run this report documents: 35/35 tests green (6 legacy +
29 new), validator `ALL CHECKS PASSED` (60 claims), generator byte-identical
across runs, precision 100 %, recall 100 %, 20/20 exact per-pair outcomes.
