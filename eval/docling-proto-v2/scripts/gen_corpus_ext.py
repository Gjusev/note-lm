"""T5 corpus extension, part 1: rotated + hybrid-scan variants from the T1 corpus.

Deterministic: no RNG, no timestamps. Run with the T1 venv python.
Writes into <outdir>/ (default: corpus/) the files:
  rot-sc-hafen-logbuch-180.pdf     (text doc, /Rotate 180)
  rot-tc-wochenbericht-270.pdf     (two-column doc, /Rotate 270)
  rot-tb-messreihe-90.pdf          (table doc, /Rotate 90)
  rscan-sc-observatorium-90.pdf    (image-only 90-deg-rotated scan of p1-2, OCR)
  rscan-tb-lieferschwelle-90.pdf   (image-only 90-deg-rotated scan of the table page)
plus manifest_ext_synth.json with expected content copied from the T1 manifest.

Determinism self-check (two-run byte-compare) is done by run_gen_check.sh /
by the caller generating into two dirs and comparing hashes (see
results/gen_check/). This script itself never reads a clock or RNG source.

Usage: T1VENV/Scripts/python.exe gen_corpus_ext.py <outdir>
"""
import json
import sys
from pathlib import Path

import img2pdf
import pypdf
import pypdfium2 as pdfium
from PIL import Image

T1 = Path(__file__).resolve().parents[2] / "docling-proto"
SCALE = 200 / 72.0  # 200 dpi rasterization for hybrid scans


def rotate_pdf(src: Path, dst: Path, angle: int) -> None:
    reader = pypdf.PdfReader(str(src))
    writer = pypdf.PdfWriter()
    for page in reader.pages:
        page.rotate(angle)
        writer.add_page(page)
    # strip dates/ids that pypdf might stamp
    if writer.metadata is not None:
        writer.add_metadata({})
    with open(dst, "wb") as fh:
        writer.write(fh)


def rasterize_rotate_build(src: Path, dst: Path, pages: list[int], angle: int) -> None:
    """Render pages at 200 dpi, rotate the bitmap by `angle`, wrap as image-only PDF."""
    pdf = pdfium.PdfDocument(str(src))
    imgs = []
    for pno in pages:
        page = pdf[pno]
        bitmap = page.render(scale=SCALE)
        pil = bitmap.to_pil().convert("RGB")
        imgs.append(pil.rotate(angle, expand=True))
        page.close()
    pdf.close()
    # Single-page img2pdf output is byte-deterministic but its multi-image
    # container is not (xref/dict order); build one PDF per page, merge with
    # pypdf -> byte-deterministic container (verified by two-run compare).
    import io
    merged = pypdf.PdfWriter()
    for im in imgs:
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        single = img2pdf.convert([buf.getvalue()])
        merged.append(pypdf.PdfReader(io.BytesIO(single)))
    with open(dst, "wb") as fh:
        merged.write(fh)


def main(outdir: Path) -> None:
    outdir.mkdir(parents=True, exist_ok=True)
    t1_manifest = json.loads((T1 / "corpus" / "manifest.json").read_text(encoding="utf-8"))
    by_id = {d["docId"]: d for d in t1_manifest["docs"]}

    jobs = [
        # (src file, out name, kind, angle, pages-for-scan, source docId, page filter)
        ("sc-hafen-logbuch.pdf", "rot-sc-hafen-logbuch-180.pdf", "rotate", 180, None, "sc-hafen-logbuch", None),
        ("tc-wochenbericht.pdf", "rot-tc-wochenbericht-270.pdf", "rotate", 270, None, "tc-wochenbericht", None),
        ("tb-messreihe.pdf", "rot-tb-messreihe-90.pdf", "rotate", 90, None, "tb-messreihe", None),
        ("sc-observatorium-notiz.pdf", "rscan-sc-observatorium-90.pdf", "rotscan", 90, [0, 1], "sc-observatorium-notiz", [1, 2]),
        ("tb-lieferschwelle.pdf", "rscan-tb-lieferschwelle-90.pdf", "rotscan", 90, [1], "tb-lieferschwelle", [2]),
    ]
    out_docs = []
    for src_name, out_name, kind, angle, scan_pages, src_id, page_filter in jobs:
        src = T1 / "corpus" / src_name
        dst = outdir / out_name
        if kind == "rotate":
            rotate_pdf(src, dst, angle)
        else:
            rasterize_rotate_build(src, dst, scan_pages, angle)
        d = by_id[src_id]
        expected = [p for p in d["expectedPhrases"] if page_filter is None or p["page"] in page_filter]
        tables = [t for t in d.get("tables", []) if page_filter is None or t["page"] in page_filter]
        entry = {
            "docId": Path(out_name).stem,
            "fileName": out_name,
            "derivedFrom": src_name,
            "class": f"{kind}-{angle}",
            "pages": len(scan_pages) if scan_pages else d["pages"],
            "expectedPhrases": expected,
        }
        if tables:
            entry["tables"] = tables
        out_docs.append(entry)
        print(f"wrote {out_name} ({kind} {angle}) {dst.stat().st_size} bytes")

    (outdir / "manifest_ext_synth.json").write_text(
        json.dumps({"docs": out_docs}, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"manifest_ext_synth.json with {len(out_docs)} docs")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "corpus"))
