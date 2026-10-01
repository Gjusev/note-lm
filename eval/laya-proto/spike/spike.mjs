/**
 * laya-ts ONNX spike — mirrors eval/laya-proto/smoke.py against the exported
 * ONNX model (encoder.onnx + head.onnx), the shape the note-lm engine would
 * run via onnxruntime-node. No Python at inference time.
 *
 * Prereq: export first ->
 *   eval/laya-proto/.venv/Scripts/python.exe ../../../../laya-upstream/laya-ts/scripts/export_onnx.py ^
 *     --repo convaiinnovations/laya-multilingual --out-dir ../models/laya-ml
 *
 * Run: (cd eval/laya-proto/spike && node spike.mjs)
 */
import { Agent, Router } from "laya-ts";
import { fileURLToPath } from "node:url";

const MODEL_DIR = fileURLToPath(new URL("../models/laya-ml", import.meta.url));

console.log("loading", MODEL_DIR);
const t0 = performance.now();
const agent = await Agent.load(MODEL_DIR);
console.log(`loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

const router = new Router();
router.attach("multilingual", agent);

const CASES = [
  ["Hi, we were billed twice for March. Please refund the duplicate today or we will cancel our plan.", "billing"],
  ["La aplicación se cierra cada vez que abro la configuración.", "technical"],
  ["Der Messwert des Flusspegels überschritt im März die vereinbarte Schwelle an der Station Elbingen.", "other"],
];

const questions = {
  department: {
    type: "choice",
    instructions: "Which kind of issue is this?",
    criteria: {
      billing: "invoices, payments, refunds, charges",
      technical: "bugs, crashes, outages, system errors",
      other: "reports, measurements, everything else",
    },
  },
  churn_risk: { type: "noul", instructions: "Does the text threaten to cancel or leave?" },
};

let ok = true;
for (const [text, expected] of CASES) {
  const t1 = performance.now();
  const out = await router.predict(text, questions, { model: "multilingual" });
  const dt = (performance.now() - t1).toFixed(0);
  const got = out.answers.department.choice;
  const pass = got === expected;
  ok = ok && pass;
  console.log(JSON.stringify({
    expected, got, pass,
    churn_prob: out.answers.churn_risk.noul,
    ms: Number(dt),
  }));
}
console.log("SPIKE", ok ? "PASS" : "FAIL");
