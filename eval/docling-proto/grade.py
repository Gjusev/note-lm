"""T1 grader - computes all metrics in results/grades.json from raw results.

Usage: .venv/Scripts/python.exe grade.py
Inputs: corpus/manifest.json, results/baseline_results.json,
        results/docling_results_run1.json, results/docling_results_run2.json.
Every number in t1-report.md traces to grades.json (and through it to the raw
per-tool JSONs).
"""
import difflib
import json
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent
norm = lambda s: " ".join((s or "").split()).lower()


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def baseline_units(doc):
    """pdf-parse units: one per page, text only, page-level granularity."""
    return [
        {"kind": "page", "text": t, "page": i + 1}
        for i, t in enumerate(doc.get("pages_text") or [])
    ]


def unit_texts_stream(units):
    return [norm(u.get("text")) for u in units if u.get("text")]


def match_phrases(expected, units):
    """Returns per-phrase match info. Item-level anchor preferred over page-level."""
    page_join = {}
    for u in units:
        if u.get("text"):
            page_join.setdefault(u["page"], []).append(norm(u["text"]))
    out = []
    for e in expected:
        needle = norm(e["text"])
        hit = None
        for u in units:  # stream order = first occurrence
            if u.get("text") and needle in norm(u["text"]):
                hit = {"page": u["page"], "level": "item"}
                break
        if hit is None:  # split across units: page-level match only
            for p in sorted(page_join):
                if needle in " ".join(page_join[p]):
                    hit = {"page": p, "level": "page"}
                    break
        out.append({
            "text": e["text"],
            "expected_page": e["page"],
            "found": hit is not None,
            "anchor_page": hit["page"] if hit else None,
            "anchor_level": hit["level"] if hit else None,
            "anchor_ok": bool(hit and hit["page"] == e["page"]),
        })
    return out


def order_check(entry, units):
    ro = entry.get("readingOrder")
    if not ro:
        return None
    joined = " ".join(unit_texts_stream(units))
    pos = lambda t: joined.find(t.lower())
    lpos = [pos(t) for t in ro["left"]]
    rpos = [pos(t) for t in ro["right"]]
    missing = [t for t, p in list(zip(ro["left"], lpos)) + list(zip(ro["right"], rpos)) if p < 0]
    interleaved = sum(
        1 for i in range(min(len(lpos), len(rpos))) if lpos[i] < rpos[i]
    )
    return {
        "missing_tokens": missing,
        "pass": not missing and max(lpos) < min(rpos),
        "left_before_right_pairs": interleaved,
        "pairs": min(len(lpos), len(rpos)),
    }


def table_check(entry, units):
    tables = [u for u in units if u.get("kind") in ("table", "TableItem")]
    res = []
    for exp in entry.get("tables", []):
        cand = [
            t for t in tables
            if t.get("page") == exp["page"]
            and t.get("rows") == exp["rows"]
            and t.get("cols") == exp["cols"]
        ]
        grid = cand[0]["grid"] if cand else []
        flat = [norm(c) for row in grid for c in row]
        total = found = 0
        for row in exp["cells"]:
            for cell in row:
                total += 1
                s = norm(cell)
                if any(s == g or (s in g and len(s) >= 3) for g in flat):
                    found += 1
        res.append({
            "page": exp["page"],
            "dims_ok": bool(cand),
            "cells_found": found,
            "cells_total": total,
            "recovery": round(found / total, 4) if total else None,
            "table_pass": bool(cand) and found / total >= 0.90,
        })
    return res


def char_similarity(entry, units):
    if not entry.get("referenceParas"):
        return None
    ref = norm(" ".join(entry["referenceParas"]))
    ext = norm(" ".join(unit_texts_stream(units)))
    return round(difflib.SequenceMatcher(None, ref, ext).ratio(), 4)


def bbox_ok(bbox, size):
    if not bbox or not size:
        return None  # cannot judge -> not counted as invented, counted separately
    l, t, r, b = bbox
    w, h = size
    toly = 2.0
    return (0 - toly) <= l < r <= (w + toly) and (0 - toly) <= t < b <= (h + toly)


def invented_count(entry, units, page_sizes):
    invented = missing_prov = 0
    for u in units:
        p = u.get("page")
        if p is None:
            missing_prov += 1
            continue
        ok = bbox_ok(u.get("bbox"), page_sizes.get(p))
        if ok is False:
            invented += 1
    return {"invented": invented, "prov_missing": missing_prov}


def phrase_recall(detail):
    found = sum(1 for d in detail if d["found"])
    total = len(detail)
    return found, total, round(found / total, 4) if total else None


def _recall_text_pages(entry, det):
    """Recall over phrases on pages that have a digital text layer
    (excludes ocrOnlyPages). C1 scope per criteria: 'phrase recall >= 0.98
    on every SC/MX text page'; MX page 3 (image-only) grades under OCR
    reporting, not C1."""
    pairs = [
        (e, d) for e, d in zip(entry["expectedPhrases"], det)
        if e["page"] not in entry.get("ocrOnlyPages", [])
    ]
    total = len(pairs)
    if not total:
        return None
    found = sum(1 for _e, d in pairs if d["found"])
    return round(found / total, 4)


def main():
    manifest = load(HERE / "corpus" / "manifest.json")
    baseline = load(HERE / "results" / "baseline_results.json")
    run1 = load(HERE / "results" / "docling_results_run1.json")
    run2 = load(HERE / "results" / "docling_results_run2.json")

    grades = {
        "criteria": "t1-criteria.md (fixed before measurement)",
        "tools": {"baseline": baseline["tool"], "docling": run2["tool"]},
        "per_doc": {},
        "class_summary": {},
        "gates": {},
    }

    for entry in manifest["docs"]:
        f = entry["fileName"]
        bdoc = baseline["docs"].get(f, {})
        ddoc = run2["docs"].get(f, {})
        bunits = baseline_units(bdoc)
        dunits = ddoc.get("units", [])
        page_sizes = run2.get("page_sizes", {}).get(f, {})

        row = {"class": entry["class"]}
        for tool, units in (("baseline", bunits), ("docling", dunits)):
            det = match_phrases(entry["expectedPhrases"], units)
            found, total, recall = phrase_recall(det)
            sn_expected = (
                entry["expectedPhrases"]
                if entry.get("ocrOnly")
                else [e for e in entry["expectedPhrases"] if e["page"] in entry.get("ocrOnlyPages", [])]
            )
            ocr = None
            if entry.get("ocrOnly"):
                ocr = recall
            tool_res = {
                "phrases": {"found": found, "total": total, "recall": recall},
                # text-page-only recall (excludes OCR-only pages; C1 scope)
                "recall_text_pages": _recall_text_pages(entry, det),
                "detail": det,
                "anchor_precision": (
                    round(sum(1 for d in det if d["anchor_ok"]) /
                          max(1, sum(1 for d in det if d["found"])), 4)
                ),
                "order": order_check(entry, units),
                "tables": table_check(entry, units),
                "char_similarity": char_similarity(entry, units),
                "ocr_recall": ocr,
                "wall_ms": bdoc.get("wall_ms") if tool == "baseline" else ddoc.get("wall_ms"),
            }
            if tool == "docling":
                tool_res["invented"] = invented_count(entry, dunits, page_sizes)
            row[tool] = tool_res
        grades["per_doc"][f] = row

    # ---------------------------------------------------------- class summary
    cls = {}
    for f, row in grades["per_doc"].items():
        c = row["class"]
        s = cls.setdefault(c, {"docs": 0})
        s["docs"] += 1
        for tool in ("baseline", "docling"):
            for k in ("recall", "anchor_precision"):
                s.setdefault(f"{tool}_{k}", []).append(row[tool]["phrases"][k] if k == "recall" else row[tool]["anchor_precision"])
            o = row[tool]["order"]
            if o is not None:
                s[f"{tool}_order_pass"] = s.get(f"{tool}_order_pass", 0) + (1 if o["pass"] else 0)
            for t in row[tool]["tables"]:
                s[f"{tool}_table_pass"] = s.get(f"{tool}_table_pass", 0) + (1 if t["table_pass"] else 0)
                s[f"{tool}_table_dims_ok"] = s.get(f"{tool}_table_dims_ok", 0) + (1 if t["dims_ok"] else 0)
                s[f"{tool}_table_cells"] = s.get(f"{tool}_table_cells", [0, 0])
                s[f"{tool}_table_cells"][0] += t["cells_found"]
                s[f"{tool}_table_cells"][1] += t["cells_total"]
            if row[tool]["ocr_recall"] is not None:
                s[f"{tool}_ocr"] = row[tool]["ocr_recall"]
            cs = row[tool]["char_similarity"]
            if cs is not None:
                s[f"{tool}_char_similarity"] = cs
    for c, s in cls.items():
        for tool in ("baseline", "docling"):
            for k in ("recall", "anchor_precision"):
                if f"{tool}_{k}" in s:
                    s[f"{tool}_{k}"] = round(statistics.mean(s[f"{tool}_{k}"]), 4)
        grades["class_summary"][c] = s

    # ----------------------------------------------------------------- gates
    pd = grades["per_doc"]
    text_classes = ("single-column", "mixed")
    c1_docs = [f for f, r in pd.items() if r["class"] in text_classes]
    c1_all = all(pd[f]["docling"]["recall_text_pages"] >= 0.98 for f in c1_docs)
    c1_regr = {
        f: round(pd[f]["baseline"]["recall_text_pages"] - pd[f]["docling"]["recall_text_pages"], 4)
        for f in c1_docs
    }
    c1_no_regression = all(v <= 0.01 for v in c1_regr.values())
    grades["gates"]["C1_text_fidelity"] = {
        "rule": "phrase recall >= 0.98 on every SC/MX text page AND no regression vs baseline > 1 pp",
        "per_doc_recall_docling": {f: pd[f]["docling"]["recall_text_pages"] for f in c1_docs},
        "per_doc_regression_vs_baseline": c1_regr,
        "pass": c1_all and c1_no_regression,
    }

    tc = [f for f, r in pd.items() if r["class"] == "two-column"]
    grades["gates"]["C2_reading_order"] = {
        "rule": "all left sentinels before all right sentinels, both TC docs (docling)",
        "per_doc": {f: pd[f]["docling"]["order"] for f in tc},
        "baseline_reference": {f: pd[f]["baseline"]["order"] for f in tc},
        "pass": all(pd[f]["docling"]["order"]["pass"] for f in tc),
    }

    tb = [f for f, r in pd.items() if r["class"] == "table"]
    grades["gates"]["C3_tables"] = {
        "rule": "both TB fixtures: grid dims exact AND cell recovery >= 0.90 (docling)",
        "per_doc": {f: pd[f]["docling"]["tables"] for f in tb},
        "baseline_reference": {f: pd[f]["baseline"]["tables"] for f in tb},
        "pass": all(t["table_pass"] for f in tb for t in pd[f]["docling"]["tables"]),
    }

    sn = [f for f, r in pd.items() if r["class"] == "scan-ocr"]
    grades["gates"]["C4_ocr"] = {
        "rule": "phrase recall >= 0.90 on scan fixture (docling OCR)",
        "recall": pd[sn[0]]["docling"]["phrases"]["recall"] if sn else None,
        "baseline_reference": pd[sn[0]]["baseline"]["phrases"]["recall"] if sn else None,
        "pass": bool(sn) and pd[sn[0]]["docling"]["phrases"]["recall"] >= 0.90,
    }

    anchor_ok = all(r["docling"]["anchor_precision"] == 1.0 for r in pd.values())
    invented = sum(r["docling"]["invented"]["invented"] for r in pd.values())
    prov_missing = sum(r["docling"]["invented"]["prov_missing"] for r in pd.values())
    grades["gates"]["C5_anchors"] = {
        "rule": "matched quote->page precision 100%, invented regions = 0 (docling)",
        "anchor_precision": {f: r["docling"]["anchor_precision"] for f, r in pd.items()},
        "invented_regions": invented,
        "prov_missing": prov_missing,
        "baseline_page_precision": {f: r["baseline"]["anchor_precision"] for f, r in pd.items()},
        "pass": anchor_ok and invented == 0,
    }

    walls = [r["docling"]["wall_ms"] for r in pd.values() if r["docling"]["wall_ms"]]
    grades["gates"]["C6_time"] = {
        "rule": "median wall <= 60 s/doc (docling, run2 steady state)",
        "median_s": round(statistics.median(walls) / 1000, 2) if walls else None,
        "per_doc_s": {f: round(r["docling"]["wall_ms"] / 1000, 2) for f, r in pd.items()},
        "pass": bool(walls) and statistics.median(walls) / 1000 <= 60,
    }

    peak = run2["peak_rss_mb"]
    grades["gates"]["C7_ram"] = {
        "rule": "peak working set <= 8 GB",
        "peak_mb": peak,
        "pass": peak <= 8192,
    }

    dist = load(HERE / "results" / "distribution_cost.json")
    warm = [r["docling"]["wall_ms"] for i, (f, r) in enumerate(pd.items()) if i > 0 and r["docling"]["wall_ms"]]
    warm_med = statistics.median(warm) / 1000 if warm else None
    grades["gates"]["C8_managed_runtime"] = {
        "rule": "venv + weights <= 2 GB, OCR backend pip-only, cold start <= 120 s, warm <= 10 s/doc",
        **dist,
        "cold_start_s_run2": round(run2["first_doc_ms"] / 1000, 2),
        "first_run_incl_download_s_run1": round(run1["first_doc_ms"] / 1000, 2),
        "warm_median_s": round(warm_med, 2) if warm_med else None,
        "ocr_backend": run2["pipeline"]["ocr_backend"],
        "ocr_backend_external_binary": run2["pipeline"]["ocr_needs_system_binary"],
        "pass": (
            dist["venv_mb"] + dist["weights_mb"] <= 2048
            and not run2["pipeline"]["ocr_needs_system_binary"]
            and run2["first_doc_ms"] / 1000 <= 120
            and warm_med is not None and warm_med <= 10
        ),
    }

    # -------------------------------------------------------------- decision
    g = {k: v["pass"] for k, v in grades["gates"].items()}
    quality = ["C1_text_fidelity", "C2_reading_order", "C3_tables", "C4_ocr"]
    hard = ["C5_anchors", "C7_ram", "C8_managed_runtime"]
    if all(g.values()):
        decision = "ADOPT"
        driver = "all gates C1-C8 pass"
    elif all(g[k] for k in hard) and any(g[k] for k in quality):
        passed_classes = [c for c, gate in zip(
            ["SC/MX", "TC", "TB", "SN"],
            [g["C1_text_fidelity"], g["C2_reading_order"], g["C3_tables"], g["C4_ocr"]],
        ) if gate]
        decision = "SCOPE TO DOC CLASSES"
        driver = f"hard gates pass; quality gates pass on {passed_classes}"
    else:
        failed_hard = [k for k in hard if not g[k]]
        decision = "DEFER"
        driver = f"hard gate(s) failed: {failed_hard}" if failed_hard else \
            "no quality gate passed and hard-gate structure not met"
    grades["decision"] = {"outcome": decision, "driving_criterion": driver, "gate_values": g}

    (HERE / "results" / "grades.json").write_text(
        json.dumps(grades, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(grades["decision"], indent=2, ensure_ascii=False))
    print("wrote results/grades.json")


if __name__ == "__main__":
    main()
