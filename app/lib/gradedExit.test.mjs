// The graded exit: level math, the paper-only rule, and the pins that keep exec, lab-api and the
// pre-registration doc on the same rule. Run: node --test app/lib/gradedExit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GRADED_EXIT, GRADED_EXIT_OOS_CUTOFF_MS, GRADED_EXIT_MAX_STOP_PCT, gradedExitLevels, gradedExitLevelsFromHourly, gradedExitRefusal, usesGradedExit } from "./gradedExit.mjs";
import { R_CONTRACT } from "./rContract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const OK = { exitContract: GRADED_EXIT, mode: "PAPER", maxHoldHours: 168 };

test("levels follow the R contract: stop = 1.2× ATR, target = 1.5× the stop", () => {
  assert.deepEqual(gradedExitLevels(0.02), { slPercent: 2.4, tpPercent: 3.6 });
  assert.deepEqual(gradedExitLevels(0.035), { slPercent: 4.2, tpPercent: 6.3 });
  assert.equal(R_CONTRACT.atrMult, 1.2); assert.equal(R_CONTRACT.rMultiple, 1.5); assert.equal(R_CONTRACT.maxHoldH, 168);
});

test("no 3% cap: a 4h ATR of 3% gives a 3.6% stop", () => {
  assert.equal(gradedExitLevels(0.03).slPercent, 3.6);
});

test("no ATR or insane ATR → null (sit out), never a fallback", () => {
  for (const x of [null, undefined, 0, -0.01, NaN, Infinity]) assert.equal(gradedExitLevels(x), null);
  assert.equal(gradedExitLevels((GRADED_EXIT_MAX_STOP_PCT + 1) / 120), null);
  assert.equal(gradedExitLevelsFromHourly([]), null);
  assert.equal(gradedExitLevelsFromHourly(null), null);
});

test("paper-only: every non-PAPER config is refused", () => {
  assert.equal(gradedExitRefusal(OK, true), null);
  assert.match(gradedExitRefusal(OK, false), /paper-only/);
  assert.match(gradedExitRefusal({ ...OK, mode: "AUTONOMOUS" }, false), /paper-only/);
});

test("the whole contract or nothing: extra exit parts are refused", () => {
  assert.match(gradedExitRefusal({ ...OK, maxHoldHours: 12 }, true), /168h/);
  assert.match(gradedExitRefusal({ ...OK, takeProfits: [{ pct: 1, sizePct: 75 }, { pct: 2, sizePct: 25 }] }, true), /ladder/);
  assert.match(gradedExitRefusal({ ...OK, trailingStopPct: 1 }, true), /trailing/);
  assert.match(gradedExitRefusal({ ...OK, breakevenTriggerPct: 1 }, true), /breakeven/);
  assert.match(gradedExitRefusal({ ...OK, dcaEnabled: true }, true), /DCA/);
  assert.match(gradedExitRefusal({ ...OK, volScaledStops: true }, true), /vol-scaled/);
  assert.equal(gradedExitRefusal({ ...OK, takeProfits: [] }, true), null);
});

test("configs without the graded exit are never touched", () => {
  assert.equal(usesGradedExit({}), false);
  assert.equal(gradedExitRefusal({ mode: "AUTONOMOUS", maxHoldHours: 12, volScaledStops: true }, false), null);
  assert.equal(gradedExitRefusal(null, false), null);
});

test("exec checks the paper-only rule before any price read, key read or order", () => {
  const src = read("workers/nexus-agent-exec/index.js");
  const fn = src.slice(src.indexOf("async function enterPosition("));
  const guard = fn.indexOf("gradedExitRefusal(config, paper)");
  assert.ok(guard > 0, "enterPosition must call gradedExitRefusal(config, paper)");
  for (const later of ["getMarkPrice(", "agent:key:", "orderlyRequest(", "state.current_position ="]) {
    const at = fn.indexOf(later);
    assert.ok(at > guard, `${later} must come after the graded-exit guard`);
  }
  // graded levels are read before the order block, and a missing ATR returns before it
  assert.ok(fn.indexOf("fetchGradedExitLevels(symbol)") < fn.indexOf("let orderId = null;"));
});

test("lab-api refuses to store a graded exit on a live config at every write and mode flip", () => {
  const src = read("workers/nexus-lab-api/index.js");
  const n = (src.match(/gradedExitRefusal\(/g) || []).length;
  assert.equal(n, 4, "PUT /agent, PUT /agent/config, bankr/activate, bankr/mode");
});

test("the pre-registration doc carries the same out-of-sample cutoff", () => {
  const doc = read("docs/research/graded-exit-prereg.md");
  const iso = new Date(GRADED_EXIT_OOS_CUTOFF_MS).toISOString().replace(".000Z", "Z");
  assert.ok(doc.includes(iso), `doc must name ${iso}`);
});
