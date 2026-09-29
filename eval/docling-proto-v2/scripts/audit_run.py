"""T5 audit: which files does docling ACTUALLY read, per doc class?

Two independent probes, unioned:
  1. Python audit hook on 'open' events (sys.addaudithook) — catches
     Python-level opens (.py/.pyc/configs/json...).
  2. NTFS last-access-time delta (stat before vs after the run) — catches
     C++-level opens that bypass Python (torch .dll/.so loading,
     safetensors/onnx weight reads via fopen). Verified working on this
     machine by a sentinel self-check inside this script; if the sentinel
     fails, the run aborts (method would be unreliable).

Also records socket.connect audit events (network evidence).

Usage: T1VENV/Scripts/python.exe audit_run.py <class> <pdf-relpath-under-T1-corpus-or-v2-corpus>
Writes results/audit_<class>.json
"""
import ctypes
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
V2 = HERE.parent
T1 = V2.parent / "docling-proto"
VENV = T1 / ".venv"
MODELS = T1 / "docling_models"
OUTDIR = V2 / "results"

cls = sys.argv[1]
pdf_arg = Path(sys.argv[2])
pdf = pdf_arg if pdf_arg.is_absolute() else (V2 / "corpus" / pdf_arg if (V2 / "corpus" / pdf_arg).exists() else T1 / "corpus" / pdf_arg)
os.environ["DOCLING_ARTIFACTS_PATH"] = str(MODELS)

# ---------------------------------------------------------------- sentinel
def atime_selfcheck() -> bool:
    probe = V2 / "results" / "_atime_probe.bin"
    probe.write_bytes(b"x" * 4096)
    a = probe.stat().st_atime
    time.sleep(1.1)
    with open(probe, "rb") as fh:
        fh.read(4096)
    return probe.stat().st_atime > a

if not atime_selfcheck():
    print("SENTINEL FAILED: NTFS atime not updating; audit method unreliable")
    sys.exit(2)
print("atime sentinel OK")

# ------------------------------------------------------- pre-scan + hook
def scan_tree(root: Path):
    out = {}
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            p = Path(dirpath) / f
            try:
                st = p.stat()
            except OSError:
                continue
            out[str(p)] = (st.st_atime, st.st_size)
    return out

t_scan0 = time.time()
venv_before = scan_tree(VENV)
models_before = scan_tree(MODELS)
print(f"pre-scan: venv {len(venv_before)} files, models {len(models_before)} files ({time.time()-t_scan0:.1f}s)")

opened_python = set()
socket_events = []

def _hook(event, args):
    if event == "open":
        path = args[0]
        if isinstance(path, (str, bytes, os.PathLike)):
            try:
                s = os.fspath(path)
            except TypeError:
                return
            if isinstance(s, bytes):
                s = s.decode("utf-8", "replace")
            for root in (VENV, MODELS):
                if s.startswith(str(root)):
                    opened_python.add(s)
                    break
    elif event == "socket.connect":
        socket_events.append(str(args))

sys.addaudithook(_hook)

# ---------------------------------------------------------------- docling
from docling.datamodel.base_models import InputFormat
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions

opts = PdfPipelineOptions()
opts.do_ocr = True
opts.ocr_options = RapidOcrOptions()
opts.do_table_structure = True
opts.table_structure_options.do_cell_matching = True
opts.artifacts_path = MODELS

converter = DocumentConverter(
    format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
)
t0 = time.perf_counter()
conv = converter.convert(str(pdf))
n_items = sum(1 for _ in conv.document.iterate_items())
wall_ms = round((time.perf_counter() - t0) * 1000)
print(f"converted {pdf.name}: {n_items} items in {wall_ms} ms")

# remove hook influence for post-scan writes: post-scan happens on raw stat only
venv_after = scan_tree(VENV)
models_after = scan_tree(MODELS)

def delta(before, after, label):
    changed = {}
    for p, (at, size) in after.items():
        b = before.get(p)
        if b is None:
            changed[p] = {"size": size, "note": "created-during-run"}
        elif at > b[0]:
            changed[p] = {"size": size, "atime_before": b[0], "atime_after": at}
    return changed

venv_delta = delta(venv_before, venv_after, "venv")
models_delta = delta(models_before, models_after, "models")

read_union = set(venv_delta) | set(models_delta) | {os.path.abspath(p) for p in opened_python}
res = {
    "class": cls,
    "pdf": str(pdf),
    "wall_ms": wall_ms,
    "items": n_items,
    "socket_events": socket_events[:50],
    "venv": {
        "files_total": len(venv_after),
        "bytes_shipped": sum(v[1] for v in venv_after.values()),
        "python_opened": sorted(opened_python),
        "atime_delta_files": {k: v for k, v in venv_delta.items()},
    },
    "models": {
        "files_total": len(models_after),
        "bytes_shipped": sum(v[1] for v in models_after.values()),
        "atime_delta_files": {k: v for k, v in models_delta.items()},
    },
}
OUTDIR.mkdir(exist_ok=True)
(OUTDIR / f"audit_{cls}.json").write_text(json.dumps(res, indent=1), encoding="utf-8")

mb = lambda n: round(n / 1024 / 1024, 1)
venv_read = sum(venv_after.get(p, (0, 0))[1] for p in read_union if p.startswith(str(VENV)))
models_read = sum(models_after.get(p, (0, 0))[1] for p in read_union if p.startswith(str(MODELS)))
print(f"VENV : read {mb(venv_read)} MB of shipped {mb(res['venv']['bytes_shipped'])} MB "
      f"(python-hook {len(opened_python)}, atime {len(venv_delta)})")
print(f"MODELS: read {mb(models_read)} MB of shipped {mb(res['models']['bytes_shipped'])} MB (atime {len(models_delta)})")
print("sockets:", socket_events[:10])
