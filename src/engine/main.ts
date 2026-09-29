/**
 * Engine entrypoint: the process Tauri spawns (issue #9/#10). Speaks the
 * NDJSON protocol over stdio - stdout is protocol only, stderr is logs.
 * stdin is read in binary-safe chunks; the decoder tolerates split reads.
 */
import { createDecoder, encodeError, encodeResponse } from "./protocol";
import { requestSecretViaHost, resolveSecretResponse, failPendingSecretRequests } from "./secrets";
import { handleEngineRequest } from "./dispatch";
import { startProcessingLoop } from "./jobs";
import { stopLlamaHelpers } from "./capabilities";
import { setSecretRequester } from "@/lib/ai/providers";
import { getLocalContext } from "@/lib/storage/local";
import { reconcileStartupArtifacts } from "@/lib/services/job-control";
import { reconcileReviewScans } from "@/lib/services/change-review";
import { pruneProviderRuns } from "@/lib/services/provider-runs";

// stdout is the protocol channel - ALL other output (job logs, warnings)
// goes to stderr. Anything console.log'd by engine code would corrupt the
// NDJSON stream, so the global is redirected before anything runs.
console.log = (...args: unknown[]) => console.error(...args);

// Desktop marker: this bundle only runs as the Tauri-spawned engine process.
// The provider layer uses it to guarantee that env vars never reactivate
// remote providers in the installed app (see src/lib/ai/providers.ts).
process.env.NOTELM_ENGINE = "1";

// Secret channel (multi-provider S2): remote capability factories ask the
// host for a connection's secret through this requester; the frame handler
// below routes the correlated secret_response frames back to the waiters.
setSecretRequester((connectionId) =>
  requestSecretViaHost((frame) => process.stdout.write(frame), connectionId)
);

const decoder = createDecoder({
  onMessage: async (message) => {
    // Engine-initiated frames route by id to pending secret waiters (S2).
    // Handled BEFORE the id+op request check: a response never carries an op,
    // and its value must never reach the malformed-frame log below.
    if (message.t === "secret_response") {
      if (typeof message.id === "string") {
        resolveSecretResponse(message.id, message.value);
      } else {
        // no frame content in the log - a value must never be printed
        console.error("[engine] secret_response without id - ignored");
      }
      return;
    }
    if (typeof message.id !== "string" || typeof message.op !== "string") {
      // a frame without id cannot be answered - log to stderr and drop it
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
// stdin end = the host closed us: pending secret requests can never be
// answered (fail fast), helper processes (llama-server) are stopped so
// nothing orphans, THEN exit. Findling 8 of agent-execution-plan.
process.stdin.on("end", () => {
  failPendingSecretRequests();
  void stopLlamaHelpers().finally(() => process.exit(0));
});

// uploads (extract/transcribe -> chunk) run inside the engine process
const bootCtx = getLocalContext();
// slice 3b: one reconcile pass at startup - orphan partial dirs and terminal
// checkpoints are dropped, live jobs' partials survive for their next attempt
reconcileStartupArtifacts(bootCtx.db, bootCtx.dataDir);
// priority-1 fix: re-run change-review scans a crash left pending/failed in
// the review_scans ledger - decided proposals are never resurrected, missing
// ones are filled in (idempotent per anchor + target version)
void reconcileReviewScans(bootCtx.db, bootCtx.store).catch((err) =>
  console.error("[REVIEW] ledger reconcile failed:", err instanceof Error ? err.message : err)
);
// provider telemetry (S3): opportunistic retention pruning on engine start
pruneProviderRuns(bootCtx.db);
startProcessingLoop(bootCtx);
