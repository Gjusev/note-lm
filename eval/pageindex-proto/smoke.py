"""PI-1 smoke: PageIndex SDK (local mode) over a local llama.cpp server.

Standalone evaluator script — starts llama-server on a free loopback port,
runs PageIndex local-mode indexing + chat against it, kills the server.

Run from eval/pageindex-proto/:  .venv/Scripts/python.exe smoke.py
"""
import json
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
LLAMA_DIR = os.path.join(REPO, ".probe-downloads", "llama-bin")
LLAMA_SERVER = os.path.join(LLAMA_DIR, "llama-server.exe")
CHAT_MODEL = os.path.join(REPO, ".probe-downloads", "qwen2.5-0.5b-instruct-q4_k_m.gguf")
PDF = os.path.join(HERE, "probe.pdf")
ALIAS = "Qwen2.5-0.5B-Instruct"

# Egress discipline: keep every SDK in the process pointed at nothing remote.
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"   # no network model-map fetch
os.environ["LITELLM_TELEMETRY"] = "False"             # litellm/posthog off
os.environ["DO_NOT_TRACK"] = "1"
os.environ["OPENAI_AGENTS_DISABLE_TRACING"] = "1"     # agents tracing off
os.environ.pop("OPENAI_BASE_URL", None)
os.environ.pop("ANTHROPIC_BASE_URL", None)


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class RamSampler(threading.Thread):
    """Peak working set of one PID via tasklist (cheap, no extra deps)."""

    def __init__(self, pid):
        super().__init__(daemon=True)
        self.pid, self.peak_kb, self._stop = pid, 0, threading.Event()

    def run(self):
        while not self._stop.is_set():
            try:
                out = subprocess.run(
                    ["tasklist", "/FI", f"PID eq {self.pid}", "/FO", "CSV", "/NH"],
                    capture_output=True, text=True, timeout=10).stdout
                if out.strip():
                    self.peak_kb = max(self.peak_kb, int(out.split('","')[4].replace(" K", "").replace(".", "").replace(",", "").replace('"', "")))
            except Exception:
                pass
            self._stop.wait(1.0)


def start_server(port, api_key):
    args = [
        LLAMA_SERVER,
        "-m", CHAT_MODEL,
        "--host", "127.0.0.1", "--port", str(port),
        "--alias", ALIAS,
        "-c", "8192",
        "--jinja",
        "--no-webui",
        "--api-key", api_key,
    ]
    log("llama-server: " + " ".join(args[1:]))
    proc = subprocess.Popen(args, cwd=LLAMA_DIR,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 120
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"llama-server exited early, code {proc.returncode}")
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/health",
                headers={"Authorization": f"Bearer {api_key}"})
            with urllib.request.urlopen(req, timeout=2) as r:
                if r.status == 200:
                    return proc
        except Exception:
            time.sleep(0.5)
    raise RuntimeError("llama-server did not become healthy in 120s")


def main():
    t0 = time.perf_counter()
    port = free_port()
    api_key = "eval-" + secrets.token_urlsafe(16)
    os.environ["OPENAI_API_KEY"] = api_key  # belt+braces; backends pass keys explicitly
    proc = start_server(port, api_key)
    ram = RamSampler(proc.pid)
    ram.start()
    base = f"http://127.0.0.1:{port}/v1"
    results = {"versions": {}, "phases": {}}

    try:
        from pageindex import PageIndexClient
        import litellm
        from importlib.metadata import version as _pkg_version
        results["versions"]["pageindex"] = _pkg_version("pageindex")
        results["versions"]["litellm"] = _pkg_version("litellm")
        results["versions"]["openai-agents"] = _pkg_version("openai-agents")

        client = PageIndexClient(
            index_model=f"openai/{ALIAS}",
            chat_model=f"openai/{ALIAS}",
            storage_path=os.path.join(HERE, "pi_store"),
            index_backend={"api_base": base, "api_key": api_key},
            chat_backend={"base_url": base, "api_key": api_key},
        )

        # ---- Phase 1: index build: flash, then standard fallback ----
        doc_id = None
        for mode in ("flash", "standard"):
            t = time.perf_counter()
            try:
                submit = client.submit_document(PDF, mode=mode)
                results["phases"][f"index_{mode}"] = {
                    "ok": True, "seconds": round(time.perf_counter() - t, 1),
                    "result": submit}
                doc_id = submit["doc_id"]
                break
            except Exception as e:
                results["phases"][f"index_{mode}"] = {
                    "ok": False, "seconds": round(time.perf_counter() - t, 1),
                    "error_type": type(e).__name__, "error": str(e)[:2000]}
                doc_id = None

        # ---- tree shape ----
        if doc_id:
            t = time.perf_counter()
            try:
                tree = client.get_tree(doc_id)
                slim = [{k: v for k, v in node.items() if k != "text"}
                        for node in tree["result"]]
                results["phases"]["tree"] = {
                    "ok": True, "seconds": round(time.perf_counter() - t, 2),
                    "top_nodes": slim}
            except Exception as e:
                results["phases"]["tree"] = {
                    "ok": False, "error_type": type(e).__name__,
                    "error": str(e)[:2000]}

        # ---- Phase 2: retrieval-style queries via the SDK local chat agent ----
        queries = [
            "What is the daily calibration budget under the Alpha Protocol?",
            "How many reviewers must review each measurement under the Beta Methodology?",
            "Which rule defines the archive threshold?",
        ]
        for i, q in enumerate(queries, 1):
            t = time.perf_counter()
            try:
                out = client.chat_completions(messages=[
                    {"role": "user", "content": q}], doc_id=doc_id,
                    max_turns=6)
                results["phases"][f"query_{i}"] = {
                    "question": q,
                    "ok": True,
                    "seconds": round(time.perf_counter() - t, 1),
                    "answer": out["choices"][0]["message"]["content"],
                    "usage": out.get("usage")}
            except Exception as e:
                results["phases"][f"query_{i}"] = {
                    "question": q, "ok": False,
                    "seconds": round(time.perf_counter() - t, 1),
                    "error_type": type(e).__name__, "error": str(e)[:2000]}

        # ---- Phase 3: grounded chat question ----
        t = time.perf_counter()
        try:
            out = client.chat_completions(messages=[{
                "role": "user",
                "content": "According to the document, who supervises the Alpha Protocol?"}],
                doc_id=doc_id, max_turns=6)
            results["phases"]["chat_grounded"] = {
                "ok": True, "seconds": round(time.perf_counter() - t, 1),
                "answer": out["choices"][0]["message"]["content"],
                "usage": out.get("usage")}
        except Exception as e:
            results["phases"]["chat_grounded"] = {
                "ok": False, "seconds": round(time.perf_counter() - t, 1),
                "error_type": type(e).__name__, "error": str(e)[:2000]}

    finally:
        results["llama_server_peak_working_set_mb"] = round(ram.peak_kb / 1024, 1)
        results["total_seconds"] = round(time.perf_counter() - t0, 1)
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                       capture_output=True)
        time.sleep(1)
        out_path = os.path.join(HERE, sys.argv[1] if len(sys.argv) > 1 else "smoke_result.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        log(f"server killed; results -> {out_path}")


if __name__ == "__main__":
    main()
