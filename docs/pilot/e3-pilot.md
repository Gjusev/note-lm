# E3 human pilot — plan and materials pack

> **Status: materials only.** No participants have been recruited, no sessions run,
> no data collected. Everything below is a preparation pack for the pilot defined by
> [product-ux-design-research.md §10 U1](../specs/product-ux-design-research.md)
> and the E3 criterion in [open-source-innovation-strategy.md §10](../specs/open-source-innovation-strategy.md)
> (still listed as PENDIENTE in [ARCHITECTURE.md](../../ARCHITECTURE.md)).
> This pack deliberately contains **no fabricated participants, transcripts or numbers**.
> Templates that a session fills in live next to this file:
> [tasks.md](tasks.md) (task sheet + metrics), [consent-template.md](consent-template.md),
> [observation-template.md](observation-template.md).

## 1. What the pilot is for

E3 measures whether a person who has never seen note-lm can carry out the core
research loop on the installed desktop app without help: import a source, ask a
question, trace an answer back to its evidence, save a claim, absorb a changed
source version, run a deterministic calculation, and take their work to another
installation. It also measures whether the local-vs-remote processing labels are
understood, because "processing location is understandable" is a product principle
([PRODUCT.md](../../PRODUCT.md)).

Research questions (descriptive — each answered per participant, not generalized):

- RQ1 Can participants complete the core loop unaided, and where do they stall?
- RQ2 How long does it take from having an answer to having its cited evidence
  open in the reader ("time-to-evidence")?
- RQ3 Do participants correctly understand which processing was local and which
  was remote, from the labels alone?
- RQ4 What errors do participants make around source versions (quoting the old
  version, misreading the proposal, missing the history)?
- RQ5 Which problems would block real use, at what severity?

## 2. Participants

### Profile

- **n = 6–10** sessions. If fewer than 6 complete, report the pilot as
  underpowered and descriptive-only; do not stretch interpretation.
- Mix of **researchers** (technical researchers, analysts) and **advanced
  students** (at least Master's level or writing a thesis). Target roughly half
  and half; record the split.
- **Languages: Spanish, German and English** participants, with the session run
  in the participant's strongest language of the three. The app interface is
  German ([CONTEXT.md](../../CONTEXT.md)); this is itself an observation point —
  record whether non-German speakers are hindered by it, do not translate the UI
  for them.
- **Own Windows laptop optional.** Sessions on the participant's machine are
  preferred (that is the realistic setup path: installer on unfamiliar hardware);
  when the participant has no suitable machine, the session runs on a provided
  Windows laptop and `machine: provided` is recorded. The observation template
  has a field for this; analyses may split on it but must not merge the two
  groups silently.
- Working audio setup (for think-aloud) and, for provided machines, a screen
  large enough for the three-panel workspace at 1440×900 or more.

### Recruitment criteria (screening)

Include only people who: work with documents/sources regularly (papers, reports,
lecture recordings, data sheets); are willing to think aloud for ~90 minutes;
consent to the session terms in [consent-template.md](consent-template.md).

Exclude: team members, contributors, or anyone who has used note-lm before;
anyone who cannot run a ~90 min session.

Do **not** screen on AI familiarity — prior exposure to AI notebooks is an
observed variable, not an exclusion, and it is recorded in the header of the
observation sheet.

## 3. Session logistics

| Item | Value |
| --- | --- |
| Duration | 60–90 min (script §5 is budgeted for 90; 60 is feasible with a prepared local model) |
| Machine | Participant's own Windows laptop (preferred) or a provided one |
| Build | The current signed installer, after the pre-flight checks in §6 |
| Location/data | All app data stays in the app's data dir on that machine. No data is transmitted by the pilot itself |
| Recording | Optional screen recording **saved only on the session machine**, only with consent. Alternative (and fallback): the observer's notes + participant's own notes |
| Moderation | One moderator (runs the script) + one observer (fills the observation sheet) recommended; a single person may do both, recording timestamps live |

## 4. What the participant takes away

Nothing is required of them after the session. If they consented to recording,
the recording stays on the session machine unless they explicitly asked for a
deletion instead; participant-owned written notes belong to the participant.
Contact details for questions or withdrawal are in the consent template.

## 5. Session script (moderator, ~90 min)

Times are targets, not quotas. Never rescue a task before the assistance rule
has fired (see [tasks.md](tasks.md), "unaided" definition).

1. **Welcome and consent (10 min).** Explain the product in one neutral sentence
   ("a local research notebook that keeps sources, claims and their versions
   together"), hand over the consent form, answer questions, start recording if
   agreed. State clearly: we test the software, not the person; there is no
   right way to do anything.
2. **Setup on their machine (15 min).** Participant installs the app from the
   installer themselves. Then, guided: create a notebook, import the bundled
   sample PDF (`Kaffee-Studie v1`) so they have seen one import succeed. Then
   configure a provider for chat (Einstellungen → KI): a local model from the
   catalog, or the participant's own remote key if they prefer — whichever they
   pick is recorded, because it feeds task T8. If chat cannot be made to work in
   session (no model available offline, no key), record T2 as `blocked (setup)`
   — it counts in the denominator as a system failure, per the honest-denominator
   rule in the strategy (§10: extraction/setup errors are system failures).
3. **Think-aloud calibration (2 min).** Have them narrate something trivial
   (e.g. finding the library button).
4. **Tasks T1–T7 in the assigned order (~55 min).** Two orderings alternate
   between participants (A: T1→T7 as listed; B: T7 and T6 moved after T2) to
   damp order effects; task order per participant is recorded. Task text comes
   from [tasks.md](tasks.md), spoken as written — tasks are given as goals, not
   as click instructions.
5. **Comprehension quiz (5 min).** The three local/remote questions (T8), asked
   from the observation sheet, based only on what the participant saw.
6. **SUS questionnaire (5 min).** Paper or on-screen, per the observation sheet.
7. **Wrap-up interview (5 min).** "What was the most confusing moment?", "what
   would you do next with your real documents?", anything they expected that was
   missing. Observer captures verbatim quotes.
8. **Close.** Consent artifacts (signed scan, recording) filed per §4; nothing
   leaves the session machine unless the participant opted into later contact.

## 6. Pre-flight checks (before the first session)

Do not hand out a build that fails these:

- [ ] `npm run verify:desktop` gates pass on the handed-out installer (the
      `installed walkthrough` gate covers exactly the T1/T4/T5/T6/T7 flows).
- [ ] Manual click-through of the workspace reader done on the handed-out
      build: opening a citation chip must open the source reader at the quoted
      passage. ARCHITECTURE.md marks the in-app reader as implemented with
      manual click-through "still pending" — the pilot must not be the first
      click-through.
- [ ] Bundled samples present in the installed app (`Kaffee-Studie v1`/`v2`).
- [ ] For provided machines: model file pre-downloaded or network available for
      `models.download`, decided per session and recorded.
- [ ] Consent forms printed/transferred; observation sheets printed (one per
      participant) from [observation-template.md](observation-template.md).

Features that must **not** appear in tasks (not implemented — ARCHITECTURE.md,
PENDIENTE): PDF page image rendering inside the evidence panel (the reader shows
quote + locator; tasks are worded around that), local TTS, research-question
entities, and any matrix/evidence-comparison UI (that is still only a contract
proposal, see [docs/proposals/evidence-matrix.md](../proposals/evidence-matrix.md)).

## 7. Metrics (summary — definitions in tasks.md)

| Metric | Definition | Where |
| --- | --- | --- |
| Unaided success | Task completed without assistance, per task, binary + `assisted` / `failed` / `blocked (setup)` | per task |
| Time-to-evidence | From the answer/citation being visible to the quoted passage open in the reader | T3 (primary), any task where it occurs |
| Version errors | Quoting/acting on the wrong version, missing the new-version proposal, or misreading `quote_moved`/`quote_missing` semantics | T5, observed anywhere |
| Local/remote comprehension | 3-question quiz, scored 0–3 | T8 |
| Overall usability | SUS, 10 items, standard scoring | end of session |
| Problem severity | Every observed problem classified blocker / major / minor / polish | observation sheet |

## 8. Analysis plan

Descriptive only — the research doc explicitly forbids generalizing from a
sample this small (§10 U1: "resultados descriptivos, sin generalizar por muestra
pequeña").

1. One row per participant per task: outcome (unaided/assisted/failed/blocked),
   time, notable errors, quotes. No averages across tasks without showing the
   per-task spread.
2. Medians and ranges for times (report min–max, never just a mean); SUS per
   participant plus the median; quiz score distribution as a tally.
3. Problems ranked by (severity, frequency): how many of the 6–10 participants
   hit each blocker/major. A problem hit by one participant is still reported
   if severity is blocker — small n means low counts, not low importance.
4. Language split reported as observed difficulties, not as performance claims.
5. Explicitly out of scope for this pilot's write-up: statistical
   significance, "users prefer X", market-size statements, and any claim that a
   strategy §4-style demonstration scenario is *validated* — the pilot observes
   the implemented core loop only.

The write-up goes to `eval/reports/` when it exists (matching how E1/E2 report),
and cites: participant count, session dates, build version, and this pack's
commit. Nothing is published before the participant-consent statement covers it.

## 9. Known deviations from the specs this pack implements

- U1 names "equivalent tasks, alternating order"; because tasks depend on state
  built by earlier tasks (a claim must exist before its proposal can be
  resolved), the pack alternates two fixed orders instead of free
  counterbalancing. Recorded per participant.
- Strategy E3's criterion ("median assisted-vs-manual review time ≥25% lower")
  belongs to the *later* assisted-review comparison; this pilot is the
  usability pass that must pass first ("U1 before increasing complexity", U1
  sequencing note). No assisted-vs-manual condition is run here; this pack does
  not claim E3's ≥25% threshold can be evaluated from it.
- The consent template is a plain-language research-participation agreement, not
  a legal document; it deliberately avoids claiming GDPR compliance and says so.
