// Declared plans from 2026-11-16 (callMath beRunnerPlan / fillWindowPlan, graded by logic.mjs gradeCall).
// Run: node --test workers/nexus-lab-api/gradePlansV2.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { gradeCall } from "./logic.mjs";
import { applyGrade, isSettled } from "./grading.mjs";
import { needsRegrade } from "./minuteGrader.mjs";
import { indexMeta } from "./minuteIndex.mjs";
import { fillEventMessage } from "./callStatus.mjs";
import { registeredNotes, thesisFromRegistration, checkRegistration } from "./thesisRegister.mjs";
import { callInvalidReason, copiedExitPlan, copiedFillWindow, expiredLabel, runnerExitLabel, PLANS_V2_FROM_MS } from "../../app/lib/callMath.mjs";

const T0 = PLANS_V2_FROM_MS + 3600_000;            // a post time after the plans shipped (sec-aligned)
const S0 = T0 / 1000;
// Minute bars from rows [h, l, c] starting the minute after the post.
const bars = (rows) => ({ step: 60, t: rows.map((_, k) => S0 + 60 * (k + 1)), h: rows.map((r) => r[0]), l: rows.map((r) => r[1]), c: rows.map((r) => r[2]) });
// LONG at 100 (filled at the post: the mark is the entry), stop 90 (1R = 10), TP1 110 (R1 = 1).
const be = (extra = {}) => ({ direction: "LONG", entryPrice: 100, stopLoss: 90, takeProfit1: 110, exitPlan: "SPLIT_50_BE", createdAt: T0, publishMark: { px: 100, at: T0 }, ...extra });

test("runner: TP1 banks half, the stop moves to the entry, trails 1R behind the best close, fills at the trail", () => {
  // TP1 in bar 1 (close 112 → trail 102), bar 2 closes 125 → trail 115, bar 3 dips to 114: out at 115.
  const g = gradeCall(be(), bars([[105, 99, 104], [111, 104, 112], [126, 111, 125], [124, 114, 116]]));
  assert.equal(g.outcome, "WIN");
  assert.equal(g.bankedR, 0.5);
  assert.equal(g.r, 1.25, "0.5 × R1 (1) + 0.5 × (115 − 100) / 10");
  assert.equal(g.exitReason, "TRAIL");
  assert.equal(g.legs.runner, "TRAIL");
});

test("runner: back to the entry closes the runner at breakeven, never a loss after TP1", () => {
  const g = gradeCall(be(), bars([[111, 101, 105], [106, 99, 100]]));
  assert.deepEqual([g.outcome, g.r, g.exitReason], ["WIN", 0.5, "BE"]);
});

test("runner: TP2 when declared; a same-bar trail + TP2 is the trail; the TP1 bar reaching TP2 closes both", () => {
  assert.equal(gradeCall(be({ takeProfit2: 130 }), bars([[111, 101, 112], [131, 103, 129]])).r, 2, "0.5 × 1 + 0.5 × 3");
  const same = gradeCall(be({ takeProfit2: 130 }), bars([[111, 101, 125], [131, 114, 129]]));
  assert.equal(same.exitReason, "TRAIL", "trail 115 checked before TP2");
  assert.equal(gradeCall(be({ takeProfit2: 130 }), bars([[131, 101, 129]])).r, 2);
});

test("runner: before TP1 it is an ordinary call; open runner is PENDING with its trail; the trail never loosens", () => {
  assert.deepEqual([gradeCall(be(), bars([[105, 89, 95]])).outcome, gradeCall(be(), bars([[105, 89, 95]])).r], ["LOSS", -1]);
  const open = gradeCall(be(), bars([[111, 101, 118], [117, 109, 109]]));
  assert.equal(open.outcome, "PENDING");
  assert.equal(open.trail, 108, "best close 118 − 10; the 109 close doesn't pull it back");
  const short = gradeCall(be({ direction: "SHORT", stopLoss: 110, takeProfit1: 90 }), bars([[99, 89, 85], [94, 84, 86], [96, 90, 92]]));
  assert.deepEqual([short.outcome, short.r, short.exitReason], ["WIN", 0.75, "TRAIL"], "short: trail 95 from the 85 close");
});

test("plans only count on calls published from the ship date; bad plans are refused", () => {
  const old = gradeCall(be({ createdAt: PLANS_V2_FROM_MS - 3600_000 }), bars([[111, 101, 112], [106, 99, 100]]));
  assert.equal(old.outcome, "WIN");
  assert.equal(old.r, 1, "an older call carrying the field grades as a single target");
  assert.match(callInvalidReason(be({ takeProfit2: 105 })), /TP2 must sit beyond TP1/);
  assert.match(callInvalidReason(be({ timeStopH: 4 })), /time stop/);
  assert.match(callInvalidReason({ ...be({ exitPlan: undefined }), fillWithinH: 0 }), /fillWithinH/);
  assert.equal(callInvalidReason({ ...be(), fillWithinH: 12 }), null);
});

// A resting LONG limit at 95 (market 100 at the post), stop 90, TP1 110.
const limit = (extra = {}) => ({ direction: "LONG", entryPrice: 95, stopLoss: 90, takeProfit1: 110, createdAt: T0, publishMark: { px: 100, at: T0 }, fillWithinH: 1, ...extra });
const longBars = (n, row) => bars(Array.from({ length: n }, () => row));

test("fill window: unfilled past post + N hours = EXPIRED, only once a bar exists past the window", () => {
  assert.equal(gradeCall(limit(), longBars(59, [101, 98, 100])).outcome, "PENDING", "the window hasn't closed");
  const g = gradeCall(limit(), longBars(61, [101, 98, 100]));
  assert.deepEqual([g.outcome, g.expiredReason, g.expiredAt], ["EXPIRED", "TIME", S0 + 3600]);
  const filled = gradeCall(limit(), bars([[101, 94, 96], ...Array(70).fill([97, 96, 96])]));
  assert.equal(filled.outcome, "PENDING", "filled inside the window: a live call, never expires");
  assert.equal(gradeCall(limit({ fillWithinH: undefined }), longBars(200, [101, 98, 100])).outcome, "PENDING", "no window: waits forever, as before");
});

test("void on stop first: only a breakout entry (market between stop and entry); a limit is never voided that way", () => {
  // LONG breakout: buy at 105 above a 100 market, stop 98. Price falls to 97 first.
  const brk = { direction: "LONG", entryPrice: 105, stopLoss: 98, takeProfit1: 115, createdAt: T0, publishMark: { px: 100, at: T0 }, fillWithinH: 12 };
  const v = gradeCall(brk, bars([[101, 99, 100], [100, 97, 98], [106, 98, 105]]));
  assert.deepEqual([v.outcome, v.expiredReason, v.expiredAt], ["EXPIRED", "STOP_FIRST", S0 + 120]);
  const both = gradeCall(brk, bars([[106, 97, 100]]));
  assert.deepEqual([both.outcome, both.r], ["LOSS", -1], "entry and stop in one bar: a fill, then the stop (conservative)");
  // A limit (95 under a 100 market, stop 90): a gap bar 89–89.5 trades the stop without the entry. Not void.
  assert.equal(gradeCall(limit({ fillWithinH: 12 }), bars([[101, 96, 97], [89.5, 89, 89]])).outcome, "PENDING");
});

test("stamps: EXPIRED is settled, not a grade, announced once; a runner's trail is stamped while open", () => {
  const t = limit();
  const r = applyGrade(t, gradeCall(t, longBars(61, [101, 98, 100])), longBars(61, [101, 98, 100]));
  assert.deepEqual([t.fillState, t.status, t.expiredReason, t.gradedOutcome], ["EXPIRED", "EXPIRED", "TIME", undefined]);
  assert.deepEqual(r.fills, ["EXPIRED"]);
  assert.equal(r.resolved, null, "never announced as a win or a loss");
  assert.equal(isSettled(t), true);
  assert.deepEqual(applyGrade(t, gradeCall(t, longBars(62, [101, 98, 100])), longBars(62, [101, 98, 100])).fills, [], "once");
  assert.equal(expiredLabel(t), "EXPIRED · not filled in 1h");
  assert.match(fillEventMessage({ ...t, symbol: "PERP_ETH_USDC" }, "EXPIRED").message, /^ETH LONG order expired: the entry 95 didn't trade within 1h · not a win, not a loss$/);
  const run = be();
  const cd = bars([[111, 101, 118], [117, 109, 109]]);
  applyGrade(run, gradeCall(run, cd), cd);
  assert.equal(run.trailStop, 108);
  assert.ok(run.tp1HitAt > 0);
  const win = be();
  applyGrade(win, gradeCall(win, bars([[111, 101, 105], [106, 99, 100]])), cd);
  assert.equal(runnerExitLabel(win), "TP1 · RUNNER AT BREAKEVEN");
  assert.equal(win.trailStop, undefined);
});

test("minute trigger: a due fill window and an open runner wake the grader", () => {
  const now = T0 + 2 * 3600_000;
  assert.equal(needsRegrade({ ...indexMeta({ ...limit(), fillState: "WORKING" }) }, { range: null, nowMs: now }), true);
  assert.equal(needsRegrade({ ...indexMeta({ ...limit({ fillWithinH: 3 }), fillState: "WORKING" }) }, { range: null, nowMs: now }), false);
  const runMeta = indexMeta({ ...be(), fillState: "OPEN", filledAt: T0, tp1HitAt: T0 + 60_000, trailStop: 108 });
  assert.equal(needsRegrade(runMeta, { range: { lo: 140, hi: 141 }, nowMs: now }), true, "any new bar can move a trail");
  assert.equal(needsRegrade(runMeta, { range: null, nowMs: now }), false);
});

test("on-chain tags: exact, never read as the plain split; copies keep the plan and the window", () => {
  const notes = registeredNotes("breakout retest", "SPLIT_50_BE", undefined, 12);
  assert.equal(notes, "breakout retest #SPLIT_50_BE #FILL_12H");
  const call = { symbol: "PERP_ETH_USDC", direction: "LONG", entryPrice: 100, stopLoss: 90, takeProfit1: 110, takeProfit2: 0, notes, isPublic: true };
  const t = thesisFromRegistration({ call, onChainId: "7" }, { txHash: "0x" + "ab".repeat(32), blockTimeMs: T0 });
  assert.deepEqual([t.exitPlan, t.fillWithinH, t.notes], ["SPLIT_50_BE", 12, "breakout retest"]);
  const plain = thesisFromRegistration({ call: { ...call, notes: "x #SPLIT_50" } }, { txHash: "0x" + "cd".repeat(32), blockTimeMs: T0 });
  assert.equal(plain.exitPlan, "SPLIT_50");
  assert.equal(checkRegistration({ ...call, symbol: "ETH", exitPlan: "SPLIT_50_BE", fillWithinH: 12 }), null);
  assert.equal(checkRegistration({ ...call, symbol: "ETH", exitPlan: "SPLIT_50_BE", takeProfit2: 105 }).error, "bad_split");
  assert.equal(checkRegistration({ ...call, symbol: "ETH", fillWithinH: 500 }).error, "bad_fill_window");
  assert.equal(copiedExitPlan({ exitPlan: "SPLIT_50_BE" }), "SPLIT_50_BE");
  assert.equal(copiedFillWindow({ fillWithinH: 12 }), 12);
});
