"""LAYA prototype eval — U1 matrix pre-screening, U2 proposal prioritisation,
U3 query intent. Zero-shot, checkpoint of record: laya-multilingual.

Batched through Router.predict_batch (the engine-realistic shape: many
small decisions share forward passes).

Run (after extract-pages.mts):
    eval/laya-proto/.venv/Scripts/python.exe eval/laya-proto/run_eval.py

Writes results/laya-eval.json + results/run-meta.json and prints a summary.
Reads criteria.md thresholds; the script REPORTS, the criteria DECIDE.
"""
from __future__ import annotations

import json
import re
import statistics
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
RESULTS = HERE / "results"
FUSION = HERE.parent / "fusion-proto" / "corpus"
VP = HERE.parent / "corpus" / "version-pairs-v1"
PAGES_JSON = RESULTS / "pages.json"
OUT_JSON = RESULTS / "laya-eval.json"
META_JSON = RESULTS / "run-meta.json"

MODEL = "laya-multilingual"
HF_REPO = "convaiinnovations/laya"  # laya-multilingual is its "multilingual" subfolder
THRESHOLD = 0.5
BATCH = 128


def hf_revision() -> str | None:
    """Pinned snapshot hash of the checkpoint actually used (from the HF cache)."""
    root = Path.home() / ".cache" / "huggingface" / "hub" / "models--convaiinnovations--laya"
    ref = root / "refs" / "main"
    try:
        return ref.read_text(encoding="utf-8").strip()
    except OSError:
        return None

batch_stats = []  # (n_decisions, seconds)


def load_laya():
    from laya import Router

    return Router(preload=False)


def run_batch(router, requests: list[dict]) -> list[dict]:
    out: list[dict] = []
    for i in range(0, len(requests), BATCH):
        chunk = requests[i : i + BATCH]
        t0 = time.perf_counter()
        out.extend(router.predict_batch(chunk, sort_by_length=True))
        batch_stats.append((len(chunk), time.perf_counter() - t0))
    return out


def noul_prob(result: dict, qid: str = "has_evidence") -> float:
    return float(result["answers"][qid]["noul"])


def pct(n: int, d: int) -> float:
    return round(n / d, 4) if d else 0.0


# ----------------------------------------------------------------- U3 + U1

ROUTE_Q = {
    "route": {
        "type": "choice",
        "instructions": "What kind of research question is this?",
        "criteria": {
            "single-fact": "asks for one specific fact findable in a single document",
            "cross-doc": "asks to compare or relate information across several documents",
            "unanswerable": "cannot be answered from the documents in this corpus at all",
        },
    }
}
EV_Q = {
    "has_evidence": {
        "type": "noul",
        "instructions": "Does this page contain information that answers the question?",
    }
}


def run_intent_and_matrix(router, questions_data: dict, docs: dict) -> dict:
    # --- U3: intent choice (30 requests)
    intent_reqs = [
        {"state": q["question"], "questions": ROUTE_Q, "model": MODEL}
        for q in questions_data["questions"]
    ]
    intent_out = run_batch(router, intent_reqs)
    intent_rows, routing_models = [], {}
    for q, r in zip(questions_data["questions"], intent_out):
        routing_models[q["id"]] = r.get("routing", {}).get("model")
        expected = (
            "unanswerable"
            if q["type"] == "unanswerable"
            else ("single-fact" if q["type"].startswith("mono") else "cross-doc")
        )
        intent_rows.append({
            "id": q["id"], "type": q["type"], "expected": expected,
            "predicted": str(r["answers"]["route"]["choice"]),
            "correct": str(r["answers"]["route"]["choice"]) == expected,
        })

    # --- U1 page-level: every (question, page), batched in one pass
    page_reqs, index = [], []
    for q in questions_data["questions"]:
        for doc_id, doc in docs.items():
            for pg in doc["pages"]:
                index.append((q["id"], doc_id, pg["page"]))
                page_reqs.append({"state": pg["text"], "questions": EV_Q, "model": MODEL})
    page_out = run_batch(router, page_reqs)
    page_rows = []
    for (qid, doc_id, page), r in zip(index, page_out):
        page_rows.append({"qid": qid, "docId": doc_id, "page": page,
                          "prob": noul_prob(r)})
    gold_of = {
        q["id"]: {e["docId"] for e in q.get("expectedEvidence", [])}
        for q in questions_data["questions"]
    }
    for row in page_rows:
        row["label"] = 1 if row["docId"] in gold_of[row["qid"]] else 0

    # --- U1 doc-level on the dev subset (long-input check, max_len=8192)
    doc_reqs, doc_index = [], []
    for q in questions_data["questions"]:
        if q["subset"] != "dev":
            continue
        for doc_id, doc in docs.items():
            full = "\n\n".join(pg["text"] for pg in doc["pages"])
            doc_index.append((q["id"], doc_id))
            doc_reqs.append({"state": full, "questions": EV_Q, "model": MODEL,
                             "max_len": 8192})
    doc_out = run_batch(router, doc_reqs)
    doc_rows = [
        {"qid": qid, "docId": doc_id, "prob": noul_prob(r)}
        for (qid, doc_id), r in zip(doc_index, doc_out)
    ]
    for row in doc_rows:
        row["label"] = 1 if row["docId"] in gold_of[row["qid"]] else 0

    # doc aggregate = max page prob per (question, doc)
    doc_agg = {}
    for row in page_rows:
        key = (row["qid"], row["docId"])
        doc_agg[key] = max(doc_agg.get(key, 0.0), row["prob"])
    doc_agg_rows = [
        {"qid": k[0], "docId": k[1], "prob": v,
         "label": 1 if k[1] in gold_of[k[0]] else 0}
        for k, v in doc_agg.items()
    ]

    return {
        "intent": {
            "rows": intent_rows,
            "accuracy": pct(sum(r["correct"] for r in intent_rows), len(intent_rows)),
            "unanswerable_recall": pct(
                sum(1 for r in intent_rows if r["type"] == "unanswerable" and r["correct"]),
                sum(1 for r in intent_rows if r["type"] == "unanswerable"),
            ),
            "routing_models": routing_models,
        },
        "matrix": {"page_rows": page_rows, "doc_agg": doc_agg_rows, "doc_dev_rows": doc_rows},
    }


def auroc(rows: list[dict]) -> float:
    """Rank-AUC over labelled rows (label 1 = positive)."""
    pos = [r["prob"] for r in rows if r["label"] == 1]
    neg = [r["prob"] for r in rows if r["label"] == 0]
    if not pos or not neg:
        return float("nan")
    wins = sum(1 for p in pos for n in neg if p > n) + 0.5 * sum(
        1 for p in pos for n in neg if p == n
    )
    return round(wins / (len(pos) * len(neg)), 4)


def matrix_metrics(m: dict) -> dict:
    doc_agg = m["doc_agg"]
    qids = sorted({r["qid"] for r in doc_agg})
    r1_hits, r1_total = 0, 0
    for q in qids:
        rows = [r for r in doc_agg if r["qid"] == q]
        if not any(r["label"] == 1 for r in rows):
            continue
        r1_total += 1
        if max(rows, key=lambda r: r["prob"])["label"] == 1:
            r1_hits += 1
    unans = {}
    for q in qids:
        rows = [r for r in doc_agg if r["qid"] == q]
        if rows and all(r["label"] == 0 for r in rows):
            unans[q] = max(r["prob"] for r in rows)
    return {
        "page_auroc": auroc(m["page_rows"]),
        "docdev_auroc": auroc(m["doc_dev_rows"]),
        "recall_at_1": pct(r1_hits, r1_total),
        "recall_at_1_total": r1_total,
        "unanswerable_max_prob": unans,
        "unanswerable_clean": sum(1 for v in unans.values() if v < THRESHOLD),
        "unanswerable_total": len(unans),
    }


# ----------------------------------------------------------------- U2

SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _fact_like(s: str) -> bool:
    """A non-trivial fact sentence: digit-bearing, >=10 words, not corpus boilerplate."""
    return (
        bool(re.search(r"\d", s))
        and len(s.split()) >= 10
        and "corpus" not in s.lower()
    )


def sentences_with_pages(pages: list[dict]) -> list[tuple[int, str]]:
    out = []
    for pg in pages:
        for s in SENT_SPLIT.split(pg["text"].replace("\n", " ").strip()):
            s = s.strip()
            if s:
                out.append((pg["page"], s))
    return out


SUP_Q = {
    "still_supported": {
        "type": "noul",
        "instructions": "Does the document still contain the information stated in the claim?",
    }
}


def build_materiality_cases() -> list[dict]:
    cases = []
    for v1_path in sorted(VP.glob("*.v1.json")):
        pair_id = v1_path.name[: v1_path.name.index(".v1")]
        v1 = json.loads(v1_path.read_text(encoding="utf-8"))
        v2 = json.loads(
            (v1_path.parent / v1_path.name.replace(".v1.", ".v2.")).read_text(encoding="utf-8")
        )
        s1 = sentences_with_pages(v1["pages"])
        s2 = sentences_with_pages(v2["pages"])
        s2_set = {s for _, s in s2}
        cat = pair_id.split("-", 1)[1]

        claim, claim_v1_page = None, None
        if cat in ("material-change", "deleted"):
            removed = [(p, s) for p, s in s1 if s not in s2_set]
            if not removed:
                continue
            claim_v1_page, claim = removed[0]
        elif cat == "moved":
            # the quote_moved proposal: a shared sentence whose PAGE changed
            s2_page = {}
            for p, s in s2:
                s2_page.setdefault(s, p)
            moved = [(p, s) for p, s in s1
                     if s in s2_set and s2_page.get(s) != p and _fact_like(s)]
            if not moved:
                continue
            claim_v1_page, claim = moved[0]
        else:  # format-only: a non-trivial shared fact sentence, not from the title page
            shared = [(p, s) for p, s in s1 if s in s2_set and _fact_like(s) and p > 1]
            if not shared:
                continue
            claim_v1_page, claim = shared[0]

        cases.append({
            "pair": pair_id, "category": cat, "claim": claim, "claimPageV1": claim_v1_page,
            "v2Pages": v2["pages"],
            "material": 1 if cat in ("material-change", "deleted") else 0,
        })
    return cases


def run_materiality(router) -> dict:
    cases = build_materiality_cases()
    # doc-level requests (one per pair)
    doc_reqs = [
        {"state": "\n\n".join(pg["text"] for pg in c["v2Pages"]),
         "questions": SUP_Q, "model": MODEL, "max_len": 8192}
        for c in cases
    ]
    doc_out = run_batch(router, doc_reqs)
    # page-level requests across all pairs
    page_reqs, pindex = [], []
    for i, c in enumerate(cases):
        for pg in c["v2Pages"]:
            pindex.append((i, pg["page"]))
            page_reqs.append({"state": pg["text"], "questions": SUP_Q, "model": MODEL})
    page_out = run_batch(router, page_reqs)

    best = {}
    for (i, page), r in zip(pindex, page_out):
        p = noul_prob(r, "still_supported")
        if i not in best or p >= best[i][1]:
            best[i] = (page, p)

    rows = []
    for i, (c, r) in enumerate(zip(cases, doc_out)):
        rows.append({
            "pair": c["pair"], "category": c["category"],
            "claimPageV1": c["claimPageV1"], "claim": c["claim"][:160],
            "probDoc": noul_prob(r, "still_supported"),
            "probPageMax": best[i][1], "bestPage": best[i][0],
            "material": c["material"],
        })

    return {
        "rows": rows,
        "rank_auc_material_vs_not": auroc(
            [{**r, "prob": r["probPageMax"], "label": r["material"]} for r in rows]
        ),
        "format_only_supported": sum(
            1 for r in rows if r["category"] == "format-only" and r["probPageMax"] >= THRESHOLD
        ),
        "format_only_total": sum(1 for r in rows if r["category"] == "format-only"),
        "n_material": sum(r["material"] for r in rows),
        "n_total": len(rows),
    }


# ----------------------------------------------------------------- main

def main() -> None:
    if not PAGES_JSON.exists():
        sys.exit("missing results/pages.json — run extract-pages.mts first")
    pages = json.loads(PAGES_JSON.read_text(encoding="utf-8"))
    qdata = json.loads((FUSION / "questions.json").read_text(encoding="utf-8"))

    router = load_laya()
    t0 = time.perf_counter()
    res = run_intent_and_matrix(router, qdata, pages["docs"])
    res["matrix_metrics"] = matrix_metrics(res["matrix"])
    RESULTS.mkdir(exist_ok=True)
    OUT_JSON.write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
    res["materiality"] = run_materiality(router)
    wall = time.perf_counter() - t0

    total = sum(n for n, _ in batch_stats)
    fwd = sum(s for _, s in batch_stats)
    per = [s / n for n, s in batch_stats]
    meta = {
        "date": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
        "model": MODEL,
        "hf_repo": HF_REPO,
        "hf_revision": hf_revision(),
        "threshold": THRESHOLD,
        "wall_seconds": round(wall, 1),
        "decisions": total,
        "forward_seconds": round(fwd, 1),
        "batch_overhead_seconds": round(wall - fwd, 1),
        "avg_s_per_decision_batched": round(fwd / total, 4) if total else None,
        "worst_batch_s_per_decision": round(max(per), 4) if per else None,
        "n_batches": len(batch_stats),
        "batch_size": BATCH,
    }
    RESULTS.mkdir(exist_ok=True)
    META_JSON.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    OUT_JSON.write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps(meta, indent=2))
    print("U3 intent accuracy:", res["intent"]["accuracy"],
          "| unans recall:", res["intent"]["unanswerable_recall"])
    mm = res["matrix_metrics"]
    print("U1 page AUROC:", mm["page_auroc"], "| doc-dev AUROC:", mm["docdev_auroc"],
          "| recall@1:", mm["recall_at_1"],
          "| unans clean:", mm["unanswerable_clean"], "/", mm["unanswerable_total"])
    mt = res["materiality"]
    print("U2 rank-AUC:", mt["rank_auc_material_vs_not"],
          "| format-only supported:", mt["format_only_supported"], "/", mt["format_only_total"])


if __name__ == "__main__":
    main()
