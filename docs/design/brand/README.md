# note-lm brand system

note-lm uses a calm, editorial identity for work that needs to remain
verifiable. The document mark represents a source; its two white lines are the
recorded passage; the terracotta square is the durable evidence locator.

## Design tokens

| Role | Value |
| --- | --- |
| Paper | `#f6f4f0` |
| Raised surface | `#fffefa` |
| Ink | `#292720` |
| Secondary text | `#716d63` |
| Divider | `#dedad2` |
| Evidence accent | `#a44b3b` |

Use the accent only for a decision, current selection, evidence locator, or
primary action. The interface is intentionally quiet so documents and claims
remain the focus. Do not use gradients, neon effects, heavy shadows, or large
pill-shaped containers.

## Assets

| File | Use |
| --- | --- |
| `logo.svg` | The standalone source-and-evidence mark. |
| `logo-wordmark.svg` | README, web headers, and horizontal documentation lockups. |
| `logo-wordmark-stacked.svg` | Social cards and square placements. |
| `icon.svg` | Source of truth for Tauri icons. |
| `cover.svg` | Documentation cover artwork. |
| `social-preview.svg` | 1280 × 640 social card, ready for the GitHub repository social-preview setting. |

The desktop header renders the same mark inline, and the Tauri icon set is
generated from `icon.svg`. The SVG files are hand-authored, vector-native,
and MIT-licensed with this repository.

## Generate icons and previews

```bash
npm run brand:assets
```

This runs `scripts/generate-brand-assets.mjs` and updates:

- `src-tauri/icons/icon.ico` plus 32/128/256/512 PNGs
- `docs/design/brand/previews/` for visual review

Upload `previews/social-preview-1280x640.png` in GitHub: **Settings → General
→ Social preview**. GitHub stores that repository setting outside Git, so the
source SVG and its deterministic PNG are kept here for future updates.

Review the 16px mark in `previews/check-sheet.png` before publishing a new
icon. Keep typography in the system UI stack (`Segoe UI Variable`, `Aptos`,
`Helvetica Neue`) and use `Cascadia Mono` only for technical metadata.
