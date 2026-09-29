"""PI-2 bridge: PageIndex SDK (local, Flash) arms for the eval harness.

Modes:
  index   -- build Flash tree indexes for the corpus PDFs into --store
             (idempotent: docs already in the store are skipped), write an
             index report (criterion 6 evidence: no-TOC / misleading docs).
  probe   -- index one doc if needed + one agent query; prints a JSON report.
             Used as the dev-run sanity check of tool calling on 7B.
  serve   -- JSON-line request loop on stdin for the TS runner:
             -> {"id", "question", "docIds": [stem,...] | null (full corpus),
                 "maxTurns", "maxTokens", "timeoutS"}
             <- {"id", "outcome", "answer", "hits", "readPages", "toolCalls",
                 "usage", "latencyMs", "error"}
  cancel-test -- measures time-to-abort of a cancelled agent run (criterion 5).

The agent loop mirrors pageindex.local_chat.run_chat_completions line for
line (same _openai_agent/_doc_block/_managed_instructions/_run_kwargs
internals, v0.2.10) and drives Runner.run directly so that:
  - a per-question wall budget can cancel the agent cleanly
    (asyncio.wait_for -> criterion 5 abort), and
  - the tool transcript is captured (pages the agent read -> the
    retrieval-grade side of the pageindex arms).
The only prompt delta vs vanilla SDK chat is one extra system message
(identical rule for all four eval arms; see eval/harness/run-pi2-eval.mts).

docIds are corpus stems ("en-atlas-bicycles"); the bridge maps them to the
SDK doc ids of the store (doc name = "<stem>.pdf"). The allowlist is the
SDK's own doc_id scoping (pageindex.agent_tools call_tool doc_ids).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

# Egress discipline (same as smoke.py): no network model map, no telemetry.
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
os.environ["LITELLM_TELEMETRY"] = "False"
os.environ["DO_NOT_TRACK"] = "1"
os.environ["OPENAI_AGENTS_DISABLE_TRACING"] = "1"
os.environ.pop("OPENAI_BASE_URL", None)
os.environ.pop("ANTHROPIC_BASE_URL", None)

MODEL_ALIAS = "Qwen2.5-7B-Instruct"

# Identical abstention/citation rule for ALL FOUR eval arms (the TS runner
# embeds the same text in the fts/hybrid context prompts). Canonical
# abstention sentence is what the mechanical grader matches.
ANSWER_RULE = (
    "Answer using ONLY the content of the user's documents. Cite every page "
    "you used with the format [<document name>, p. N]. If the documents do "
    'not contain the answer, reply with exactly: "La información no está en '
    'los documentos." Do not use general knowledge.'
)


def log(msg: str) -> None:
    print(f"[pi2-bridge {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def make_client(store: str, base: str, api_key: str):
    from pageindex import PageIndexClient
    return PageIndexClient(
        index_model=f"openai/{MODEL_ALIAS}",
        chat_model=f"openai/{MODEL_ALIAS}",
        storage_path=store,
        index_backend={"api_base": base, "api_key": api_key},
        chat_backend={"base_url": base, "api_key": api_key},
    )


def load_manifest() -> dict:
    with open(os.path.join(REPO, "eval", "corpus", "document-trees-v1", "manifest.json"),
              encoding="utf-8") as f:
        return json.load(f)


class NameMap:
    """stem <-> sdk doc_id <-> sdk doc name, resolved from the live store."""

    def __init__(self, client):
        self.by_stem: dict[str, str] = {}
        self.name_by_id: dict[str, str] = {}
        for doc in client.list_documents(limit=100, offset=0).get("documents", []):
            self.by_stem[os.path.splitext(doc["name"])[0]] = doc["id"]
            self.name_by_id[doc["id"]] = doc["name"]

    def sdk_ids(self, stems):
        if stems is None:
            return None
        return [self.by_stem[s] for s in stems]


def extract_tool_calls(new_items) -> list[dict]:
    """Flatten the agent transcript into {name, arguments, output} triples."""
    calls: list[dict] = []
    pending: dict[str, dict] = {}
    for item in new_items or []:
        raw = getattr(item, "raw_item", None)
        rtype = getattr(raw, "type", "")
        if rtype == "function_call":
            try:
                args = json.loads(getattr(raw, "arguments", "") or "{}")
            except ValueError:
                args = {"_raw": getattr(raw, "arguments", "")}
            entry = {"name": getattr(raw, "name", "?"), "arguments": args}
            pending[getattr(raw, "call_id", "")] = entry
            calls.append(entry)
        elif rtype == "function_call_output":
            out = getattr(raw, "output", "")
            if isinstance(out, str):
                try:
                    out = json.loads(out)
                except ValueError:
                    pass
            call = pending.get(getattr(raw, "call_id", ""))
            if call is None:
                continue
            if call["name"] == "get_page_content" and isinstance(out, dict):
                # keep the page bookkeeping, drop the bulky page text
                out = {k: out.get(k) for k in
                       ("success", "doc_name", "total_pages", "requested_pages",
                        "returned_pages", "error") if k in out}
                call["output"] = out
            elif len(json.dumps(out)) < 4000:
                call["output"] = out
    return calls


PAGE_RANGE = re.compile(r"^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$")


def hits_from_tool_calls(calls: list[dict], name_to_stem: dict[str, str]) -> tuple[list[dict], list[dict]]:
    """Ranked hits + readPages from get_page_content calls, in call order.
    score = -rank (rank order), per the harness convention."""
    hits: list[dict] = []
    read_pages: list[dict] = []
    seen: set[tuple[str, int]] = set()
    rank = 0
    for call in calls:
        if call["name"] != "get_page_content":
            continue
        args = call.get("arguments", {})
        doc_name = str(args.get("doc_name", ""))
        stem = name_to_stem.get(doc_name)
        spec = str(args.get("pages", ""))

        def parse_spec(text: str) -> list[int]:
            out: list[int] = []
            for part in str(text).split(","):
                m = PAGE_RANGE.match(part)
                if not m:
                    continue
                a, b = int(m.group(1)), int(m.group(2) or m.group(1))
                out.extend(range(a, b + 1))
            return out

        pages = parse_spec(spec)
        # criterion 1 measures pages that ENTERED the evidence: prefer the
        # pages the tool actually returned; attempted-but-rejected pages are
        # kept separately (the SDK refuses out-of-range/missing docs).
        returned: list[int] | None = None
        out_of_range: list[int] | None = None
        tool_out = call.get("output")
        if isinstance(tool_out, dict):
            if tool_out.get("returned_pages") is not None:
                returned = parse_spec(tool_out["returned_pages"])
            if tool_out.get("out_of_range", {}).get("requested_pages"):
                out_of_range = parse_spec(tool_out["out_of_range"]["requested_pages"])
            if tool_out.get("error") and returned is None:
                returned = []
        if stem is None or not pages:
            read_pages.append({"docName": doc_name, "pages": spec, "resolved": False})
            continue
        read_pages.append({
            "docName": doc_name, "docId": stem, "pages": returned if returned is not None else pages,
            "requestedPages": pages, "rejectedPages": sorted(set(pages) - set(returned or [])) if returned is not None else [],
            "rejectedOutOfRange": out_of_range or [], "resolved": True,
        })
        for p in (returned if returned is not None else pages):
            key = (stem, p)
            if key in seen:
                continue
            seen.add(key)
            rank += 1
            hits.append({"docId": stem, "page": p, "lastPage": p, "score": -float(rank), "rank": rank})
    return hits, read_pages


async def run_agent(client, question: str, sdk_doc_ids, max_turns: int,
                    max_tokens: int, timeout_s: float) -> dict:
    """Mirror of pageindex.local_chat.run_chat_completions (non-streaming),
    with wait_for cancellation and transcript capture. temperature=0."""
    from agents import Runner
    from agents.exceptions import MaxTurnsExceeded
    from pageindex.local_chat import (_doc_block, _managed_instructions,
                                      _merged_backend, _openai_agent)

    t0 = time.perf_counter()
    block = _doc_block(client, sdk_doc_ids)
    items = ([{"role": "user", "content": block}] if block else []) + [
        {"role": "user", "content": question},
    ]
    managed = _managed_instructions([ANSWER_RULE])
    agent = _openai_agent(
        client, "chat", client.chat_model, managed, 0.0, None,
        doc_ids=sdk_doc_ids, max_tokens=max_tokens,
        backend=_merged_backend(client, None),
    )
    run_kwargs = {}
    from agents import RunConfig
    run_kwargs["run_config"] = RunConfig(tracing_disabled=True)
    if max_turns is not None:
        run_kwargs["max_turns"] = max_turns
    try:
        result = await asyncio.wait_for(
            Runner.run(agent, input=items, **run_kwargs), timeout=timeout_s)
    except (asyncio.TimeoutError, TimeoutError):
        return {"outcome": "timeout", "latencyMs": (time.perf_counter() - t0) * 1000,
                "answer": "", "hits": [], "readPages": [], "toolCalls": [], "usage": None}
    except MaxTurnsExceeded:
        return {"outcome": "max_turns", "latencyMs": (time.perf_counter() - t0) * 1000,
                "answer": "", "hits": [], "readPages": [], "toolCalls": [], "usage": None}
    latency = (time.perf_counter() - t0) * 1000
    calls = extract_tool_calls(result.new_items)
    usage = None
    try:
        from pageindex.local_chat import _openai_usage
        usage = _openai_usage(result.raw_responses)
    except Exception:
        pass
    return {
        "outcome": "ok",
        "latencyMs": latency,
        "answer": result.final_output or "",
        "toolCalls": calls,
        "usage": usage,
    }


async def handle_request(client, name_map: NameMap, manifest: dict, req: dict) -> dict:
    stems = req.get("docIds")
    doc_ids = name_map.sdk_ids(stems)
    pages_by_doc = {d["docId"]: d["pages"] for d in manifest["docs"]}
    t0 = time.perf_counter()
    try:
        out = await run_agent(
            client, req["question"], doc_ids,
            int(req.get("maxTurns", 14)), int(req.get("maxTokens", 512)),
            float(req.get("timeoutS", 85)),
        )
    except Exception as exc:  # never kill the serve loop on one question
        import traceback
        return {"id": req.get("id"), "outcome": "error", "answer": "", "hits": [],
                "readPages": [], "toolCalls": [], "usage": None,
                "error": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc()[-2000:],
                "latencyMs": (time.perf_counter() - t0) * 1000}
    if stems is None:
        stems = sorted(name_map.by_stem.keys())
    stem_by_name = {name: stem for stem, doc_id in name_map.by_stem.items()
                    for name in [name_map.name_by_id.get(doc_id, stem)]}
    hits, read_pages = hits_from_tool_calls(out.get("toolCalls", []), stem_by_name)
    # safety audit (criterion 1): every read page must sit inside the
    # allowlist and inside the doc's real page range.
    violations = []
    for rp in read_pages:
        if not rp.get("resolved"):
            violations.append({"kind": "unresolved_doc", "docName": rp["docName"]})
            continue
        if rp["docId"] not in stems:
            violations.append({"kind": "doc_outside_allowlist", "docId": rp["docId"]})
        limit = pages_by_doc.get(rp["docId"], 0)
        for p in rp["pages"]:
            if p < 1 or p > limit:
                violations.append({"kind": "page_out_of_range", "docId": rp["docId"], "page": p})
    out.update({"id": req.get("id"), "hits": hits, "readPages": read_pages,
                "safetyViolations": violations})
    return out


async def serve(store: str, base: str, api_key: str) -> None:
    import threading

    client = make_client(store, base, api_key)
    name_map = NameMap(client)
    manifest = load_manifest()
    loop = asyncio.get_running_loop()

    def emit(obj: dict) -> None:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    emit({"event": "ready", "docs": len(name_map.by_stem)})

    def read_lines():
        for line in sys.stdin:
            line = line.strip()
            if line:
                loop.call_soon_threadsafe(queue_put, line)

    import queue as _queue
    q: "_queue.Queue[str]" = _queue.Queue()
    queue_put = q.put
    threading.Thread(target=read_lines, daemon=True).start()
    while True:
        line = await loop.run_in_executor(None, q.get)
        try:
            req = json.loads(line)
        except ValueError as exc:
            emit({"event": "error", "error": f"bad request line: {exc}"})
            continue
        if req.get("cmd") == "shutdown":
            emit({"event": "bye"})
            return
        out = await handle_request(client, name_map, manifest, req)
        emit(out)


def cmd_index(args) -> None:
    client = make_client(args.store, args.server_url, args.api_key)
    manifest = load_manifest()
    report = {"mode": "flash-then-standard (per-doc modes recorded)", "model": MODEL_ALIAS, "docs": []}
    for doc in manifest["docs"]:
        pdf = os.path.join(REPO, "eval", "corpus", "document-trees-v1", doc["fileName"])
        stem, wanted_pages = doc["docId"], doc["pages"]
        existing = [d for d in client.list_documents(limit=100, offset=0).get("documents", [])
                    if os.path.splitext(d["name"])[0] == stem]
        if existing:
            entry = {"docId": stem, "cached": True, "ok": True, "doc_id": existing[0]["id"]}
            report["docs"].append(entry)
            log(f"{stem}: cached ({existing[0]['id']})")
        else:
            # Pre-registered flash first (recorded verbatim, criterion 6
            # evidence); where flash cannot extract a structure, fall back to
            # standard (LLM) indexing so the query arms have a tree at all.
            # The mode per doc is recorded in this report and repeated in the
            # decision report.
            entry = {"docId": stem, "cached": False, "doc_id": None, "modes": {}}
            t0 = time.perf_counter()
            try:
                submit = client.submit_document(pdf, mode="flash")
                entry["modes"]["flash"] = {"ok": True, "doc_id": submit["doc_id"],
                                           "seconds": round(time.perf_counter() - t0, 1)}
                entry["doc_id"] = submit["doc_id"]
                log(f"{stem}: flash indexed in {entry['modes']['flash']['seconds']}s")
            except Exception as exc:
                entry["modes"]["flash"] = {"ok": False, "seconds": round(time.perf_counter() - t0, 1),
                                           "error": f"{type(exc).__name__}: {exc}"[:300]}
                log(f"{stem}: flash FAILED ({entry['modes']['flash']['error'][:80]}...); falling back to standard")
                t1 = time.perf_counter()
                try:
                    submit = client.submit_document(pdf, mode="standard")
                    entry["modes"]["standard"] = {"ok": True, "doc_id": submit["doc_id"],
                                                  "seconds": round(time.perf_counter() - t1, 1)}
                    entry["doc_id"] = submit["doc_id"]
                    log(f"{stem}: standard indexed in {entry['modes']['standard']['seconds']}s")
                except Exception as exc2:
                    entry["modes"]["standard"] = {"ok": False, "seconds": round(time.perf_counter() - t1, 1),
                                                  "error": f"{type(exc2).__name__}: {exc2}"[:300]}
                    log(f"{stem}: standard FAILED -> index unavailable")
            entry["ok"] = entry["doc_id"] is not None
            report["docs"].append(entry)
        if entry.get("ok", True) and entry.get("doc_id"):
            tree = client.get_tree(entry["doc_id"], node_summary=True, include_text=False).get("result") or []
            flat: list[dict] = []

            def walk(nodes):
                for n in nodes if isinstance(nodes, list) else [nodes]:
                    if not isinstance(n, dict):
                        continue
                    flat.append({"title": n.get("title"), "page_index": n.get("page_index"),
                                 "has_summary": bool(n.get("summary"))})
                    if n.get("nodes"):
                        walk(n["nodes"])

            walk(tree)
            bad = [n for n in flat
                   if not isinstance(n["page_index"], int)
                   or not (1 <= n["page_index"] <= wanted_pages)]
            entry.update({
                "nodes": len(flat),
                "pageOutOfRange": len(bad),
                "nodesWithoutSummary": sum(1 for n in flat if not n["has_summary"]),
                "firstTitles": [n["title"] for n in flat[:6]],
                "badNodes": bad[:5],
            })
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    log(f"index report -> {args.out}")


def cmd_probe(args) -> None:
    client = make_client(args.store, args.server_url, args.api_key)
    name_map = NameMap(client)
    manifest = load_manifest()
    stem = args.doc or "en-atlas-bicycles"
    out = asyncio.run(handle_request(
        client, name_map, manifest,
        {"id": "probe", "question": args.question, "docIds": [stem],
         "maxTurns": 14, "maxTokens": 512, "timeoutS": 120}))
    print(json.dumps(out, indent=2, ensure_ascii=False))


def cmd_cancel_test(args) -> None:
    """Criterion 5 mechanics: cancel a running agent query, measure the
    time until control returns, confirm no answer is produced."""
    client = make_client(args.store, args.server_url, args.api_key)
    name_map = NameMap(client)

    async def one():
        from agents import Runner, RunConfig
        from pageindex.local_chat import (_doc_block, _managed_instructions,
                                      _merged_backend, _openai_agent)
        ids = name_map.sdk_ids(None)
        block = _doc_block(client, ids)
        items = ([{"role": "user", "content": block}] if block else []) + [
            {"role": "user", "content": "List every page of every document."}]
        managed = _managed_instructions([ANSWER_RULE])
        agent = _openai_agent(client, "chat", client.chat_model, managed, 0.0, None,
                              doc_ids=ids, max_tokens=512,
                              backend=_merged_backend(client, None))
        task = asyncio.ensure_future(Runner.run(agent, input=items, run_config=RunConfig(tracing_disabled=True)))
        await asyncio.sleep(5.0)
        t0 = time.perf_counter()
        task.cancel()
        try:
            await task
            aborted = False
        except asyncio.CancelledError:
            aborted = True
        return {"cancelOverheadMs": round((time.perf_counter() - t0) * 1000, 1),
                "aborted": aborted}

    print(json.dumps(asyncio.run(one()), indent=2))


def main() -> None:
    # JSON-line protocol channel must be UTF-8 on Windows (cp1252 default
    # chokes on the es/de corpus text in answers).
    import io as _io
    sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)
    sys.stdin = _io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
    sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", line_buffering=True)
    import logging
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["index", "serve", "probe", "cancel-test"])
    p.add_argument("--store", default=os.path.join(HERE, "pi2_store"))
    p.add_argument("--server-url", required=True)
    p.add_argument("--api-key", default="eval-key")
    p.add_argument("--out", default=os.path.join(HERE, "pi2-index-report.json"))
    p.add_argument("--doc", default=None)
    p.add_argument("--question", default="What was the revenue of Riverdale Bicycle Works in 2025?")
    args = p.parse_args()
    if args.mode == "index":
        cmd_index(args)
    elif args.mode == "serve":
        asyncio.run(serve(args.store, args.server_url, args.api_key))
    elif args.mode == "probe":
        cmd_probe(args)
    else:
        cmd_cancel_test(args)


if __name__ == "__main__":
    main()
