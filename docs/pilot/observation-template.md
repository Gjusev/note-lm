# E3 pilot — observation template

One printed (or duplicated digital) copy per participant. The observer fills it
live; timestamps use `mm:ss` from session start. Every observed problem gets a
row and a severity. Keep quotes verbatim — in the participant's own language,
with a translation in brackets only where the moderator is sure of it.

Nothing here pre-fills outcomes: fields stay blank until a real session
produces real data.

---

## Session header

| Field | Value |
| --- | --- |
| Participant code | P__ |
| Date / start time | |
| Session language | ES / DE / EN |
| Task order | A / B (see [tasks.md](tasks.md)) |
| Machine | own laptop / provided (`own` matters — analyses may split on it) |
| App build / installer version | |
| Prior AI-notebook experience (participant's words) | |
| Provider configured for T2 | local model / participant's own remote key / none (T2 blocked) |
| Recording | yes / no — file: |

---

## Per-task observation grid

One block per task T1–T8 (copy the block; do not pre-fill). Outcome must be one
of `unaided / assisted / failed / blocked (setup)`.

### T__ — name

| Field | Value |
| --- | --- |
| Start → end (mm:ss) | |
| Outcome | |
| Intervention (if assisted — exact words + timestamp) | |
| Errors / hesitations observed | |
| Verbatim quote(s) | |
| Problems raised (severity, see key below) | |

**T3 extra:** time-to-evidence (citation chip visible → quoted passage open):
`__:__ → __:__` = `__ min __ s`. Path used: chip / manual hunt / other.

**T5 extra — version-error tally** (mark each kind observed, else 0):
quoted/acted on wrong version ☐ · proposal read as "my conclusion is false" ☐
· did not notice v1 still exists ☐ · treated decision as irreversible ☐ ·
other: ___

**T6 extra:** empty-cell behavior observed as: readable message ☐ / silent
confusion ☐ / not reached ☐

**T7 extra:** did the participant verify anything after import? what ☐ /
trusted the success state ☐

### T8 — comprehension quiz (score 0–3)

| Q | Participant's answer (verbatim gist) | Correct per key? (1/0) | Misconception recorded |
| --- | --- | --- | --- |
| 1 (local vs remote processing) | | | |
| 2 (offline mode) | | | |
| 3 (what a shared package contains) | | | |

Score: `__ / 3`

### SUS (10 items, 1–5, standard scoring; odd items positive, even negative)

1 ___ 2 ___ 3 ___ 4 ___ 5 ___ 6 ___ 7 ___ 8 ___ 9 ___ 10 ___
→ raw sum `__` × 2.5 = SUS `__.__`

---

## Problem log (every problem, even ones fixed mid-session)

| # | Task | What happened (fact) | Severity | Quote/ref | Fix idea (participant's, if any) |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

### Severity key — use the definition, not the gut feeling

- **Blocker** — the participant cannot complete a core task at all, or reaches
  a wrong result while believing it right (e.g. cites v1 thinking it is v2 and
  does not notice). Blocks real use until fixed.
- **Major** — the task completes only with help, or takes a wrong path that the
  participant must self-correct at real cost; high frustration visible.
- **Minor** — task completes unaided but with avoidable friction (extra steps,
  a label that had to be read twice, a moment of confusion that resolved).
- **Polish** — cosmetic or wording-level; no effect on the outcome.

Rule of thumb: severity is about **consequence for the user's goal**, not about
how big the underlying code problem is. When unsure between two levels, note
both and decide in analysis (§8 of the plan ranks by severity × frequency).

## Wrap-up interview notes

- Most confusing moment (verbatim):
- What they would do next with their real documents:
- Expected but missing:
- Anything they want to add:

## Session end (moderator)

- [ ] Consent form filed (§7 of consent template checklist done)
- [ ] Recording filed/deleted per consent
- [ ] Sheet scanned to the pilot folder on the session machine

---

## Analysis intake (filled later, not during the session)

From each sheet, transfer one row per task to the roll-up: participant code,
task, outcome, time (T3: time-to-evidence), version-error count (T5), quiz
score (T8). Then per [e3-pilot.md](e3-pilot.md) §8: medians + min–max, severity
× frequency problem ranking, language/machine splits as observed difficulties —
descriptive only, no generalization claims.
