import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notQueuedText, noReplyText, runFailedText, CREDIT_KEPT, CREDIT_USED, CREDIT_UNKNOWN } from "./simOutcome.mjs";

// Every failed sim says what happened to the credit (2026-11-15).
test("not queued = credit kept; the facilitator's detail stays out of the card", () => {
  assert.equal(notQueuedText("daily simulation cap reached — try again tomorrow"), `Daily simulation cap reached — try again tomorrow. ${CREDIT_KEPT}`);
  assert.equal(notQueuedText("run rejected (402) — facilitator reason: invalid_exact_evm_payload"), `MiroShark didn't accept the run. ${CREDIT_KEPT}`);
  assert.equal(notQueuedText("simulation error: TypeError: x"), `The simulation service errored. ${CREDIT_KEPT}`);
  assert.equal(notQueuedText(undefined), `The simulation didn't start. ${CREDIT_KEPT}`);
  assert.equal(noReplyText(), `The simulation request failed. ${CREDIT_UNKNOWN}`);
  assert.equal(runFailedText("timeout"), `MiroShark reported the run failed: timeout. ${CREDIT_USED}`);
  assert.equal(runFailedText(""), `MiroShark reported the run failed. ${CREDIT_USED}`);
});

test("the sim card uses them on each path, and re-reads credits after a lost reply", () => {
  const src = readFileSync(new URL("../pages/lab/Simulate.tsx", import.meta.url), "utf8");
  assert.match(src, /setDone\(\{ error: notQueuedText\(d\?\.error\) \}\)/);
  assert.match(src, /\.catch\(\(\) => \{ setDone\(\{ error: noReplyText\(\) \}\); setState\("done"\); refreshCredits\(\); \}\)/);
  assert.match(src, /finish\(\{ error: runFailedText\(x\.error\) \}\)/);
  assert.doesNotMatch(src, /simulation didn't queue|"simulation failed"/);
  // server side of the promise: the credit comes back on anything short of a queued run
  const api = readFileSync(new URL("../../workers/nexus-lab-api/index.js", import.meta.url), "utf8");
  const run = api.slice(api.indexOf("let queued = false;"), api.indexOf("// ── GET /wargame/status"));
  assert.match(run, /if \(!queued\) \{\n\s+try \{ await refundSimCredit\(/);
});
