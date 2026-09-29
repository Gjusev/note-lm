# GPU 7B verification — Qwen2.5-7B-Instruct Q4_K_M + CUDA llama.cpp

Date: 2026-09-29. Evaluation-only artifact check; nothing committed, no product files touched.

## Verdict

PASS. Model integrity verified against Hugging Face, llama.cpp CUDA build b11233 runs on the
GTX 1080 with `-ngl 99` (all layers), ~37 tok/s generation, ~718 tok/s prefill, strict-JSON
adherence OK, clean teardown.

## Model integrity (sha256)

| File | Local sha256 | HF API `lfs.oid` | Match |
|---|---|---|---|
| qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf (3,993,201,344 B) | `dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db` | `dfce12e3…90580db` | MATCH |
| qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf (689,872,288 B) | `539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a` | `539cf93f…df3d72a` | MATCH |

HF source: `https://huggingface.co/api/models/Qwen/Qwen2.5-7B-Instruct-GGUF/tree/main?recursive=true`.
Both hashes also match `.probe-downloads/qwen7b-expected-sha256.txt` (captured at download time).
`.probe-downloads/checksums.sha256` contains no Qwen-7B entries (unzip-manifest only).

## Build integrity (zip sha256 vs GitHub release b11233 manifest)

| Zip | Local sha256 | Release digest (`rel-b11233.json`, GitHub API) | Match |
|---|---|---|---|
| llama-b11233-bin-win-cuda-12.4-x64.zip (264,518,056 B) | `29a7efc27cc29542bc4e213100d1db8cf43c2f94fcee0fa9c250b2ec84d605e5` | same | MATCH |
| cudart-llama-bin-win-cuda-12.4-x64.zip (391,443,627 B) | `8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6` | same | MATCH |

Both zips extracted fresh (`rm -rf` + bsdtar `-xf`) into `.probe-downloads/llama-cuda/`;
`llama-server.exe` present with bundled CUDA DLLs (cudart64_12, cublas64_12, cublasLt64_12, ggml-cuda.dll).

## Runtime

- llama.cpp build: `b11233-d77dd0806` (from `/props` build_info)
- GPU: NVIDIA GeForce GTX 1080 (WDDM), driver 582.66, CUDA Version 13.0 (driver-level), 8192 MiB total VRAM
- Baseline VRAM before load: 1142 MiB (desktop apps)
- Working ngl: **99 on first try** (no OOM; 30/16 fallbacks not needed)
- Model load to `/health ok`: ~6.9 s (split GGUF: server loaded `-00001` shard directly, `-00002` found by naming convention)
- Port used: 8737, `--host 127.0.0.1 -c 8192 --jinja --no-webui`
- llama-server PID on GPU during run: 37104

## VRAM during inference

- With model resident (idle): 6076 MiB / 8192 MiB
- During generation (concurrent nvidia-smi): **6111 MiB used, GPU util 98%, 194.48 W**

## Performance

Warm call (160 completion tokens, "count 1 to 60", temperature 0):

- Generation: **37.6 tok/s** (26.58 ms/token, 160 tokens in 4226 ms)
- Prefill steady state: **717.95 tok/s** on a 1911-token prompt (2662 ms, 1.39 ms/token)

Cold first call (fixed overhead inflates prompt time: 51 tokens in 2645 ms ≈ warmup/allocation;
do not read as prefill speed — the 1911-token figure above is the steady-state number).

JSON test call: wall 2.80 s, 51 prompt tokens, 6 completion tokens.

## JSON adherence (the gate)

Prompt: "Respond with STRICT JSON only, no other text, no markdown fences. Output exactly:
`{\"ok\": true}`", max_tokens 50, temperature 0.

Raw content: `{"ok": true}` → parses to `{"ok": True}` → **PASS**.

Second call (1911-token document + JSON instruction): returned `{"read": true}` → parses → PASS.
Tools test skipped per task spec (JSON adherence is the gate; `--jinja` was on for later tool use).

## Teardown

`taskkill /IM llama-server.exe /T /F` → PID 37104 terminated. `tasklist | grep -i llama` →
no matches. Zero llama processes remain.

## Notes / deviations

- The server log is terse at default verbosity (no per-layer offload lines); GPU residency is
  proven instead by nvidia-smi compute-apps entry for `llama-server.exe` and the +4.9 GiB VRAM
  delta over baseline.
- Script used for the API tests: `.probe-downloads/probe-out/gpu7b-test.py`, `gpu7b-warm.py`.
- Server stdout/stderr: `.probe-downloads/probe-out/gpu7b-server.log`.
