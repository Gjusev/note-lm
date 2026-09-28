"""Debug: run the standard (classic) pipeline directly to capture the
underlying traceback that submit_document wraps away."""
import os, socket, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
LLAMA_SERVER = os.path.join(REPO, ".probe-downloads", "llama-bin", "llama-server.exe")
CHAT_MODEL = os.path.join(REPO, ".probe-downloads", "qwen2.5-0.5b-instruct-q4_k_m.gguf")

os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
os.environ["LITELLM_TELEMETRY"] = "False"
os.environ["OPENAI_AGENTS_DISABLE_TRACING"] = "1"

s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
key = "eval-debug"
args = [LLAMA_SERVER, "-m", CHAT_MODEL, "--host", "127.0.0.1", "--port", str(port),
        "--alias", "Qwen2.5-0.5B-Instruct", "-c", "8192", "--jinja", "--no-webui",
        "--api-key", key]
proc = subprocess.Popen(args, cwd=os.path.dirname(LLAMA_SERVER),
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(240):
        try:
            r = urllib.request.urlopen(urllib.request.Request(
                f"http://127.0.0.1:{port}/health", headers={"Authorization": f"Bearer {key}"}), timeout=2)
            if r.status == 200:
                break
        except Exception:
            time.sleep(0.5)
    base = f"http://127.0.0.1:{port}/v1"
    os.environ["OPENAI_API_KEY"] = key

    import PyPDF2, litellm, traceback
    from pageindex.utils import ConfigLoader, _llm_backend
    from pageindex.page_index_classic import page_index_main

    with open(os.path.join(HERE, "probe.pdf"), "rb") as f:
        page_texts = [p.extract_text() or "" for p in PyPDF2.PdfReader(f).pages]
    page_list = [(t, litellm.token_counter(model="openai/Qwen2.5-0.5B-Instruct", text=t)) for t in page_texts]
    opt = ConfigLoader().load({
        "model": "openai/Qwen2.5-0.5B-Instruct",
        "summary_model": "openai/Qwen2.5-0.5B-Instruct",
        "if_add_node_id": "yes", "if_add_node_summary": "yes",
        "if_add_node_text": "yes", "if_add_doc_description": "yes",
    })
    tok = _llm_backend.set({"api_base": base, "api_key": key})
    try:
        result = page_index_main(os.path.join(HERE, "probe.pdf"), opt, page_list=page_list)
        print("STRUCTURE OK:", result.get("structure"))
    except Exception:
        traceback.print_exc()
    finally:
        _llm_backend.reset(tok)
finally:
    subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
