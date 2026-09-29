# note-lm brand resources

Neo-Swiss/brutalist brand system for note-lm. Vector-first: every asset is
hand-authored SVG code in this directory; all PNG/ICO files are derived by a
deterministic rasterizer. Status: logo + brand design delivered; desktop
application of the tokens is a proposal for the next slice.

## Direction

Strict grid with visible hairline rules (#EAEAEA, 1px) alongside 2px
structural ink rules; extreme contrast (ink `#202020` on paper
`#F7F6F3`/`#FFFFFF`); sharp corners only (radius 0/2px); oversized heavy
caps; mono metadata and numerals as design elements; red `#b4473d` as the
single hard accent (dark theme `#d2705f`). 

Banned by this direction: gradients, soft shadows, pastel washes,
pill-shaped containers, and the typefaces Inter/Roboto/OpenSans. Type is an
offline stack - UI/wordmark: `'Helvetica Neue', Arial, system-ui`;
metadata: `'JetBrains Mono', ui-monospace` fallback chain. Nothing is
bundled or downloaded (the app is offline-first; tokens.css already
documents that "Geist Sans" is named but not shipped).

Earlier draft directions (continuous-line ink illustrations with pastel
offset shapes, editorial serif accents, pastel status tints) were dropped by
owner decision on 2026-09-29 and are not part of this system.

## Files

| File | What it is |
| --- | --- |
| `logo.svg` | The mark: a raw page rectangle with a dog-ear notch, one white knockout line (the text), one solid red square (the citation marker - the `[E1]` evidence idiom reduced to geometry). Legible at 16 px. |
| `logo-wordmark.svg` | Horizontal lockup: mark + `NOTE-LM` in heavy caps, tracking tight. |
| `logo-wordmark-stacked.svg` | Stacked lockup: mark, 2px rule inset to the wordmark width, `NOTE-LM`, mono metadata line. |
| `icon.svg` | App icon source: paper tile, 24px structural ink frame, mark at scale 12. |
| `cover.svg` | Docs/design cover: hairline 14-column grid, structural rules, mark snapped to the margin, oversized wordmark, German title `FORSCHUNGSNOTIZBUCH MIT BELEGEN`, mono index/version metadata, one red square. |
| `tokens-proposal.css` | **PROPOSAL, NOT APPLIED** - neo-brutalist token layer for the next desktop slice: radius 0/2, hairline + structural border system, solid status chips with contrast-verified fg/bg pairs, kbd, `.meta`, grid-rhythm spacing, buttons as ink blocks with hover invert. |
| `previews/` | Rasterized previews incl. `check-sheet.png` (the 16 px legibility check: true 1x rasters plus 4x nearest-neighbor enlargements). |
| `../../src-tauri/icons/` | Generated Tauri icon set (see below). |

## License and provenance

All SVGs here are original work for this repository, MIT-licensed with the
repo (see the repository license). The wordmark/lockups use `<text>` with
offline system font stacks rather than bundled or traced typefaces - no
third-party font files are distributed.

**No AI raster generation was used anywhere** (z.ai image tooling was not
invoked for any asset). Everything is deterministic, hand-written SVG, so
the brand is infinitely scalable, diff-able in code review, and
license-clean. The only machine step is the deterministic chromium
rasterizer below.

## Regenerating the raster set

```bash
node scripts/generate-brand-assets.mjs
```

Uses the playwright chromium already in devDependencies (no new
dependency). Deterministic by construction: fixed viewport per target,
`deviceScaleFactor: 1`, transparent background, waits for
`document.fonts.ready` + a double `requestAnimationFrame` before capture,
no timestamps in output - two consecutive runs produce byte-identical
files (verified by hash comparison).

Produces, into `src-tauri/icons/`:

- `icon.png` (512), `128x128@2x.png` (256), `128x128.png` (128),
  `32x32.png` (32)
- `icon.ico` - multi-size PNG-in-ICO (16/32/48/256). The ICO container is
  written by hand in the script (~40 lines: 6-byte ICONDIR + 16-byte entry
  per image + raw PNG payloads; PNG entries are valid since Windows Vista).

`tauri.conf.json` currently references only `icons/icon.ico` (the bundle
target is NSIS/Windows), and the script verifies on every run that every
configured icon path exists. There is **no `icon.icns`**: ICNS authoring
needs macOS tooling (`tauri icon` on a Mac, or `iconutil`); when an macOS
target is added, run the official generator against `icon.svg`/`icon.png`.

Previews land in `docs/design/brand/previews/` (16/32 px checks, lockups,
cover, `check-sheet.png`).

## Where things apply

- **Now:** `src-tauri/icons/*` - consumed by the Tauri bundle (installer,
  taskbar, window icon) via `tauri.conf.json`.
- **Follow-up (src/desktop is frozen mid-slice):**
  - favicon/in-app logo mark in the desktop shell (`logo.svg` inline, or
    `previews/lockup-640.png` until SVG inlining is chosen);
  - `tokens-proposal.css` merged into `src/desktop/src/styles/tokens.css`
    by the next desktop slice (review contrast values there first);
  - `cover.svg` as the docs cover once docs get a landing page.
- Name availability ("note-lm") remains unverified legally - carried over
  from PRODUCT.md; the working-name status is unchanged.

## Known limits

- At 16 px the dog-ear notch anti-aliases into a "cut corner" rather than
  a distinct fold - accepted for this direction (the mark is meant to read
  as raw geometry; ink block + white slit + red square all stay distinct,
  confirmed via `check-sheet.png`).
- The lockups render the wordmark with whatever grotesk the OS substitutes
  (Arial on Windows). If pixel-exact wordmarks are ever required, convert
  the text to paths at that point - deliberately not done now to avoid
  hand-drawn letterforms.
