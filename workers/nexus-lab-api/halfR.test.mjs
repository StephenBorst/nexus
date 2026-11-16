// +0.5R reached (callMath halfRLevel, grading.mjs applyFillStamp, callStatus fillEvents). Run: node --test workers/nexus-lab-api/halfR.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { gradeCall } from "./logic.mjs";
import { applyGrade } from "./grading.mjs";
import { fillEventMessage } from "./callStatus.mjs";
import { indexMeta } from "./minuteIndex.mjs";
import { needsRegrade } from "./minuteGrader.mjs";
import { halfRLevel, HALF_R_FROM_MS } from "../../app/lib/callMath.mjs";

const T0 = HALF_R_FROM_MS + 3600_000, S0 = T0 / 1000;
const bars = (rows) => ({ step: 60, t: rows.map((_, k) => S0 + 60 * (k + 1)), h: rows.map((r) => r[0]), l: rows.map((r) => r[1]), c: rows.map((r) => r[2]) });
// LONG 100, stop 90 (1R = 10), TP1 120 → +0.5R = 105.
const call = (x = {}) => ({ id: "c1", symbol: "PERP_ETH_USDC", direction: "LONG", entryPrice: 100, stopLoss: 90, takeProfit1: 120, createdAt: T0, publishMark: { px: 100, at: T0 }, ...x });

test("+0.5R: stamped once at the first bar that traded it; one alert; the grade doesn't move", () => {
  const t = call();
  const cd = bars([[103, 99, 102], [106, 101, 104]]);
  const r = applyGrade(t, gradeCall(t, cd), cd);
  assert.equal(t.halfRAt, (S0 + 120) * 1000);
  assert.deepEqual(r.fills, ["HALF_R"]);
  assert.equal(t.gradedOutcome, undefined, "still open");
  const cd2 = bars([[103, 99, 102], [106, 101, 104], [104, 100, 101]]);
  assert.deepEqual(applyGrade(t, gradeCall(t, cd2), cd2).fills, [], "announced once, even after price comes back");
  assert.equal(fillEventMessage(t, "HALF_R").message, "ETH LONG is +0.5R (105) · still open: graded at TP1 120 or the stop 90");
});

test("+0.5R: none when TP1 is at or under it, none for calls from before it shipped; the minute grader wakes on it", () => {
  assert.equal(halfRLevel(call({ takeProfit1: 105 })), null);
  assert.equal(halfRLevel(call({ createdAt: HALF_R_FROM_MS - 1 })), null);
  assert.equal(halfRLevel(call({ direction: "SHORT", stopLoss: 110, takeProfit1: 80 })), 95);
  const meta = indexMeta({ ...call(), fillState: "OPEN", filledAt: T0 });
  assert.equal(meta.hr, 105);
  assert.equal(needsRegrade({ ...meta, g: 1 }, { range: { lo: 104.5, hi: 105.2 }, nowMs: T0 + 600_000 }), true);
  assert.equal(indexMeta({ ...call(), fillState: "OPEN", filledAt: T0, halfRAt: T0 }).hr, undefined, "no wake-up once it's reached");
  const tp1First = call({ takeProfit1: 104 });
  const r = applyGrade(tp1First, gradeCall(tp1First, bars([[106, 99, 105]])), bars([[106, 99, 105]]));
  assert.ok(!r.fills.includes("HALF_R"), "TP1 at or under +0.5R: the grade says it all");
});
