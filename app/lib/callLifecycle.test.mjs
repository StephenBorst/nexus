// Run: node --test app/lib/callLifecycle.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { callLifecycle, showsLivePnl, distanceToEntry, workingLine, provisionalTouch, callPollMs, CALL_POLL_MS, ENTRY_AT_MARK_PCT } from "./callLifecycle.mjs";
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

// ── the live mark's hint before the grader stamps (Phase 1, display only) ─────
test("a resting LONG limit under the market reads ENTRY once the mark comes down to it, not before", () => {
  const t = call({ fillState: "WORKING", publishMark: { px: 2538, at: 1 } });   // entry 2400, market above
  assert.equal(provisionalTouch(t, 2450), null);
  assert.equal(provisionalTouch(t, 2400), "ENTRY");
  assert.equal(provisionalTouch(t, 2390), "ENTRY", "through it counts too");
  // A breakout entry ABOVE the market fills when the mark rises to it.
  const up = call({ fillState: "WORKING", entryPrice: 2600, stopLoss: 2550, takeProfit1: 2800, publishMark: { px: 2538, at: 1 } });
  assert.equal(provisionalTouch(up, 2590), null);
  assert.equal(provisionalTouch(up, 2601), "ENTRY");
  // No publish mark: only a mark right at the entry says anything.
  assert.equal(provisionalTouch(call({ fillState: "WORKING" }), 2400.5), "ENTRY");
  assert.equal(provisionalTouch(call({ fillState: "WORKING" }), 2390), null);
});

test("an OPEN call reads STOP or TARGET when the mark reaches it; TP2 once the TP1 half has closed", () => {
  const t = call({ fillState: "OPEN" });
  assert.equal(provisionalTouch(t, 2500), null);
  assert.equal(provisionalTouch(t, 2700), "TARGET");
  assert.equal(provisionalTouch(t, 2350), "STOP");
  const short = call({ fillState: "OPEN", direction: "SHORT", entryPrice: 100, stopLoss: 102, takeProfit1: 97 });
  assert.deepEqual([provisionalTouch(short, 96.9), provisionalTouch(short, 102.1), provisionalTouch(short, 99)], ["TARGET", "STOP", null]);
  const split = call({ fillState: "OPEN", takeProfit2: 2900, exitPlan: "SPLIT_50", tp1HitAt: 1 });
  assert.equal(provisionalTouch(split, 2750), null, "the runner is aiming at TP2");
  assert.equal(provisionalTouch(split, 2900), "TARGET");
});

test("graded, invalid, unchecked or no mark: nothing provisional to say", () => {
  assert.equal(provisionalTouch(call({ fillState: "OPEN", gradedOutcome: "WIN" }), 2800), null);
  assert.equal(provisionalTouch(call(), 2400), null, "UNCHECKED: the grader hasn't said where the order stands");
  assert.equal(provisionalTouch(call({ fillState: "OPEN" }), null), null);
  assert.equal(provisionalTouch(null, 1), null);
});

test("a call page re-reads an open call every 30 s and stops once it can't change", () => {
  assert.equal(CALL_POLL_MS, 30_000);
  assert.equal(callPollMs(call({ fillState: "WORKING" })), 30_000, "a resting order can fill");
  assert.equal(callPollMs(call({ fillState: "OPEN" })), 30_000, "an open call can settle");
  assert.equal(callPollMs(call()), 30_000, "not checked yet");
  assert.equal(callPollMs(call({ fillState: "OPEN", gradedOutcome: "WIN" })), null, "graded: final");
  assert.equal(callPollMs(call({ takeProfit1: 2300 })), null, "invalid levels never grade");
  assert.equal(callPollMs(call({ fillState: "OPEN", status: "STOPPED_OUT" })), null, "closed by its status");
});
