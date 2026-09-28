/**
 * Engine entrypoint: the process Tauri spawns (issue #9/#10). Speaks the
 * NDJSON protocol over stdio — stdout is protocol only, stderr is logs.
 * stdin is read in binary-safe chunks; the decoder tolerates split reads.
 */
import { createDecoder, encodeError, encodeResponse } from "./protocol";
import { handleEngineRequest } from "./dispatch";
import { startProcessingLoop } from "./jobs";
import { stopLlamaHelpers } from "./capabilities";
import { getLocalContext } from "@/lib/storage/local";
import { reconcileStartupArtifacts } from "@/lib/services/job-control";

// stdout is the protocol channel — ALL other output (job logs, warnings)
// goes to stderr. Anything console.log'd by engine code would corrupt the
// NDJSON stream, so the global is redirected before anything runs.
console.log = (...args: unknown[]) => console.error(...args);

const decoder = createDecoder({
  onMessage: async (message) => {
    if (typeof message.id !== "string" || typeof message.op !== "string") {
      // a frame without id cannot be answered — log to stderr and drop it
      console.error("[engine] malformed request:", JSON.stringify(message).slice(0, 200));
      return;
    }
    const outcome = await handleEngineRequest(message.op, message.args ?? {});
    if (outcome.ok) {
      process.stdout.write(encodeResponse({ id: message.id, result: outcome.result }));
    } else {
      process.stdout.write(
        encodeError({ id: message.id, code: outcome.error.code, message: outcome.error.message })
      );
    }
  },
  onError: (error) => {
    console.error(`[engine] protocol error ${error.code}: ${error.message}`);
  },
});

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => decoder.push(chunk));
// stdin end = the host closed us: stop helper processes (llama-server) so
// nothing orphans, THEN exit. Findling 8 of agent-execution-plan.
process.stdin.on("end", () => {
  void stopLlamaHelpers().finally(() => process.exit(0));
});

// uploads (extract/transcribe → chunk) run inside the engine process
const bootCtx = getLocalContext();
// slice 3b: one reconcile pass at startup — orphan partial dirs and terminal
// checkpoints are dropped, live jobs' partials survive for their next attempt
reconcileStartupArtifacts(bootCtx.db, bootCtx.dataDir);
startProcessingLoop(bootCtx);
