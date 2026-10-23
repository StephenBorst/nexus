import { test } from "node:test";
import assert from "node:assert/strict";
import { callRR, runnerRR, fmtRR, liveMove, fmtLiveMove, splitPlan, callInvalidReason, splitRunnerStopped, SPLIT_EXIT } from "./callMath.mjs";
import { callR, splitPlan as graderSplitPlan, SPLIT_EXIT as GRADER_SPLIT } from "../../workers/nexus-lab-api/logic.mjs";

// Shaped like the live Bankr call that showed "R:R 1:5.00": its stored riskReward was to TP2.
const bankr = { direction: "SHORT", entryPrice: 86000, stopLoss: 86950, takeProfit1: 83530, takeProfit2: 81250, riskReward: 5 };

test("callRR is the grader's callR on every shape", () => {
  const cases = [
    bankr,
    { direction: "LONG", entryPrice: 100, stopLoss: 95, takeProfit1: 113 },
    { direction: "LONG", entryPrice: 100, stopLoss: 105, takeProfit1: 113 },  // stop on wrong side
    { direction: "SHORT", entryPrice: 100, stopLoss: 95, takeProfit1: 90 },   // stop on wrong side
    { direction: "LONG", entryPrice: 0, stopLoss: 0, takeProfit1: 0 },
    {},
  ];
  for (const c of cases) assert.equal(callRR(c), callR(c));
});

test("the chip follows the levels, not the stored riskReward", () => {
  assert.equal(callRR(bankr), 2.6);
  assert.equal(fmtRR(callRR(bankr)), "1:2.60");
  assert.equal(runnerRR(bankr), 5);
});

test("runnerRR is null without a target beyond TP1", () => {
  assert.equal(runnerRR({ ...bankr, takeProfit2: 0 }), null);
  assert.equal(runnerRR({ ...bankr, takeProfit2: 84000 }), null); // nearer than TP1
  assert.equal(fmtRR(null), "—");
});

test("liveMove reads the move without a position size", () => {
  const t = { direction: "LONG", entryPrice: 100, stopLoss: 95, takeProfit1: 110 };
  assert.deepEqual(liveMove(t, 102), { pct: 2, r: 0.4 });
  assert.equal(fmtLiveMove(liveMove(t, 102)), "+0.40R · +2.00%");
  assert.equal(fmtLiveMove(liveMove({ ...t, direction: "SHORT", stopLoss: 105 }, 102)), "−0.40R · −2.00%");
  assert.equal(liveMove(t, 0), null);
  assert.equal(fmtLiveMove(liveMove({ ...t, stopLoss: 0 }, 102)), "+2.00%");
});

test("the grader reads the split rule from here: one function, one value", () => {
  assert.equal(graderSplitPlan, splitPlan);
  assert.equal(GRADER_SPLIT, SPLIT_EXIT);
});

test("callInvalidReason: says why a call can never be graded, or null", () => {
  const long = { direction: "LONG", entryPrice: 100, stopLoss: 98, takeProfit1: 103, takeProfit2: 108, exitPlan: "SPLIT_50" };
  assert.equal(callInvalidReason(long), null);
  assert.equal(callInvalidReason({ ...long, takeProfit2: 103 }), null, "TP2 = TP1: one target, gradeable");
  assert.equal(callInvalidReason({ ...long, takeProfit2: 102 }), "split exit with TP2 not beyond TP1");
  assert.equal(callInvalidReason({ ...long, stopLoss: 101 }), "stop or target on the wrong side of entry");
  assert.equal(callInvalidReason({ ...long, exitPlan: undefined, takeProfit2: 0 }), null, "no split declared");
  assert.equal(callInvalidReason({ ...long, takeProfit1: 0 }), "entry, stop or target missing");
  assert.equal(callInvalidReason({ ...long, entryPrice: undefined }), "entry, stop or target missing");
});

test("splitRunnerStopped: half at TP1, half on the stop, whichever side of zero it lands (live shapes, 2026-10-23)", () => {
  // Engine B #18–#20: r1 1.5, r2 4 → 0.5·1.5 − 0.5 = +0.25R, stored as a WIN.
  const short = { direction: "SHORT", entryPrice: 100, stopLoss: 102, takeProfit1: 97, takeProfit2: 92, exitPlan: "SPLIT_50" };
  assert.equal(splitRunnerStopped({ ...short, gradedOutcome: "WIN", gradedR: 0.25 }), true);
  // r1 0.92 → 0.46 − 0.5 = −0.04R: hit TP1 first, stored as a LOSS.
  const thin = { direction: "SHORT", entryPrice: 100, stopLoss: 102.5, takeProfit1: 97.7, takeProfit2: 92.875, exitPlan: "SPLIT_50" };
  assert.equal(splitPlan(thin).r1, 0.92);
  assert.equal(splitRunnerStopped({ ...thin, gradedOutcome: "LOSS", gradedR: -0.04 }), true);
  // Both halves at target, the stop before TP1, an ungraded call, a call with no split: not this.
  assert.equal(splitRunnerStopped({ ...short, gradedOutcome: "WIN", gradedR: 2.75 }), false);
  assert.equal(splitRunnerStopped({ ...short, gradedOutcome: "LOSS", gradedR: -1 }), false);
  assert.equal(splitRunnerStopped({ ...short }), false);
  assert.equal(splitRunnerStopped({ ...short, exitPlan: undefined, gradedOutcome: "WIN", gradedR: 0.25 }), false);
  assert.equal(splitRunnerStopped({ ...short, takeProfit2: 97, gradedOutcome: "WIN", gradedR: 1.5 }), false, "TP2 = TP1 is one target");
});
