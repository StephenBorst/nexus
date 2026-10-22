// Run: node --test app/lib/callLifecycle.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { callLifecycle, showsLivePnl, distanceToEntry, workingLine, ENTRY_AT_MARK_PCT } from "./callLifecycle.mjs";
import { ENTRY_AT_MARK_PCT as GRADER_PCT } from "../../workers/nexus-lab-api/logic.mjs";

const call = (over = {}) => ({ status: "ACTIVE", direction: "LONG", entryPrice: 2400, stopLoss: 2350, takeProfit1: 2700, ...over });

test("the reported card: a limit that never filled is WORKING and shows no P&L", () => {
  const t = call({ fillState: "WORKING" });
  assert.equal(callLifecycle(t), "WORKING");
  assert.equal(showsLivePnl(t), false);
  assert.equal(workingLine(t, 2538), "mark 5.44% above the entry");
});

test("a filled call is OPEN; a graded or owner-closed one is CLOSED whatever its fill stamp", () => {
  assert.equal(callLifecycle(call({ fillState: "OPEN" })), "OPEN");
  assert.equal(showsLivePnl(call({ fillState: "OPEN" })), true);
  assert.equal(callLifecycle(call({ fillState: "OPEN", gradedOutcome: "WIN" })), "CLOSED");
  assert.equal(callLifecycle(call({ fillState: "WORKING", status: "STOPPED_OUT" })), "CLOSED");
  assert.equal(callLifecycle(call({ status: "INVALIDATED" })), "CLOSED");
});

test("not stamped yet: OPEN only when the entry was the market at publish, else UNCHECKED (no P&L)", () => {
  assert.equal(callLifecycle(call({ entryPrice: 2538, publishMark: { px: 2540, at: 1 } })), "OPEN");
  assert.equal(callLifecycle(call({ publishMark: { px: 2538, at: 1 } })), "UNCHECKED", "5% off the mark: a resting order");
  assert.equal(callLifecycle(call()), "UNCHECKED", "no mark, no stamp: don't guess");
  assert.equal(showsLivePnl(call()), false);
  assert.equal(callLifecycle(null), "UNCHECKED");
});

test("the at-market tolerance is the grader's", () => {
  assert.equal(ENTRY_AT_MARK_PCT, GRADER_PCT);
});

test("distance to a resting entry, either side", () => {
  assert.deepEqual(distanceToEntry(call(), 2538), { pct: 5.44, side: "above" });
  assert.deepEqual(distanceToEntry(call({ direction: "SHORT", entryPrice: 2700 }), 2538), { pct: 6.38, side: "below" });
  assert.equal(distanceToEntry(call(), null), null);
  assert.equal(workingLine(call(), undefined), "no position until price trades the entry");
});

test("callLifecycle: a call the grader can never grade is INVALID, never a live position", () => {
  // Levels on the wrong side of entry, and a split whose TP2 falls short of TP1.
  const wrongSide = call({ stopLoss: Number(call().entryPrice) + 10, fillState: "OPEN" });
  const shortSplit = call({ exitPlan: "SPLIT_50", takeProfit2: Number(call().entryPrice) + 0.5, fillState: "OPEN" });
  for (const t of [wrongSide, shortSplit]) {
    assert.equal(callLifecycle(t), "INVALID");
    assert.equal(showsLivePnl(t), false);
  }
  // A grade beats it (a graded call is CLOSED), and TP2 = TP1 under a split is just one target.
  assert.equal(callLifecycle({ ...wrongSide, gradedOutcome: "LOSS" }), "CLOSED");
  const c = call();
  assert.equal(callLifecycle({ ...c, exitPlan: "SPLIT_50", takeProfit2: c.takeProfit1, fillState: "OPEN" }), "OPEN");
});
