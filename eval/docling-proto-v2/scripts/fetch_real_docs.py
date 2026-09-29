"""T5 corpus extension, part 2: genuinely external real-world open-license PDFs.

Downloads (with recorded sha256) and extracts deterministic page subsets:
  real-attn-arxiv.pdf   <- arXiv 1705.10311 (Attention Is All You Need) pages with
                          Table 1 + Table 2 captions (two-column paper, real tables).
  real-docling-tr.pdf   <- arXiv 2408.09869 (Docling Technical Report) page(s)
                          with Table 1 caption.
  real-bookscan.pdf     <- Wikimedia Commons scan "The old yellow book..." (PD),
                          fixed pages (title page + a body page).

License basis: arXiv non-exclusive distribution license (redistributable);
Wikimedia Commons public-domain scan. Shipping-license review remains a
separate adoption step (strategy §3), unchanged from T1.

Also renders preview PNGs of the chosen pages into <outdir>/previews/ for
ground-truth transcription.

Determinism: URL + page-selection rule fixed; subset extraction via pypdf is
byte-deterministic given identical source (re-running with the cached source
reproduces identical subsets; verified by the caller's hash check).

Usage: T1VENV/Scripts/python.exe fetch_real_docs.py <outdir>
"""
import hashlib
import json
import sys
from pathlib import Path

import pypdf
import pypdfium2 as pdfium

SOURCES = [
    {
        "docId": "real-attn-arxiv",
        "url": "https://arxiv.org/pdf/1706.03762",
        "out": "real-attn-arxiv.pdf",
        "select": "table-captions",  # pages containing 'Table 1:'/'Table 2:'
        "captions": ["Table 1:", "Table 2:"],
    },
    {
        "docId": "real-docling-tr",
        "url": "https://arxiv.org/pdf/2408.09869",
        "out": "real-docling-tr.pdf",
        "select": "table-captions",
        "captions": ["Table 1:", "Table 2:"],
    },
    {
        "docId": "real-bookscan",
        "url": "https://upload.wikimedia.org/wikipedia/commons/e/e1/The_old_yellow_book%2C_source_of_Browning%27s_The_ring_and_the_book.._%28IA_oldyellowbooksou00np%29.pdf",
        "out": "real-bookscan.pdf",
        "select": "fixed-pages",
        "pages0": [20, 129],  # chosen from preview: title page (ink 11%) + body page (ink 14%)
        "strip_text_variant": True,
    },
]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def pick_pages(src: Path, spec) -> list[int]:
    if spec["select"] == "fixed-pages":
        return spec["pages0"]
    pdf = pdfium.PdfDocument(str(src))
    found: dict[str, int] = {}
    for i in range(len(pdf)):
        text = pdf[i].get_textpage().get_text_bounded()
        for cap in spec["captions"]:
            if cap in text and cap not in found:
                found[cap] = i
    pdf.close()
    return sorted(set(found.values()))


def main(outdir: Path) -> None:
    cache = outdir / "_sources"
    cache.mkdir(parents=True, exist_ok=True)
    (outdir / "previews").mkdir(exist_ok=True)
    meta = []
    for spec in SOURCES:
        raw = cache / (spec["docId"] + ".download.pdf")
        if not raw.exists():
            import urllib.request
            req = urllib.request.Request(spec["url"], headers={"User-Agent": "note-lm-eval/1.0"})
            with urllib.request.urlopen(req, timeout=300) as resp, open(raw, "wb") as fh:
                fh.write(resp.read())
        pages0 = pick_pages(raw, spec)
        reader = pypdf.PdfReader(str(raw))
        writer = pypdf.PdfWriter()
        for i in pages0:
            writer.add_page(reader.pages[i])
        if writer.metadata is not None:
            writer.add_metadata({})
        out = outdir / spec["out"]
        with open(out, "wb") as fh:
            writer.write(fh)
        # previews for transcription (page index -> png)
        pdf = pdfium.PdfDocument(str(out))
        for i in range(len(pdf)):
            bmp = pdf[i].render(scale=150 / 72.0)
            bmp.to_pil().convert("RGB").save(outdir / "previews" / f"{spec['docId']}-p{i+1}.png")
        pdf.close()
        # text-layer-stripped variant for scan docs (the Commons scan carries an
        # embedded Internet-Archive OCR text layer; without stripping, docling
        # reads that layer and our RapidOCR is never exercised). Rebuild the
        # pages as image-only PDFs from the REAL scan raster at 300 dpi.
        if spec.get("strip_text_variant"):
            import io
            import img2pdf
            from PIL import Image
            pdf = pdfium.PdfDocument(str(raw))
            merged = pypdf.PdfWriter()
            for i in pages0:
                pil = pdf[i].render(scale=300 / 72.0).to_pil().convert("RGB")
                buf = io.BytesIO()
                pil.save(buf, format="PNG")
                merged.append(pypdf.PdfReader(io.BytesIO(img2pdf.convert([buf.getvalue()]))))
            pdf.close()
            out_nt = outdir / (Path(spec["out"]).stem + "-notext.pdf")
            with open(out_nt, "wb") as fh:
                merged.write(fh)
            meta.append({
                "docId": spec["docId"] + "-notext", "derived_from": spec["out"],
                "derived_sha256": sha256(out_nt), "derived_bytes": out_nt.stat().st_size,
                "note": "image-only rebuild of the real scan raster at 300 dpi; no text layer; deterministic given source",
            })
        meta.append({
            "docId": spec["docId"], "url": spec["url"], "source_sha256": sha256(raw),
            "source_bytes": raw.stat().st_size, "source_pages": len(reader.pages),
            "selected_pages_1based": [i + 1 for i in pages0],
            "derived_sha256": sha256(out), "derived_bytes": out.stat().st_size,
        })
        print(f"{spec['docId']}: src {raw.stat().st_size} B, pages(1-based) {[i+1 for i in pages0]}, out {out.stat().st_size} B")
    (outdir / "real_sources.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "corpus"))
