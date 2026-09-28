# eval/corpus/document-trees-v1

PI-0 corpus for the PageIndex evaluation (`docs/specs/pageindex-integration-plan.md`):
21 deterministic synthetic multi-section PDFs (7 en / 7 es / 7 de) plus 80
annotated questions (30 dev / 50 eval). Everything is regenerable from source;
no binary is authoritative.

## Regenerate

```bash
node eval/corpus/document-trees-v1/generate-corpus.mjs
```

Writes one `<docId>.pdf` and one `<docId>.json` sidecar per document plus
`manifest.json`. The generator is deterministic: fixed content literals in
`content-en.mjs` / `content-es.mjs` / `content-de.mjs`, fixed A4 layout,
explicit page break per section, and pinned PDF metadata dates (pdf-lib would
otherwise stamp the wall clock into `CreationDate`/`ModDate`). Only dependency:
`pdf-lib` (devDependency, pure JS, no native code, output reproducible).

## Validate

```bash
node eval/corpus/document-trees-v1/validate-corpus.mjs
```

Extracts per-page text with `pdf-parse` (already a regular dependency) and
fails on any of:

- an `expectedEvidence.quoteSnippet` that does not appear on its claimed page
  (whitespace-normalized match),
- an evidence `section` not listed in the sidecar `sectionTitles` for that page,
- an unanswerable `probeTerm` that appears anywhere in the corpus text,
- manifest / sidecar / questions schema inconsistencies.

Exit code 0 = corpus and annotations agree. Run this after every content edit.

## File roles

| File | Role |
| --- | --- |
| `content-en/es/de.mjs` | source of truth for document content (literals) |
| `generate-corpus.mjs` | deterministic PDF + sidecar + manifest generator |
| `<docId>.pdf` | generated PDF (byte-identical across runs) |
| `<docId>.json` | sidecar: pages, section titles per page, firstWords, toc flag, page labels |
| `manifest.json` | all docs, totals, language counts, generator + pdf-lib version |
| `questions.json` | 80 annotated questions with evidence quotes and probe terms |

## Special cases in the corpus

- 5 documents **without** a table of contents (`no-toc`): en-harbor-registry,
  en-meridian-clinic, es-valle-museo, es-norte-textil,
  de-brandenburg-observatorium — degradation/rejection test.
- `es-delta-citricos`: export table **deliberately split across two pages**
  (`table-split`); `es-norte-textil` also breaks a table across pages naturally.
- 3 documents with **misleading heading structure** (`misleading-headings`):
  en-quarry-heritage, es-sierra-senderismo, de-schwarzwald-kurhaus — a heading
  names one topic, the body text is about another.

## Question schema

```json
{ "id", "subset": "dev|eval", "type", "language", "question", "docIds",
  "expectedEvidence": [{ "docId", "page", "section", "quoteSnippet" }],
  "expectedAnswer", "notes", "probeTerm?" }
```

Types: `exact-fact` (25), `within-doc-xref` (15), `cross-section-comparison`
(10), `cross-document-comparison` (10), `unanswerable` (20; `docIds` empty,
`probeTerm` must stay absent from all extracted text).
The `dev` subset (30) may be used for prompt/pipeline tuning; the `eval`
subset (50) is reserved for scoring — do not tune against it (PI-2 criterion).
