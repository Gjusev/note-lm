"""T5 quality grader: text fidelity, tables, OCR, rotation, column order.

Cell normalization (documented, applied to both expected and extracted):
NFKC -> casefold -> map unicode superscripts to digits -> strip ALL
whitespace -> unify middle-dot variants to '.', drop '^', drop '{','}'.
(Differences of superscript typography must not count as content errors;
missing exponents do.)

Column order (G7): for tc-* docs, T1's sentinel rule — in the page's
reading-order stream, every left sentinel must appear before every right
sentinel. For real-attn p1: manifest phrases are classified left/right by
their ground-truth x-midpoint vs the page midline (pypdfium2 charboxes),
then the same all-before-all rule on the docling unit stream.

Writes results/quality_grades.json
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

import pypdfium2 as pdfium

HERE = Path(__file__).resolve().parent
V2 = HERE.parent
T1 = V2.parent / "docling-proto"
RESULTS = V2 / "results"

SUP = {"⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5",
       "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9"}


def norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().casefold()


def norm_cell(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    for k, v in SUP.items():
        s = s.replace(k, v)
    s = s.casefold()
    s = re.sub(r"[\s^{}]+", "", s)
    s = s.replace("·", ".").replace("•", ".").replace("*", ".")
    return s


def load_manifests():
    docs = []
    m1 = json.loads((T1 / "corpus" / "manifest.json").read_text(encoding="utf-8"))
    for d in m1["docs"]:
        docs.append({**d, "source_dir": str(T1 / "corpus")})
    for mf in ("manifest_ext_synth.json", "manifest_ext_real.json"):
        m = json.loads((V2 / "corpus" / mf).read_text(encoding="utf-8"))
        for d in m["docs"]:
            docs.append({**d, "source_dir": str(V2 / "corpus")})
    return docs


def page_stream(units, page):
    """reading-order stream of a page = docling iterate_items order filtered"""
    return " ".join(u.get("text") or "" for u in units if u.get("page") == page)


def grade_doc(entry, rd):
    units = rd["units_data"]
    out = {"docId": entry["docId"], "class": entry.get("class")}
    # ---- phrase recall (page-aware)
    hits, total, misses = 0, 0, []
    for p in entry.get("expectedPhrases", []):
        total += 1
        stream = page_stream(units, p["page"])
        if norm_text(p["text"]) in norm_text(stream):
            hits += 1
        else:
            misses.append({"page": p["page"], "text": p["text"][:60]})
    out["phrase_recall"] = round(hits / total, 4) if total else None
    out["phrase_misses"] = misses
    # ---- tables
    tables_out = []
    for t in entry.get("tables", []):
        # best-match table on the page (max exact-cell hits) — same best-case
        # convention as the region matcher; a page may hold several tables
        # and/or fragments
        cands = [u for u in units if u["kind"] == "TableItem" and u.get("page") == t["page"]]
        exp_cells = [norm_cell(c) for row in t["cells"] for c in row if norm_cell(c)]
        found, flat = None, []
        best_hits = -1
        for u in cands:
            fl = [norm_cell(c) for row in u["grid"] for c in row if norm_cell(c)]
            hits = sum(1 for c in exp_cells if c in fl)
            if hits > best_hits:
                best_hits, found, flat = hits, u, fl
        if not found:
            tables_out.append({"page": t["page"], "found": False,
                               "cell_recall": 0.0, "dims": None,
                               "tables_on_page": len(cands)})
            continue
        present = [c for c in exp_cells if c in flat]
        miss_cells = [c for c in exp_cells if c not in flat]
        # substring diagnostic: expected content present inside a cell
        # (real tables carry citations etc. inside cells)
        present_sub = [c for c in exp_cells if any(c in fc for fc in flat)]
        tables_out.append({
            "page": t["page"], "found": True,
            "cell_recall": round(len(present) / len(exp_cells), 4) if exp_cells else None,
            "cell_recall_substring": round(len(present_sub) / len(exp_cells), 4) if exp_cells else None,
            "expected_cells": len(exp_cells),
            "missing_cells": miss_cells,
            "dims_expected": [t["rows"], t["cols"]],
            "dims_found": [found["rows"], found["cols"]],
            "dims_exact": [found["rows"], found["cols"]] == [t["rows"], t["cols"]],
            "tables_on_page": len(cands),
        })
    if tables_out:
        allc = [c for tt in tables_out for c in [tt.get("expected_cells")] if c]
        got = [c for tt in tables_out for c in [tt.get("expected_cells")] if c]
        recall = [tt["cell_recall"] for tt in tables_out if tt.get("cell_recall") is not None]
        out["tables"] = tables_out
        out["table_cell_recall_agg"] = round(sum(recall) / len(recall), 4) if recall else None
    # ---- column order (G7)
    ro = entry.get("readingOrder")
    if ro:
        for page in (1, 2):
            stream = norm_text(page_stream(units, page))
            pos_l = [stream.find(norm_text(s)) for s in ro["left"] if norm_text(s) in stream]
            pos_r = [stream.find(norm_text(s)) for s in ro["right"] if norm_text(s) in stream]
            if pos_l and pos_r:
                ok = max(pos_l) < min(pos_r)
                out[f"column_order_p{page}"] = {
                    "rule": "all left sentinels before all right sentinels",
                    "pass": ok, "left_found": len(pos_l), "right_found": len(pos_r)}
    return out


def grade_real_column_order(entry, rd):
    """real-attn page 1: classify manifest phrases L/R by GT x-midpoint."""
    pdf = pdfium.PdfDocument(str(Path(entry["source_dir"]) / entry["fileName"]))
    page = pdf[0]
    W, _ = page.get_size()
    tp = page.get_textpage()
    ttext = tp.get_text_bounded()
    left, right = [], []
    for p in entry["expectedPhrases"]:
        if p["page"] != 1:
            continue
        toks = [re.escape(t) for t in p["text"].split()]
        m = re.compile(r"\s+".join(toks), re.IGNORECASE).search(ttext)
        if not m:
            continue
        xs = []
        for i in range(*m.span()):
            l, b_, r, t = tp.get_charbox(i)
            xs.append((l + r) / 2)
        mid = sum(xs) / len(xs)
        (left if mid < W / 2 else right).append(norm_text(p["text"]))
    pdf.close()
    if not (left and right):
        return None
    stream = norm_text(page_stream(rd["units_data"], 1))
    pl = [stream.find(s) for s in left if s in stream]
    pr = [stream.find(s) for s in right if s in stream]
    if not (pl and pr):
        return {"left_classified": len(left), "right_classified": len(right),
                "pass": False, "note": "phrases not found in stream"}
    return {"rule": "all left-column phrases before all right-column phrases (p1)",
            "left_classified": len(left), "right_classified": len(right),
            "pass": max(pl) < min(pr)}


def main():
    run = json.loads((RESULTS / "curated_run.json").read_text(encoding="utf-8"))
    run_docs = {v.get("docId"): v for v in run["docs"].values() if "docId" in v}
    grades = []
    for entry in load_manifests():
        rd = run_docs.get(entry["docId"])
        if not rd or "units_data" not in rd:
            grades.append({"docId": entry["docId"], "error": "no run"})
            continue
        g = grade_doc(entry, rd)
        if entry["docId"] == "real-attn-arxiv":
            g["column_order_real"] = grade_real_column_order(entry, rd)
        g["wall_ms"] = rd["wall_ms"]
        grades.append(g)
        tr = g.get("table_cell_recall_agg")
        print(f"{entry['docId']:<28} recall={g['phrase_recall']} tables={tr}")
    (RESULTS / "quality_grades.json").write_text(json.dumps(grades, indent=1, ensure_ascii=False), encoding="utf-8")
    print("wrote quality_grades.json")


if __name__ == "__main__":
    main()
