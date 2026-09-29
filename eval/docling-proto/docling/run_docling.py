"""T1 Docling runner - converts the corpus with DocumentConverter, exports
docling_document JSON per doc, records per-doc wall time, pipeline config,
and process peak working set (Windows).

Usage: .venv/Scripts/python.exe docling/run_docling.py run1|run2
Writes results/docling_results_<run>.json (+ results/docling_docs/*.json).
run1 = first ever run (includes model downloads); run2 = warm steady state.
"""
import ctypes
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
os.environ.setdefault("DOCLING_ARTIFACTS_PATH", str(ROOT / "docling_models"))

# ---------------------------------------------------------- peak RAM (win32)
class _PMC(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.c_uint32), ("PageFaultCount", ctypes.c_uint32),
        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def peak_ws_mb():
    pmc = _PMC()
    pmc.cb = ctypes.sizeof(_PMC)
    k32, psapi = ctypes.windll.kernel32, ctypes.windll.psapi
    k32.GetCurrentProcess.restype = ctypes.c_void_p
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(_PMC), ctypes.c_uint32]
    psapi.GetProcessMemoryInfo(ctypes.c_void_p(k32.GetCurrentProcess()), ctypes.byref(pmc), pmc.cb)
    return round(pmc.PeakWorkingSetSize / (1024 * 1024), 1)


def dump_options(o):
    for attr in ("model_dump", "to_dict"):
        if hasattr(o, attr):
            return getattr(o, attr)()
    return {k: str(v) for k, v in vars(o).items()}


# ----------------------------------------------------------------- docling
from docling.datamodel.base_models import InputFormat
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions

opts = PdfPipelineOptions()
opts.do_ocr = True
# Pin the OCR backend explicitly: RapidOCR is pip-only (onnxruntime). Auto
# mode on this dev machine would pick the system-installed tesseract binary,
# which violates the no-user-install rule for shipping.
opts.ocr_options = RapidOcrOptions()
opts.do_table_structure = True
opts.table_structure_options.do_cell_matching = True
if hasattr(opts.ocr_options, "model_storage_directory"):
    opts.ocr_options.model_storage_directory = str(ROOT / "easyocr_models")
if hasattr(opts.ocr_options, "download_enabled"):
    opts.ocr_options.download_enabled = True

pipeline_cfg = {
    "ocr_enabled": opts.do_ocr,
    "ocr_backend": type(opts.ocr_options).__name__,
    "ocr_options": dump_options(opts.ocr_options),
    "ocr_needs_system_binary": "tesseract" in type(opts.ocr_options).__name__.lower(),
    "table_structure": True,
    "table_cell_matching": opts.table_structure_options.do_cell_matching,
    "artifacts_path": os.environ["DOCLING_ARTIFACTS_PATH"],
}
print("pipeline:", json.dumps(pipeline_cfg, default=str))

converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})

run = sys.argv[1] if len(sys.argv) > 1 else "run1"
manifest = json.loads((ROOT / "corpus" / "manifest.json").read_text(encoding="utf-8"))
docs_out = ROOT / "results" / "docling_docs" if run == "run2" else ROOT / "results" / f"docling_docs_{run}"
docs_out.mkdir(parents=True, exist_ok=True)

results = {"tool": f"docling {__import__('docling').__version__}", "run": run,
           "pipeline": pipeline_cfg, "docs": {}, "page_sizes": {}}
first_ms = None
for entry in manifest["docs"]:
    pdf = ROOT / "corpus" / entry["fileName"]
    t0 = time.perf_counter()
    try:
        conv = converter.convert(pdf)
        doc = conv.document
    except Exception as err:  # counted in the denominator, never dropped
        results["docs"][entry["fileName"]] = {"error": f"{type(err).__name__}: {err}",
                                              "wall_ms": round((time.perf_counter() - t0) * 1000)}
        print("CONVERT FAIL", entry["fileName"], err)
        continue
    wall = round((time.perf_counter() - t0) * 1000)
    if first_ms is None:
        first_ms = wall

    stem = Path(entry["fileName"]).stem
    doc.save_as_json(str(docs_out / f"{stem}.docling.json"))

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
        if type(item).__name__ == "SectionItem":
            u["text"] = getattr(item, "title", "") or ""
        elif type(item).__name__ == "TableItem":
            td = item.data
            u["rows"], u["cols"] = td.num_rows, td.num_cols
            u["grid"] = [[c.text for c in row] for row in td.grid]
            # joined text so phrase matching sees row content (anchor = table prov)
            u["text"] = " ".join(c for row in u["grid"] for c in row)
        elif hasattr(item, "text"):
            u["text"] = item.text
        elif hasattr(item, "text"):
            u["text"] = item.text
        units.append(u)

    sizes = {}
    for pno, page in doc.pages.items():
        s = getattr(page, "size", None)
        sizes[str(pno)] = [getattr(s, "width", None), getattr(s, "height", None)] if s else None
    results["page_sizes"][entry["fileName"]] = sizes

    results["docs"][entry["fileName"]] = {
        "wall_ms": wall, "page_count": len(doc.pages), "units": units,
    }
    print(f"{entry['fileName']}  {wall} ms  {len(units)} units  peak {peak_ws_mb()} MB")

results["first_doc_ms"] = first_ms
results["peak_rss_mb"] = peak_ws_mb()
out = ROOT / "results" / f"docling_results_{run}.json"
out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"wrote {out.name}; first doc {first_ms} ms; peak WS {results['peak_rss_mb']} MB")
