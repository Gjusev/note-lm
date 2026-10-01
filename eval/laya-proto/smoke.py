"""Smoke test for the laya prototype venv — run BEFORE run_eval.py.

Checks: package import, checkpoint download/load (multilingual), one
decision per type in EN/DE/ES, routing sanity, and prints latency.
"""
from __future__ import annotations

import json
import time

from laya import Router

router = Router(preload=False)

CASES = [
    (
        "Hi, we were billed twice for March. Please refund the duplicate today or we will cancel our plan.",
        "en",
        "billing",
    ),
    (
        "La aplicación se cierra cada vez que abro la configuración.",
        "es",
        "technical",
    ),
    (
        "Der Messwert des Flusspegels überschritt im März die vereinbarte Schwelle an der Station Elbingen.",
        "de",
        "other",
    ),
]

questions = {
    "department": {
        "type": "choice",
        "instructions": "Which kind of issue is this?",
        "criteria": {
            "billing": "invoices, payments, refunds, charges",
            "technical": "bugs, crashes, outages, system errors",
            "other": "reports, measurements, everything else",
        },
    },
    "urgency": {
        "type": "score",
        "instructions": "How urgent is this?",
        "criteria": ["not urgent", "soon", "blocking"],
    },
    "churn_risk": {
        "type": "noul",
        "instructions": "Does the text threaten to cancel or leave?",
    },
}

results = []
for text, lang, expected in CASES:
    t0 = time.perf_counter()
    out = router.predict(text, questions, model="laya-multilingual")
    dt = time.perf_counter() - t0
    got = out["answers"]["department"]["choice"]
    results.append({
        "lang": lang,
        "expected": expected,
        "got": got,
        "correct": got == expected,
        "urgency": out["answers"]["urgency"]["score"],
        "churn_prob": out["answers"]["churn_risk"]["noul"],
        "routing_model": out.get("routing", {}).get("model"),
        "seconds": round(dt, 3),
    })
    print(json.dumps(results[-1], ensure_ascii=False))

ok = all(r["correct"] for r in results)
print("SMOKE", "PASS" if ok else "FAIL")
