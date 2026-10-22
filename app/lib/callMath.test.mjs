import { test } from "node:test";
import assert from "node:assert/strict";
import { callRR, runnerRR, fmtRR, liveMove, fmtLiveMove, splitPlan, callInvalidReason, SPLIT_EXIT } from "./callMath.mjs";
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
});
