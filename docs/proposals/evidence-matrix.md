# Evidence matrix — capacity contract

> **Status: CONTRACT PROPOSAL — NOT IMPLEMENTED.** Nothing in this document
> exists in the code yet; the only implemented artifacts it references are the
> existing claims/anchors/review machinery it is grounded in (read-only):
> `src/lib/services/claims.ts`, `src/lib/services/change-review.ts`,
> `src/engine/dispatch.ts` (op pattern, `evidence.open`),
> `src/db/local/schema.ts` (`evidenceLinks.relation: "supports" | "questions"`).
> Origin: the differential-capacity item (mandate §5) and the demonstration
> scenario in [open-source-innovation-strategy.md §4](../specs/open-source-innovation-strategy.md)
> ("Dos fuentes discrepan…"), spelled out as a product capability in
> [product-ux-design-research.md §4.C](../specs/product-ux-design-research.md)
> ("Matriz de evidencia"). This doc turns that into a contract precise enough
> to implement without further design work.

## 1. The capacity

A **differential view over selected sources**: rows are claims (later also
research questions), columns are sources the user picked. Each cell answers
one question only — *what is the recorded relationship between this statement
and this source?* — with one of four statuses. The matrix makes comparison
work visible instead of hiding it in per-claim panels.

What it is **not**: a truth engine. A cell never asserts that a claim is true,
false, or "covered". The model may not grant itself a verified label
(strategy §5A); the matrix inherits that rule structurally: every cell value
is derived from **real recorded links** (anchors, proposals, searches that
actually ran), never from inference over document content.

## 2. Cell statuses and their exact semantics

| Status | Meaning | Is NOT |
| --- | --- | --- |
| `evidence_linked` | The claim has ≥1 anchor pointing to an immutable version of this source (`evidence_anchors` + `evidence_links` rows exist). | Not a statement that the source *supports* the claim — the anchor's `relation` (`supports` / `questions`) is carried in the cell, not collapsed into the status. |
| `proposal` | A review proposal exists for this claim × source (`review_proposals` row: `quote_moved` / `quote_missing`, pending or decided). Something in this source changed under an anchored quote. | Not a verdict that the claim is now false. A changed source does not make a conclusion false — it flags changed inputs. Decided proposals (`accepted`/`rejected` + `note`) are shown with their decision, never overwritten. |
| `not_found_in_search` | A **performed search** ran against this source for this claim/question and returned nothing: the cell carries the search provenance (what was queried, with which index state, when). **"Not found in the performed search" is not the absence of evidence** — it is a fact about one search, bounded by query wording, source selection, index version and model. | Not "this source contains nothing relevant", and not a license to claim a gap. Regenerating with a different query/index can legitimately flip the cell. |
| `not_reviewed` | No recorded relationship: no anchor, no proposal, and no performed search. The honest default. | Not "nothing there" and not "checked, found nothing" — nothing happened for this pair yet. |

Two global rules the UI must enforce in copy as well as logic:

1. **not-found ≠ absence of evidence.** `not_found_in_search` renders with its
   provenance one click away; the empty-sounding status never renders as a bare
   red "nothing".
2. **A changed source does not make a conclusion false.** `proposal` cells link
   to the v1/v2 comparison and the decision history; acceptance/rejection keeps
   the full history (`fromVersion`/`toVersion`, `note`, `resolvedAt` survive on
   the proposal row).

## 3. Data shapes

Everything is derived from existing tables; **no new persistence is required
for the read path**. Shapes reuse what `claims.ts` / `change-review.ts` already
return (`ClaimView`, `ClaimAnchorView`, `ReviewProposalView`).

```ts
// src/lib/services/evidence-matrix.ts (proposed)

export type MatrixCellStatus =
  | "evidence_linked"
  | "proposal"
  | "not_found_in_search"
  | "not_reviewed";

export interface MatrixCellAnchor {
  anchorId: string;            // -> evidence.open
  relation: AnchorRelation;    // "supports" | "questions" — never collapsed
  sourceVersionId: string;
  version: number;             // sourceVersions.version
  page: number | null;         // locator when truly known, else null
  locator: TimeRangeLocator | null;
  quote: string;
}

export interface MatrixCellProposal {
  proposalId: string;          // -> review history / resolve UI
  reason: "quote_moved" | "quote_missing";
  fromVersion: number;
  toVersion: number;
  status: "pending" | "accepted" | "rejected";
  note: string | null;
  resolvedAt: number | null;
}

/** Reserved for the search-integrated slice; never emitted by slice 1. */
export interface SearchProvenance {
  query: string;
  searchedAt: number;
  retrievalProfileId: string | null;  // which index/recipe produced the miss
  sourceVersionIds: string[];         // what was actually searched
}

export interface MatrixCell {
  claimId: string;
  sourceId: string;
  status: MatrixCellStatus;
  anchors: MatrixCellAnchor[];        // status evidence_linked: >=1
  proposals: MatrixCellProposal[];    // status proposal: >=1 (all, any state)
  searchProvenance: SearchProvenance[]; // status not_found_in_search: >=1
}

export interface MatrixView {
  rows: { claimId: string; text: string; claimStatus: ClaimStatus }[]; // slice 1: claims only
  columns: { sourceId: string; fileName: string | null }[];
  cells: MatrixCell[];
}
```

Derivation is a **pure function over real links**:

- pair has anchors -> `evidence_linked` (proposals still attached if any — a
  pair can be both linked and under proposal; `status` is the strongest signal:
  `proposal` > `evidence_linked` for sorting, both lists always present);
- else pair has proposals -> `proposal`;
- else pair has search provenance -> `not_found_in_search`;
- else -> `not_reviewed`.

The claim×source pair domain comes from the anchor/proposal rows themselves:
a column list is the user's selection intersected with sources that have any
recorded relationship — the matrix never silently adds columns.

## 4. Ops proposal

Follows the existing op pattern (`handleEngineRequest(op, args)`, read ops in
`src/engine/dispatch.ts`).

### `matrix.get` — read-only

```jsonc
// request
{ "op": "matrix.get",
  "args": {
    "notebookId": "uuid",        // required, notebook-scoped like claims.list
    "claimIds":  ["uuid"],      // optional subset; default: all notebook claims
    "sourceIds": ["uuid"]       // optional subset; default: sources with any
                                // recorded anchor/proposal for those claims
  } }

// response (ok) — MatrixView above
// errors: bad_args (no notebookId), typed, like sibling ops
```

Read-only by construction: it only selects. A later `matrix.setRelations` or
search-triggering op is a **separate** write op with its own proposal/decision
— slice 1 has no matrix write path, so the UI cannot corrupt claims or anchors
through it.

## 5. UI sketch (desktop workspace)

The matrix renders in the **center of the DocumentWorkspace** as one of its
views, beside reader/chat/notes — a comparison view, not a new window. Left
navigator keeps Quellen/Notizen/Aussagen/Berechnungen/Materialien (mandate 1);
the inspector on the right shows the selected cell's detail.

```text
┌ Quellen ─┬─ Vergleichsmatrix ────────────────────────────────┬ Inspector ─┐
│ Quellen  │                  │ Kaffee-Studie │ Bericht-URL │  │ Zelle:     │
│ Notizen  │ "Dosierung ist   │ v1/v2 ✓       │ – nicht     │  │ proposal   │
│ Aussagen │  wirksam."       │ proposal ⚠    │  revisado   │  │ quote_moved│
│ Berechn. │  (supports, v1)  │ S.3→S.5       │             │  │ v1→v2      │
│ Material.│                  │ [Entscheiden] │             │  │ S.3 → S.5  │
│          ├──────────────────┴───────────────┴─────────────┤  │            │
│          │ Zeilen: Aussagen ▾   Spalten: Quellen ▾  [+]     │  │ [Zitat     │
│          │ ⚠ „nicht gefunden" heißt nicht „enthält nichts"   │  │  öffnen]   │
└──────────┴───────────────────────────────────────────────────┴────────────┘
```

- **Cell click → `evidence.open`**: an `evidence_linked` or `proposal` cell
  opens the fragment at its recorded version (quote + locator + page when
  known) through the existing op; the reader keeps the anchor's version, never
  jumping to latest. A `proposal` cell offers the v1/v2 comparison and the
  existing resolve flow (`review.resolve`), unchanged.
- Cell status is expressed by text + icon, not color alone; `not_reviewed` and
  `not_found_in_search` are visually distinct and worded distinctly (de:
  „Nicht geprüft" vs. „In der Suche nicht gefunden — Suche ansehen").
- The legend line about not-found semantics stays on the grid; it is part of
  the contract, not a tooltip.
- Narrow windows: the grid scrolls horizontally with sticky row headers
  (first column); no font shrinking (research doc §5 narrow-screen rule).

## 6. Interaction rules

1. **User-selected relations first.** The user picks rows (claims), columns
   (sources), and sees what is recorded. The first version adds nothing by
   itself — no automatic extraction, no auto-interpretation of what a quote
   change "means".
2. **Automatic interpretation, when it arrives, is optional and revisable.**
   Any system-proposed signal (e.g. "these two cells disagree about dosage")
   enters as a *suggestion attached to cells*, separately marked, dismissible,
   and revisable — never merged into cell status. Cell status remains derived
   only from recorded links and searches.
3. **Writes go through the seams that already exist.** Relations are created by
   claiming with anchors (`claims.create`/`createFromMessage`) and changed by
   the review flow (`review.resolve`). The matrix reads; it does not mutate.
4. **Decisions and history are terminal and visible.** Resolved proposals keep
   `note` + `resolvedAt`; the matrix shows the decision state, never silently
   re-evaluates it (a rescan recreates nothing — already enforced in
   `change-review.ts`).
5. **Scope is the notebook.** Like `claims.list`/`review.list`, `matrix.get` is
   notebook-scoped; no cross-notebook comparison in this contract.

## 7. First slice proposal (implementable without further design)

**Goal:** the comparison view exists, honestly, over data that already exists.
Read-only. No schema migration, no search integration, no new write path.

**Included**

1. `src/lib/services/evidence-matrix.ts` — `buildMatrixView(db, args)`:
   pure derivation per §3 from `listClaims(db, notebookId)`,
   `listPendingReviews(db, notebookId, "all")` (decided proposals included —
   the pair's history), and the sources referenced by those rows. Emits
   `evidence_linked` / `proposal` / `not_reviewed` only; the type carries
   `not_found_in_search` but no code path produces it (no performed search
   exists yet) — emitted **never** is the honest default until a search
   provenance store lands.
2. `src/engine/dispatch.ts` — `case "matrix.get"` following the neighboring
   read ops (`claims.list`, `review.list`): args validation with `bad_args`,
   `getLocalContext()`, returns `MatrixView`.
3. `src/desktop/src/lib/api.ts` — `MatrixView` types + `getMatrix(notebookId)`
   via the existing `call` helper.
4. `src/desktop/src/workspace/MatrixView.tsx` — the center grid per §5: sticky
   first column, text+icon statuses, cell click → existing `evidence.open`
   flow, proposal cells deep-link to the current review UI. Wired as a center
   view from `NotebookWorkspace` (entry: a button in the Aussagen section, so
   the matrix opens with the notebook's claims as rows). German labels.
5. Tests:
   - `src/__tests__/evidence-matrix.test.ts` (new, over a real temp SQLite +
     LocalStore per the repo's seam rules): derivation of all three reachable
     statuses; linked+proposal pair carries both lists; decided proposals keep
     note/resolvedAt; source without any anchor/proposal never becomes a column;
     `not_found_in_search` is never emitted in slice 1.
   - `src/__tests__/engine-dispatch.test.ts` — `matrix.get` happy path +
     `bad_args` without notebookId.
   - CONTEXT.md seam entry added **before** the first test (repo TDD rule),
     e.g. `| evidence matrix | buildMatrixView + "matrix.get" over a real temp
     SQLite | src/__tests__/evidence-matrix.test.ts |`.

**Not in this slice (each is a later increment with its own criteria):**
search integration + `SearchProvenance` store + the `not_found_in_search`
emission path; research-question rows (a `questions` entity does not exist);
matrix-side relation editing; automatic discrepancy suggestions; matrix export.

**Acceptance for the slice:** a notebook with claims anchored to v1 of a
source, after `sources.reimportVersion` to v2, shows the anchored cell as
`evidence_linked` + `proposal` (quote_moved), the untouched claim×source pairs
as `not_reviewed`, clicking the proposal cell opens the v2 reader at the moved
quote, and resolving through the existing flow updates the cell to the decided
state with note and history intact — all asserted by the tests above, plus one
manual click-through of the center view before the installer level is claimed.

**Size:** one new service file (~120 lines), one dispatch case, one new
component, three test files touched/created. No migrations.
