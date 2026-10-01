# Hyperframes Composition Brief: note-lm

## Objective

Create a 20-second launch-style brag video for note-lm, a local-first research notebook where each claim stays connected to its source evidence and immutable source version.

## Output

- Composition directory: `brag-output-2026-10-01-122100/composition-v1/`
- Rendered video: `brag-output-2026-10-01-122100/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 20 seconds

## Source Material

- Project root: `.`
- Primary files read: `README.md`, `src/desktop/src/styles/tokens.css`, `src/desktop/src/screens/Library.tsx`, `src/desktop/src/workspace/*`, and `eval/ui-drive/artifacts/*.png`
- Product name: note-lm
- Tagline / strongest claim: “A local-first research notebook where every claim opens its evidence.”
- Key UI moment to recreate: a researcher saves a quoted claim, then sees the original v1 anchor preserved after a source re-import produces v2.
- Copy that must appear verbatim:
  - “Research changes. Evidence remembers.”
  - “Every claim opens its evidence.”
  - “Nothing is silently rewritten.”

## Creative Direction

- Tone preset: polished
- Creative direction: quiet editorial research film
- Interpretation: warm paper, charcoal typography, and a single terracotta accent. Motion is purposeful and tactile: a click, a highlighted passage, a proposal, and a final mark. No generic AI dashboard tropes.
- Angle: the point is not that a model summarizes files; it is that a source can change without deleting the basis for a prior claim.
- Hook: v1 becomes v2 while an anchored claim stays visibly attached to v1.
- Outro / punchline: matrix cells collect into the note-lm document mark and the claim “Every claim opens its evidence.”
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - A visual redesign unrelated to the product
  - Unverified performance or AI-quality claims

## Visual Identity

- Background: `#f6f4f0`
- Text: `#292720`
- Accent: `#a44b3b`
- Display font: `Segoe UI Variable`, `Aptos`, `Helvetica Neue`, system fallback
- Body font: `Segoe UI Variable`, `Aptos`, `Helvetica Neue`, system fallback
- Visual references: actual library, workspace, source reader, inspector, evidence matrix, and document/citation mark.

## Storyboard

Use `../brag-plan.md` as the creative contract.

1. Evidence remembers — 3s — v1/v2 document and claim anchor.
2. Start with a source — 4s — library button click and source import.
3. Claim with a locator — 5s — working three-column UI, selection, and evidence inspector.
4. Review, do not rewrite — 4s — v2 update and pending review beside retained v1.
5. The evidence map — 4s — matrix-to-mark closing lockup.

## Audio

- Audio role: warm music bed with sparse interface and impact accents.
- Audio arc: near-silent hook, gentle beat-driven interaction, soft final impact and fade.
- Music: `assets/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3`
- Music treatment: low opening volume; support the working UI; fade underneath the final mark.
- Music cue guidance: use the bundled vol. 1 cue plan; target 17.02s for the matrix-to-mark payoff and 20.02s for the final lockup. Use 7.02s, 7.52s and 8.02s only for non-text evidence arrivals; retain the completed set long enough to read.
- Audio-reactive treatment: subtle RMS-driven breathing in the paper field and final accent marker. Never add a waveform or visualizer.
- Audio-coupled moments:
  - Library click — `assets/sfx/interface/click_003.ogg`
  - Final mark — `assets/sfx/impact/impactSoft_medium_001.ogg`
- SFX selection guidance: retain this minimal, low high-frequency-risk pair. Align UI click to the simulated press and impact to the final mark.
- SFX analysis guidance: selection was made using the bundled `sfx-analysis.md`; both chosen effects are low-risk candidates.
- Exact SFX choice: those two local files are already copied under `assets/`.

## Hyperframes Instructions

Use a seek-safe GSAP composition with a paused root timeline registered under `window.__timelines.main`. Every visual clip needs explicit `data-start`, `data-duration`, and `data-track-index` values. Show the interface as a grounded recreation: source navigator on the left, document in the middle, evidence on the right. Keep text readable and motion in transform/opacity channels. Include a `motion.json` sidecar that asserts the headline, workspace, evidence card, proposal, and final mark appear in order and remain in frame.

Use local assets only. Run `npx hyperframes check --snapshots` before preview. Do not render before final review approval.
