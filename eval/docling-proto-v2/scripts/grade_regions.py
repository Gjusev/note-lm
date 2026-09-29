"""T5 region correspondence: IoU of docling prov bboxes vs text-layer ground
truth, plus saved overlay PNG artifacts.

Method (pre-registered in t5-criteria.md):
- GT box for an expected phrase = union of its char boxes on the page
  (pypdfium2 text page), PDF points, bottom-left origin.
- Docling box = prov bbox of the matching item (same coordinate space for
  unrotated pages). Match = docling item whose whitespace/case-normalized
  text contains the phrase; if several match, the max-IoU one (best case).
- IoU in PDF-point space. Rotated (/Rotate) docs: docling reports the ROTATED
  visual space, so GT boxes are transformed into that space first; if the
  transform validates poorly (median IoU ~0 with boxes off-page), the doc is
  reported non-comparable with the reason (coordinate-convention mismatch),
  never silently dropped.
- Overlays: page rendered via pypdfium2; docling bboxes red, GT boxes green.

Writes results/region_iou.json + overlays/*.png
"""
import json
import re
import sys
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
V2 = HERE.parent
T1 = V2.parent / "docling-proto"
RESULTS = V2 / "results"
OVERLAYS = V2 / "overlays"
RENDER_SCALE = 150 / 72.0


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().casefold()


def span_regex(phrase: str) -> re.Pattern:
    toks = [re.escape(t) for t in phrase.split()]
    return re.compile(r"\s+".join(toks), re.IGNORECASE)


def gt_boxes_for_page(tp, page_w, page_h):
    """phrase -> union charbox, computed lazily per phrase by the caller."""
    return tp


def phrase_gt_box(tp, phrase: str):
    text = tp.get_text_bounded()
    m = span_regex(phrase).search(text)
    if not m:
        return None
    l = b_ = r = t = None
    for i in range(m.start(), m.end()):
        cl, cb, cr, ct = tp.get_charbox(i)
        l = cl if l is None else min(l, cl)
        b_ = cb if b_ is None else min(b_, cb)
        r = cr if r is None else max(r, cr)
        t = ct if t is None else max(t, ct)
    return (l, b_, r, t)


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix
    return ix / ua if ua > 0 else 0.0


def containment(small, big):
    """fraction of `small`'s area inside `big` (1.0 = fully contained)"""
    ix = max(0, min(small[2], big[2]) - max(small[0], big[0])) * max(0, min(small[3], big[3]) - max(small[1], big[1]))
    a = (small[2] - small[0]) * (small[3] - small[1])
    return ix / a if a > 0 else 0.0


def rotate_box(box, rot: int, W: float, H: float):
    """PDF-space box (l,b,r,t) -> rotated visual space (bottom-left origin).
    rot = /Rotate value = clockwise display rotation. Point maps:
      90:  (x, y) -> (y, W - x)      visual page is H wide, W tall
      180: (x, y) -> (W - x, H - y)
      270: (x, y) -> (H - y, x)      visual page is H wide, W tall
    """
    l, b_, r, t = box
    if rot == 0:
        return (l, b_, r, t)
    if rot == 90:
        return (b_, W - r, t, W - l)
    if rot == 180:
        return (W - r, H - t, W - l, H - b_)
    if rot == 270:
        return (H - t, l, H - b_, r)
    raise ValueError(rot)


def load_manifests():
    docs = []
    m1 = json.loads((T1 / "corpus" / "manifest.json").read_text(encoding="utf-8"))
    for d in m1["docs"]:
        docs.append({**d, "source_dir": str(T1 / "corpus"), "rotation_capable": True})
    m2 = json.loads((V2 / "corpus" / "manifest_ext_synth.json").read_text(encoding="utf-8"))
    for d in m2["docs"]:
        docs.append({**d, "source_dir": str(V2 / "corpus"), "rotation_capable": True})
    m3 = json.loads((V2 / "corpus" / "manifest_ext_real.json").read_text(encoding="utf-8"))
    for d in m3["docs"]:
        docs.append({**d, "source_dir": str(V2 / "corpus"), "rotation_capable": True})
    return docs


def main():
    run = json.loads((RESULTS / "curated_run.json").read_text(encoding="utf-8"))
    run_docs = {v.get("docId"): v for v in run["docs"].values() if "docId" in v}
    OUT = {"per_doc": {}, "method": "IoU(docling prov bbox, text-layer charbox union) in PDF points; max-IoU matching item"}
    all_ious = {}
    all_block_ious = {}
    OVERLAYS.mkdir(exist_ok=True)

    for entry in load_manifests():
        docId = entry["docId"]
        rd = run_docs.get(docId)
        if not rd or "units_data" not in rd:
            OUT["per_doc"][docId] = {"error": "no run result"}
            continue
        pdf_path = Path(entry["source_dir"]) / entry["fileName"]
        pdf = pdfium.PdfDocument(str(pdf_path))
        doc_ious = []
        overlay_pages = {}
        rot_class = entry.get("class", "")
        is_rot = rot_class.startswith("rotate")
        npages = len(pdf)
        for p in entry.get("expectedPhrases", []):
            if p["page"] > npages:
                continue
            pno = p["page"] - 1
            page = pdf[pno]
            tp = page.get_textpage()
            gt = phrase_gt_box(tp, p["text"])
            W, H = page.get_size()  # DISPLAY size (after /Rotate)
            rot = int(page.get_rotation())  # pypdfium2 returns degrees
            # unrotated PDF-space dims: get_size() already swapped for 90/270
            W0, H0 = (H, W) if rot in (90, 270) else (W, H)
            if gt is None:
                continue  # scan pages have no text layer -> not comparable
            if rot != 0:
                gt = rotate_box(gt, rot, W0, H0)
            phrase_n = norm(p["text"])
            best = None
            for u in rd["units_data"]:
                if u.get("page") != p["page"] or not u.get("bbox") or not u.get("text"):
                    continue
                if phrase_n not in norm(u["text"]):
                    continue
                db = (u["bbox"][0], u["bbox"][3], u["bbox"][2], u["bbox"][1])  # l,b,r,t
                v = iou(db, gt)
                c = containment(gt, db)
                if best is None or v > best[0]:
                    best = (v, c, db, u)
            if best:
                doc_ious.append({"phrase": p["text"][:50], "iou": round(best[0], 4),
                                 "containment": round(best[1], 4),
                                 "item": best[3]["kind"]})
                overlay_pages.setdefault(pno, []).append((gt, best[2]))
        # ---- metric B (supplementary, mandate-intent): block-level IoU.
        # For each docling text item, locate the item's own leading text in
        # the page text layer; IoU(item bbox, span box). This compares
        # docling's claimed region for a block against where that block's
        # text actually is -- granularity-matched, unlike metric A.
        block_ious = []
        for pno_s, (dw, dh) in (rd.get("page_sizes") or {}).items():
            pno = int(pno_s) - 1
            page = pdf[pno]
            W, H = page.get_size()  # display size
            rot = int(page.get_rotation())
            W0, H0 = (H, W) if rot in (90, 270) else (W, H)
            tp = page.get_textpage()
            ttext = tp.get_text_bounded()
            for u in rd["units_data"]:
                if u.get("page") != int(pno_s) or not u.get("bbox") or not u.get("text"):
                    continue
                if u["kind"] not in ("TextItem", "SectionItem", "TitleItem", "ListItem"):
                    continue
                anchor = norm(u["text"]).strip()
                if len(anchor) < 12:
                    continue
                toks = [re.escape(t) for t in anchor.split()]
                # full-text span first; fall back to leading tokens if the
                # full sequence does not regex-match the text layer
                for take in (len(toks), 12):
                    m = re.compile(r"\s+".join(toks[:take]), re.IGNORECASE).search(ttext)
                    if m:
                        break
                if not m:
                    continue
                l = b_ = r = t = None
                for i in range(m.start(), m.end()):
                    cl, cb, cr, ct = tp.get_charbox(i)
                    l = cl if l is None else min(l, cl)
                    b_ = cb if b_ is None else min(b_, cb)
                    r = cr if r is None else max(r, cr)
                    t = ct if t is None else max(t, ct)
                span = (l, b_, r, t)
                if rot != 0:
                    span = rotate_box(span, rot, W0, H0)
                db = (u["bbox"][0], u["bbox"][3], u["bbox"][2], u["bbox"][1])
                block_ious.append({"item": u["kind"], "iou": round(iou(db, span), 4),
                                   "containment_of_span": round(containment(span, db), 4)})

        # render overlays for pages that had comparable blocks (all of them here)
        for pno, boxes in overlay_pages.items():
            page = pdf[pno]
            W, H = page.get_size()
            bmp = page.render(scale=RENDER_SCALE)
            im = bmp.to_pil().convert("RGB")
            draw = ImageDraw.Draw(im)
            # docling/docling-visual space: page height used by docling
            dw, dh = rd["page_sizes"][str(pno + 1)] or (W, H)
            sx = im.width / dw
            sy = im.height / dh
            for gt, db in boxes:
                for box, color in ((db, (255, 0, 0)), (gt, (0, 200, 0))):
                    l, b_, r, t = box
                    draw.rectangle([l * sx, (dh - t) * sy, r * sx, (dh - b_) * sy],
                                   outline=color, width=3)
            im.save(OVERLAYS / f"{docId}-p{pno + 1}.png")
        pdf.close()
        ious = [d["iou"] for d in doc_ious]
        ious.sort()
        med = ious[len(ious) // 2] if ious else None
        bious = sorted(d["iou"] for d in block_ious)
        bmed = bious[len(bious) // 2] if bious else None
        cons = sorted(d["containment"] for d in doc_ious)
        OUT["per_doc"][docId] = {
            "class": entry.get("class"),
            "comparable_blocks": len(ious),
            "median_iou": med,
            "median_containment": cons[len(cons) // 2] if cons else None,
            "min_iou": ious[0] if ious else None,
            "max_iou": ious[-1] if ious else None,
            "block_level": {
                "n": len(bious),
                "median_iou": bmed,
                "p25": bious[len(bious) // 4] if bious else None,
                "min": bious[0] if bious else None,
            },
            "detail": doc_ious,
        }
        all_ious[docId] = ious
        all_block_ious[docId] = [d["iou"] for d in block_ious]
        print(f"{docId:<32} n={len(ious):>2} medianA={med} medianB={bmed}")

    # aggregates per class group
    def grp(did):
        if did.startswith("real-"):
            return "real"
        if did.startswith("rot") or did.startswith("rscan"):
            return "rotated"
        return "t1-synth"

    def stats(vals):
        vals = sorted(vals)
        if not vals:
            return None
        return {"n": len(vals), "median": vals[len(vals) // 2],
                "p25": vals[len(vals) // 4], "min": vals[0]}

    OUT["aggregate_metric_A_phrase_level"] = {
        g: stats(v for did, xs in all_ious.items() if grp(did) == g for v in xs)
        for g in ("t1-synth", "real", "rotated")
    }
    OUT["aggregate_metric_B_block_level"] = {
        g: stats(v for did, xs in all_block_ious.items() if grp(did) == g for v in xs)
        for g in ("t1-synth", "real", "rotated")
    }
    OUT["aggregate_containment_A"] = {
        g: stats(d["containment"] for did, pd in OUT["per_doc"].items() if grp(did) == g
                 for d in pd.get("detail", []))
        for g in ("t1-synth", "real", "rotated")
    }
    (RESULTS / "region_iou.json").write_text(json.dumps(OUT, indent=1, ensure_ascii=False), encoding="utf-8")
    print("A phrase-level:", json.dumps(OUT["aggregate_metric_A_phrase_level"]))
    print("B block-level :", json.dumps(OUT["aggregate_metric_B_block_level"]))
    print("containment   :", json.dumps(OUT["aggregate_containment_A"]))


if __name__ == "__main__":
    main()
