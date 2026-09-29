"""T5 curated run: full extended corpus (T1 8 + rotated/rotscan 5 + real 3),
docling 2.131.0, SAME pipeline options as T1, artifacts = curated/models.

G2 test (fresh-cache, no downloads): every cache env var points into
fresh_caches/ (HF_HOME, HF_HUB_CACHE, TRANSFORMERS_OFFLINE cache dirs,
TORCH_HOME, XDG_CACHE_HOME, TEMP not touched); HF_HUB_OFFLINE=1 forbids hub
network; an audit hook records socket.connect events. After the run the
fresh dirs must be EMPTY (no silent download/copy) — asserted and recorded.
Method limit (documented): network is not physically blocked in-sandbox;
offline mode + socket audit + empty-dir assertion is the honest proxy.

Writes results/curated_run.json (+ results/curated_docs/*.json,
results/fresh_caches/** for inspection, overlays rendered separately).
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
CURATED = V2 / "curated" / "models"
FRESH = V2 / "results" / "fresh_caches"

# ---- fresh-cache environment (set BEFORE any docling/hf import) ----------
FRESH.mkdir(parents=True, exist_ok=True)
for var in ("HF_HOME", "HF_HUB_CACHE", "HF_HUB_OFFLINE", "TRANSFORMERS_CACHE",
            "TORCH_HOME", "XDG_CACHE_HOME", "HF_TOKEN_PATH"):
    os.environ.pop(var, None)
os.environ["HF_HOME"] = str(FRESH / "hf_home")
os.environ["HF_HUB_CACHE"] = str(FRESH / "hf_hub")
os.environ["TRANSFORMERS_CACHE"] = str(FRESH / "transformers")
os.environ["TORCH_HOME"] = str(FRESH / "torch")
os.environ["XDG_CACHE_HOME"] = str(FRESH / "xdg")
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["DOCLING_ARTIFACTS_PATH"] = str(CURATED)
for sub in ("hf_home", "hf_hub", "transformers", "torch", "xdg"):
    (FRESH / sub).mkdir(exist_ok=True)

socket_events = []


def _hook(event, args):
    if event == "socket.connect":
        socket_events.append(str(args))


sys.addaudithook(_hook)


class _PMC(ctypes.Structure):
    _fields_ = [("cb", ctypes.c_uint32), ("PageFaultCount", ctypes.c_uint32),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]


def peak_ws_mb():
    pmc = _PMC()
    pmc.cb = ctypes.sizeof(_PMC)
    k32, psapi = ctypes.windll.kernel32, ctypes.windll.psapi
    k32.GetCurrentProcess.restype = ctypes.c_void_p
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(_PMC), ctypes.c_uint32]
    psapi.GetProcessMemoryInfo(ctypes.c_void_p(k32.GetCurrentProcess()), ctypes.byref(pmc), pmc.cb)
    return round(pmc.PeakWorkingSetSize / (1024 * 1024), 1)


def tree_state(root: Path):
    import os
    state = {}
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            p = Path(dirpath) / f
            try:
                state[str(p)] = p.stat().st_size
            except OSError:
                pass
    return state


fresh_before = tree_state(FRESH)

# ------------------------------------------------------------------ docling
from docling.datamodel.base_models import InputFormat
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions

opts = PdfPipelineOptions()
opts.do_ocr = True
opts.ocr_options = RapidOcrOptions()  # same pin as T1: pip-only OCR backend
opts.do_table_structure = True
opts.table_structure_options.do_cell_matching = True
opts.artifacts_path = CURATED

pipeline_cfg = {
    "ocr_backend": "RapidOcrOptions", "ocr_enabled": True,
    "table_structure": True, "table_cell_matching": True,
    "artifacts_path": str(CURATED),
    "hf_hub_offline": os.environ["HF_HUB_OFFLINE"],
    "cache_env": {k: os.environ[k] for k in
                  ("HF_HOME", "HF_HUB_CACHE", "TRANSFORMERS_CACHE", "TORCH_HOME", "XDG_CACHE_HOME")},
    "docling_version": __import__("docling").__version__,
}

# ------------------------------------------------------------------ corpus
manifests = []
m1 = json.loads((T1 / "corpus" / "manifest.json").read_text(encoding="utf-8"))
for d in m1["docs"]:
    d = dict(d)
    d["source_dir"] = str(T1 / "corpus")
    manifests.append(d)
m2 = json.loads((V2 / "corpus" / "manifest_ext_synth.json").read_text(encoding="utf-8"))
for d in m2["docs"]:
    d = dict(d)
    d["source_dir"] = str(V2 / "corpus")
    manifests.append(d)
m3 = json.loads((V2 / "corpus" / "manifest_ext_real.json").read_text(encoding="utf-8"))
for d in m3["docs"]:
    d = dict(d)
    d["source_dir"] = str(V2 / "corpus")
    manifests.append(d)

docs_out = V2 / "results" / "curated_docs"
docs_out.mkdir(parents=True, exist_ok=True)

converter = DocumentConverter(
    format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
)

results = {"tool": f"docling {pipeline_cfg['docling_version']}", "run": "curated-v2",
           "pipeline": pipeline_cfg, "docs": {}, "fresh_cache_test": {}}
first_ms = None
for entry in manifests:
    pdf = Path(entry["source_dir"]) / entry["fileName"]
    t0 = time.perf_counter()
    try:
        conv = converter.convert(str(pdf))
        doc = conv.document
    except Exception as err:
        results["docs"][entry["fileName"]] = {"error": f"{type(err).__name__}: {err}",
                                              "wall_ms": round((time.perf_counter() - t0) * 1000)}
        print("CONVERT FAIL", entry["fileName"], err)
        continue
    wall = round((time.perf_counter() - t0) * 1000)
    if first_ms is None:
        first_ms = wall

    stem = Path(entry["fileName"]).stem
    units = []
    for item, _level in doc.iterate_items():
        prov = item.prov[0] if getattr(item, "prov", None) else None
        u = {
            "kind": type(item).__name__,
            "label": str(getattr(item, "label", None)),
            "page": prov.page_no if prov else None,
            "bbox": [round(prov.bbox.l, 1), round(prov.bbox.t, 1),
                     round(prov.bbox.r, 1), round(prov.bbox.b, 1)] if prov else None,
        }
        if type(item).__name__ == "TableItem":
            td = item.data
            u["rows"], u["cols"] = td.num_rows, td.num_cols
            u["grid"] = [[c.text for c in row] for row in td.grid]
            u["text"] = " ".join(c for row in u["grid"] for c in row)
        elif hasattr(item, "text"):
            u["text"] = item.text
        units.append(u)

    sizes = {}
    for pno, page in doc.pages.items():
        s = getattr(page, "size", None)
        sizes[str(pno)] = [getattr(s, "width", None), getattr(s, "height", None)] if s else None

    (docs_out / f"{stem}.docling.json").write_text(
        json.dumps({"units": units, "page_sizes": sizes}, ensure_ascii=False), encoding="utf-8")
    results["docs"][entry["fileName"]] = {
        "docId": entry["docId"], "class": entry.get("class"),
        "wall_ms": wall, "page_count": len(doc.pages), "units": len(units),
        "page_sizes": sizes, "units_data": units,
    }
    print(f"{entry['fileName']:<32} {wall:>7} ms  {len(units):>3} units  peak {peak_ws_mb()} MB")

fresh_after = tree_state(FRESH)
new_files = {p: s for p, s in fresh_after.items() if p not in fresh_before}
grew = {p: (fresh_before[p], s) for p, s in fresh_after.items() if p in fresh_before and s != fresh_before[p]}
results["fresh_cache_test"] = {
    "fresh_dir": str(FRESH), "new_files": new_files, "changed_files": grew,
    "socket_events": socket_events[:100],
    "no_download_pass": not new_files and not grew,
}
results["first_doc_ms"] = first_ms
results["peak_rss_mb"] = peak_ws_mb()
results["socket_events"] = socket_events[:100]
out = V2 / "results" / "curated_run.json"
out.write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"\nfresh-cache no-download: {'PASS' if results['fresh_cache_test']['no_download_pass'] else 'FAIL'}"
      f" (new {len(new_files)}, changed {len(grew)}, sockets {len(socket_events)})")
print(f"first doc {first_ms} ms; peak WS {results['peak_rss_mb']} MB")
