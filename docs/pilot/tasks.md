# E3 pilot — task sheet and metrics

Companion to [e3-pilot.md](e3-pilot.md). Eight tasks, each with success
criteria, the metric it carries, and the **implementation basis** it relies on.
No task exercises a PENDIENTE feature (ARCHITECTURE.md).

Every task is given to the participant as a **goal**, spoken roughly as written,
never as click-by-click instructions. The moderator hands over the artifact
(sample file, second file, USB stick) exactly when the task text says so.

## Unaided rule (used for every task)

- **Unaided** — participant completes the task after the goal statement, with no
  hint beyond what the app shows. Questions back to the moderator ("where is…?")
  get the scripted neutral answer "I can't show you — what would you try?".
- **Assistance boundary** — moderator intervenes only when the participant asks
  to stop, or is stalled with no interaction for 2 minutes, or is about to
  abandon. Any intervention marks the task `assisted` and is quoted in the
  observation sheet.
- Outcomes: `unaided` / `assisted` / `failed` / `blocked (setup)` (setup
  dependency could not be established in session; counts in the denominator).

---

## T1 — Import a document

**Goal to participant:** "Bring this document into your notebook so you can work
with it." (Hand over the bundled sample PDF, *Kaffee-Studie v1*.)

**Steps expected (not read out):** file import into the open notebook; wait for
processing to complete.

**Success criteria**
- The source appears in *Quellen* with status completed (not stuck
  pending/processing/error).
- The participant can say what the source is called and that it finished.

**Metrics:** unaided success; time to completed import; processing-state
confusion (e.g. waiting without progress signal).

**Implementation basis:** `sources.importFile` → processing job → chunks; part
of the `installed walkthrough` gate (PROBADO DESDE INSTALADOR).
`src/__tests__/engine-pool.test.ts`, `src/__tests__/source-reimport.test.ts`.

## T2 — Ask a question

**Goal:** "Find out from this document: what did the study measure? Ask the app
in your own words."

**Precondition:** provider configured in setup (local model or participant's own
remote key — which one is recorded and feeds T8). If chat cannot be made to
work: record `blocked (setup)`, continue with T4 via the manual claim path.

**Success criteria**
- An answer appears.
- The participant can point at the citations under the answer.

**Metrics:** unaided success; time from submit to first answer; whether the
answer's language followed the question.

**Implementation basis:** `chat.send` with citations stamped at retrieval time —
IMPLEMENTADO (unit/e2e: `src/__tests__/chat-evidence.test.ts`,
`src/__tests__/claims.test.ts`). The successful-answer path is *not*
installer-gated (the installer gate asserts the typed `no_provider` path), which
is why the provider setup in the session script is a pre-flight item, not an
assumption.

## T3 — Follow a citation to the evidence (primary time-to-evidence task)

**Goal:** "Open exactly the passage the answer is based on, in the original
document."

**Success criteria**
- The reader opens the source; the participant locates the quoted passage
  (quote + locator shown; page only when truly known).
- The participant can state which version of the document they are looking at
  if asked "is this the newest version?" — the honest answer may be "I don't
  know how to tell", which is recorded as a finding, not a failure of protocol.

**Metrics:** **time-to-evidence** = from the citation chip becoming visible
(end of T2 or of a fresh question) to the quoted passage open in the reader.
Also: whether they used the chip or hunted manually.

**Implementation basis:** citation chips → reader with version + locator;
in-app evidence reader IMPLEMENTADO (manual click-through verified during
pre-flight, §6 of the plan). `evidence.open` op returns fileName/page/quote —
PROBADO DESDE INSTALADOR via the smoke claims flow (fabricated anchor answers
typed `not_found`).

## T4 — Save a claim with evidence

**Goal:** "Keep a statement you trust from that answer — so that tomorrow you
can still see which passage it came from."

**Path:** from the chat message (saved claim with anchors) or a manually
created claim in *Aussagen* with an anchor to a source. Either path counts;
record which they used.

**Success criteria**
- A claim exists in *Aussagen* with at least one anchor (file, version, quote
  visible).
- The participant can open the anchor's evidence from the claim (this may reuse
  the T3 mechanic; time is not re-measured unless it is a fresh lookup).

**Metrics:** unaided success; anchor-or-not (a claim saved with no working
anchor is `assisted` at best — the claim list shows `Referenz nicht aufloesbar`
for unresolvable references, which is itself a valid observation to record).

**Implementation basis:** `claims.createFromMessage` / `claims.create` with
anchors — PROBADO DESDE INSTALADOR (claims roundtrip in the smoke gate);
unit-tested in `src/__tests__/claims.test.ts`.

## T5 — Trigger a version update and resolve the proposal

**Goal:** "The authors published a corrected version of that study. Bring the
new version in — then deal with whatever the app tells you." (Hand over the
*same* sample as `v2`, or re-import the same URL after the moderator's staged
change for URL imports.)

**Success criteria**
- The re-import **appends a new version** (v2 appears; v1 still openable) — the
  participant must not experience it as replacement or data loss.
- The staleness proposal on the anchored claim is visible and readable: which
  claim, what changed (`quote_moved` to a new page, or `quote_missing`).
- The participant decides (accept or reject) and can say afterwards what their
  decision did to the claim and what the old version looked like. Accepting a
  `quote_missing` must end in the claim being marked reviewed with the anchor
  still on the old bytes; accepting a `quote_moved` re-anchors.

**Metrics:** unaided success; **version errors** counted: quoting v1 while
meaning v2, reading the proposal as "your conclusion is false", not noticing v1
still exists, treating the decision as irreversible data loss.

**Implementation basis:** `sources.reimportVersion` appends v2 + raises the
deterministic proposal; `review.list` / `review.resolve` — PROBADO DESDE
INSTALADOR (`installed walkthrough` gate asserts the full
re-import → proposal → resolution path). `src/__tests__/change-review.test.ts`,
`src/__tests__/source-reimport.test.ts`.

## T6 — Run a calculation on a CSV

**Goal:** "Here is a data sheet. Get one trustworthy number out of it: the sum
(or average) of a column." (Hand over a small CSV the moderator prepared — a
file with one numeric column, one text column, and one empty cell.)

**Success criteria**
- The CSV imports as a source.
- A calculation result is produced for the chosen op + column.
- The participant can see which version of the data produced the result
  (the calculation row records input version + query).

**Metrics:** unaided success; whether the empty cell's behavior (numeric ops
block / `count` skips) surfaces as a readable message or as silent confusion —
ambiguity blocking is intended behavior (E4 v1).

**Implementation basis:** csv import pipeline → sheet sidecar →
`calculations.run` — PROBADO DESDE INSTALADOR (the walkthrough gate includes
CSV import + deterministic sum). `src/__tests__/calculations.test.ts`.

## T7 — Export a package and open it elsewhere

**Goal:** "Pack up this notebook and give it to a colleague — then check it
opens on a second machine." (Second machine or a prepared second Windows
account/install; a fresh data dir is the minimum.)

**Success criteria**
- Export produces a package file; the participant could plausibly send it.
- Import into the fresh installation preserves: sources/versions, the claim
  with its anchor (opening the evidence works), the pending/decided proposal
  history, and the calculation.
- The participant can name at least one thing that survived the trip and one
  thing the export preview told them about what is included.

**Metrics:** unaided success; time; "roundtrip trust" observation — do they
verify anything, or trust the success state?

**Implementation basis:** `notebook.export` / `notebook.import`, formatVersion 2
with staged-atomic restore — PROBADO DESDE INSTALADOR (walkthrough gate asserts
export/import round trip into a fresh data dir).
`src/__tests__/notebook-transfer.test.ts`.

## T8 — Local vs remote comprehension quiz

Asked at the end (§5 of the plan), from memory of what they saw; answers are the
participant's words, scored against the observation sheet key.

**Setup recorded at start of session:** which provider the participant chose
(local / remote / offline attempt), and where the app showed it.

**Three questions**
1. "When you asked your question in T2, where do you believe the text of your
   question and the document were processed — on this laptop, or on a company's
   server?" (Accept "I saw it said X" with the label quoted.)
2. "If you had turned on offline mode, what would have happened to a question?"
   (Key point: remote calls blocked at call time, local still works; typing the
   `no_provider` answer without a local model is the observed behavior.)
3. "You exported your notebook in T7. What left this computer when you shared
   the package?" (Key point: quotes/extracted text are content too; originals
   were included/excluded per the export choice.)

**Scoring:** 0–3, one point per question answered without a misconception that
the observation sheet's key lists. Misconceptions are recorded verbatim — they
are design input regardless of score.

**Implementation basis:** `chat.send` provider payload (label "Auf diesem
Computer" / remote label), offline call-time blocking, egress disclosure chips,
export preview with inclusion/exclusion note — IMPLEMENTADO with installer-level
pieces (offline probe + keyring channel in the smoke gate).
`src/__tests__/providers.test.ts`, `src/__tests__/notebook-transfer.test.ts`.

---

## Metric roll-up (observer fills one column per task)

| # | Task | Carried metric |
| --- | --- | --- |
| T1 | Import document | unaided success, time to completed |
| T2 | Ask a question | unaided success, time to answer |
| T3 | Follow citation | **time-to-evidence** (primary) |
| T4 | Save claim | unaided success, anchor status |
| T5 | Version update + proposal | unaided success, **version errors** |
| T6 | CSV calculation | unaided success, ambiguity-message readability |
| T7 | Export + re-import | unaided success, roundtrip trust |
| T8 | Comprehension quiz | score 0–3 + verbatim misconceptions |

Plus session-level: SUS (10 items) and the problem list with severities —
all on [observation-template.md](observation-template.md).
