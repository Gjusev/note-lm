"""T5 curated layout: copy ONLY audit-proven-read model files (+ the RapidOCR
dict as conservative insurance) into curated/models/, preserving the standard
docling artifacts directory structure, then measure sizes.

Audit rule (t5-criteria): a file may be dropped only if it was never opened in
ANY audited class (text / ocr / table / realscan). Proven across all four:
the runtime reads the TORCH heron variant (not onnx), tableformer ACCURATE
(not fast), RapidOCR .onnx twins (not .pth twins).

Usage: T1VENV/Scripts/python.exe build_curated.py
Writes curated/models/**, results/curated_sizes.json
"""
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
V2 = HERE.parent
T1 = V2.parent / "docling-proto"
SRC = T1 / "docling_models"
DST = V2 / "curated" / "models"
RESULTS = V2 / "results"

KEEP = {
    "docling-project--docling-layout-heron": [
        "config.json", "preprocessor_config.json", "model.safetensors",
    ],
    "docling-project--docling-models": [
        "model_artifacts/tableformer/accurate/tableformer_accurate.safetensors",
        "model_artifacts/tableformer/accurate/tm_config.json",
    ],
    "RapidOcr": [
        "PP-OCRv6_det_small.onnx", "PP-OCRv6_rec_small.onnx",
        "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
        # not audit-read (v6 rec loads without it on this stack) but 0.6 MB of
        # insurance against a code path that does read it:
        "ppocrv6_dict.txt",
    ],
}

DROPPED_RATIONALE = {
    "docling-project--docling-layout-heron-onnx": "never opened in any audited class; runtime loads the TORCH heron (audit-proven; contradicts the T1 report's assumption)",
    "model_artifacts/tableformer/fast/": "never opened; pipeline uses TableFormerMode.ACCURATE (default)",
    ".pth twins in RapidOcr": "never opened; RapidOCR runtime is onnxruntime",
    ".cache/huggingface metadata trees + README/.gitattributes/sample png": "download-time artifacts; not read at inference (audit); not needed when loading from a fixed local artifacts path",
}


def tree_bytes(root: Path):
    import os
    total = 0
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(dirpath, f))
            except OSError:
                pass
    return total


def du_mib(root: Path):
    out = subprocess.run(["du", "-sk", str(root)], capture_output=True, text=True)
    return round(int(out.stdout.split()[0]) / 1024, 1)


def main():
    if DST.exists():
        shutil.rmtree(DST)
    copied = []
    for repo, files in KEEP.items():
        for rel in files:
            src = SRC / repo / rel
            dst = DST / repo / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            copied.append(str(dst.relative_to(DST)))
    # zip (download proxy)
    zpath = V2 / "curated" / "curated_models.zip"
    if zpath.exists():
        zpath.unlink()
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for p in sorted(DST.rglob("*")):
            if p.is_file():
                zf.write(p, p.relative_to(DST))
    # 7z if available (usually not on Windows without install)
    sz = None
    if shutil.which("7z"):
        spath = V2 / "curated" / "curated_models.7z"
        if spath.exists():
            spath.unlink()
        subprocess.run(["7z", "a", "-mx=9", str(spath), str(DST)], capture_output=True)
        sz = spath.stat().st_size

    src_logical, dst_logical = tree_bytes(SRC), tree_bytes(DST)
    report = {
        "audit_proven_kept": copied,
        "dropped_rationale": DROPPED_RATIONALE,
        "sizes_bytes": {
            "source_models_logical": src_logical,
            "curated_models_logical": dst_logical,
            "curated_zip": zpath.stat().st_size,
            "curated_7z": sz,
        },
        "sizes_mib": {
            "source_models_logical": round(src_logical / 1048576, 1),
            "curated_models_logical": round(dst_logical / 1048576, 1),
            "curated_zip": round(zpath.stat().st_size / 1048576, 1),
            "curated_7z": round(sz / 1048576, 1) if sz else None,
            "source_models_du": du_mib(SRC),
            "curated_models_du": du_mib(DST),
            "venv_du_today": du_mib(T1 / ".venv"),
            "venv_logical_today": round(tree_bytes(T1 / ".venv") / 1048576, 1),
            "t1_reported_venv_mb": 1406.6,
        },
    }
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "curated_sizes.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report["sizes_mib"], indent=1))
    print(f"kept {len(copied)} files")


if __name__ == "__main__":
    main()
