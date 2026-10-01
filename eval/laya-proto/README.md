# laya-proto — System-1 decision engine evaluation (prototype)

Evaluates [NandhaKishorM/laya](https://github.com/NandhaKishorM/laya)
(multilingual non-autoregressive typed decisions: `choice` / `score` /
yes-no in one forward pass) against three triage use cases of note-lm.
**Criteria are fixed in [criteria.md](criteria.md) BEFORE the run** (PI-2
convention); results and the adopt/not-adopt decision live in
`results/` and `report.md`.

Release-age exception: the global "2 weeks minimum package age" rule was
explicitly waived for this evaluation by the product owner (2026-09-29).
`laya` (PyPI) runs ONLY inside the gitignored venv below; it must not
become a product dependency from this prototype. The product path is
laya-ts + ONNX in the engine (see `spike/`), gated by the same criteria.

## Layout

| Path | Purpose |
| --- | --- |
| `criteria.md` | Pass/fail thresholds, fixed before any run |
| `extract-pages.mts` | fusion-proto PDFs → `results/pages.json` (pdf-parse, same join as the retrieval harness) |
| `smoke.py` | venv + checkpoint + EN/ES/DE sanity before the real run |
| `run_eval.py` | U1 matrix pre-screening + U2 proposal prioritisation + U3 query intent → `results/laya-eval.json` |
| `spike/` | laya-ts + onnxruntime-node spike (the engine-shaped path, no Python at inference) |
| `results/` | pages.json, run-meta.json, laya-eval.json |
| `.venv/` | isolated Python 3.12 env (gitignored) |

## Reproduce

```bash
# 0. one-time upstream copy used by the spike (OUTSIDE the repo)
#    git clone --depth 1 https://github.com/NandhaKishorM/laya "C:/Code Main/laya-upstream"
#    (the tarball via codeload works too; gitignored)

# 1. python env (CPU torch — avoids the CUDA download)
py -3.12 -m venv eval/laya-proto/.venv
eval/laya-proto/.venv/Scripts/python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
eval/laya-proto/.venv/Scripts/python.exe -m pip install laya

# 2. corpus page texts (Node 24 type stripping, no tsx needed)
node eval/laya-proto/extract-pages.mts

# 3. smoke (downloads laya-multilingual, ~644 MB, into the HF cache)
eval/laya-proto/.venv/Scripts/python.exe eval/laya-proto/smoke.py

# 4. the three use cases (U1/U2/U3, CPU, ~10-15 min)
eval/laya-proto/.venv/Scripts/python.exe eval/laya-proto/run_eval.py

# 5. engine-shaped spike: export ONNX once, then run Node inference
#    (model="laya-multilingual" = subfolder "multilingual" of convaiinnovations/laya)
eval/laya-proto/.venv/Scripts/python.exe "C:/Code Main/laya-upstream/laya-ts/scripts/export_onnx.py" \
  --repo convaiinnovations/laya --subfolder multilingual --out-dir eval/laya-proto/models/laya-ml
pnpm -C eval/laya-proto/spike install   # laya-ts needs: pnpm add -D @types/node + tsc build (upstream ships no dist)
node eval/laya-proto/spike/spike.mjs
```

## Notes

- Upstream laya-ts compiles only after adding `@types/node` (not declared
  in its devDependencies) and has no committed `dist/` — both are
  integration-relevant findings recorded in the report.
- `models/` is gitignored; re-export reproducibly from the pinned HF
  revision recorded in `results/run-meta.json`.
