// A declared time stop (`timeStopH`, callMath timeStopPlan, gradeCall), borst 2026-11-06,
// docs/research/engine-ab-time-stop-note-2026-11-06.md. Hand-built candles; no network.
// Run: node --test workers/nexus-lab-api/timeStop.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gradeCall } from "./logic.mjs";
import { PASS_FIELDS, GRADE_FIELDS } from "./grading.mjs";
import { sealTheses, SERVER_FIELDS } from "./callLock.mjs";
import { registeredNotes, thesisFromRegistration, checkRegistration, SPLIT_TAG } from "./thesisRegister.mjs";
import { timeStopPlan, copiedTimeStop, timeExitLabel, callInvalidReason, TIME_STOP_FROM_MS, TIME_EXIT } from "../../app/lib/callMath.mjs";
import { _pinMinuteGradeFrom } from "../../app/lib/minuteGrade.mjs";
// This suite tests the HOURLY grader on calls built from Date.now(): pin it (minuteGrade.mjs).
_pinMinuteGradeFrom(Infinity);

const H = 3600;
const HOUR0 = Date.UTC(2026, 10, 10, 12) / 1000;            // a posting hour after the cutoff (sec)
const POST = (HOUR0 + 20 * 60) * 1000;                      // posted at 12:20 (ms)

// A SHORT at 100, stop 102 (risk 2), target 97 (R 1.5), filled at the post (mark = entry).
const short = (over = {}) => ({
  id: "c1", direction: "SHORT", entryPrice: 100, stopLoss: 102, takeProfit1: 97,
  createdAt: POST, publishMark: { px: 100, at: POST }, timeStopH: 4, ...over,
});
// Candles from the posting hour (bar 0) on: each [high, low, close].
function candles(rows, start = HOUR0) {
  return { t: rows.map((_, i) => start + i * H), h: rows.map((r) => r[0]), l: rows.map((r) => r[1]), c: rows.map((r) => r[2]) };
}
const QUIET = [100.5, 99.5, 100];

test("the rule's dates and limits", () => {
  assert.equal(TIME_STOP_FROM_MS, Date.UTC(2026, 10, 6));
  assert.equal(TIME_EXIT, "TIME");
  assert.deepEqual(timeStopPlan(short()), { hours: 4 });
  assert.equal(timeStopPlan(short({ timeStopH: undefined })), null);
});

test("filled at the post, no touch by bar 4's close: settles at that close, R from entry, exit TIME", () => {
  // bar 0 (posting hour) then bars 1..4, then bar 5 (exists → bar 4 closed)
  const cd = candles([QUIET, QUIET, QUIET, [100.4, 99.2, 99.6], [100.2, 98.9, 99.0], QUIET]);
  const g = gradeCall(short(), cd);
  assert.equal(g.outcome, "WIN");
  assert.equal(g.r, 0.5, "(100 − 99.0) ÷ 2");
  assert.equal(g.exitReason, "TIME");
  assert.equal(g.exitAt, HOUR0 + 4 * H, "the start of bar 4's hour");
});

test("bar 4 still the last bar in the store (maybe a partial hour): PENDING, never graded on an open bar", () => {
  const cd = candles([QUIET, QUIET, QUIET, QUIET, [100.2, 98.9, 99.0]]);
  assert.equal(gradeCall(short(), cd).outcome, "PENDING");
});

test("TP and stop come first in every bar, bar 4 included; a same-bar TP + stop is a LOSS", () => {
  const tpBar3 = candles([QUIET, QUIET, QUIET, [100, 96.8, 97.2], QUIET, QUIET]);
  const w = gradeCall(short(), tpBar3);
  assert.deepEqual([w.outcome, w.r, w.exitReason], ["WIN", 1.5, undefined]);
  const slBar4 = candles([QUIET, QUIET, QUIET, QUIET, [102.1, 99.5, 101], QUIET]);
  assert.deepEqual([gradeCall(short(), slBar4).outcome, gradeCall(short(), slBar4).r], ["LOSS", -1]);
  const bothBar4 = candles([QUIET, QUIET, QUIET, QUIET, [102.5, 96.5, 99], QUIET]);
  const b = gradeCall(short(), bothBar4);
  assert.deepEqual([b.outcome, b.r, b.exitReason], ["LOSS", -1, undefined]);
});

test("a touch after the window never counts: the call closed on time first", () => {
  const cd = candles([QUIET, QUIET, QUIET, QUIET, [100.3, 99.4, 100.6], [100, 96, 96.5]]);
  const g = gradeCall(short(), cd);
  assert.deepEqual([g.outcome, g.r, g.exitReason], ["LOSS", -0.3, "TIME"]);
});

test("R exactly 0 at the close is a LOSS", () => {
  const cd = candles([QUIET, QUIET, QUIET, QUIET, [100.3, 99.4, 100], QUIET]);
  const g = gradeCall(short(), cd);
  assert.deepEqual([g.outcome, g.r], ["LOSS", 0]);
});

test("a LONG settles on the same rule", () => {
  const long = short({ direction: "LONG", stopLoss: 98, takeProfit1: 103 });
  const cd = candles([QUIET, QUIET, QUIET, QUIET, [101.5, 99.8, 101.2], QUIET]);
  const g = gradeCall(long, cd);
  assert.deepEqual([g.outcome, g.r, g.exitReason], ["WIN", 0.6, "TIME"]);
});

test("a resting order: bar 0 is the fill hour (its stop touch counts), the clock runs 4h from there", () => {
  // entry 101 above the market: fills in the hour that trades 101 (index 2), then bars 3..6
  const resting = short({ entryPrice: 101, stopLoss: 103, takeProfit1: 98, publishMark: { px: 100, at: POST } });
  const rows = [QUIET, QUIET, [101.2, 100.2, 100.8], QUIET, QUIET, QUIET, [100.4, 99.8, 100.0], QUIET];
  const g = gradeCall(resting, candles(rows));
  assert.deepEqual([g.outcome, g.r, g.exitReason], ["WIN", 0.5, "TIME"], "(101 − 100) ÷ 2");
  assert.equal(g.exitAt, HOUR0 + 6 * H);
  const stopInFill = [QUIET, QUIET, [103.2, 100.5, 102], QUIET, QUIET, QUIET, QUIET, QUIET];
  assert.deepEqual([gradeCall(resting, candles(stopInFill)).outcome, gradeCall(resting, candles(stopInFill)).r], ["LOSS", -1]);
});

test("the window is time, not candles: a thin market that skips an hour settles at the last close before the deadline", () => {
  // bars at hours 0,1,2,4(the 4th bar's hour),6 — hour 3 and 5 missing
  const t = [0, 1, 2, 4, 6].map((k) => HOUR0 + k * H);
  const cd = { t, h: [100.5, 100.5, 100.5, 100.3, 100.5], l: [99.5, 99.5, 99.5, 99.1, 99.5], c: [100, 100, 100, 99.4, 100] };
  const g = gradeCall(short(), cd);
  assert.deepEqual([g.outcome, g.r, g.exitAt], ["WIN", 0.3, HOUR0 + 4 * H]);
});

test("a missing close keeps it PENDING (never a guess)", () => {
  const cd = candles([QUIET, QUIET, QUIET, QUIET, [100.3, 99.4, NaN], QUIET]);
  assert.equal(gradeCall(short(), cd).outcome, "PENDING");
});

test("forward-only: a call published before the cutoff grades as before, field or not", () => {
  const before = { ...short(), createdAt: Date.UTC(2026, 10, 5, 12), publishMark: { px: 100, at: Date.UTC(2026, 10, 5, 12) } };
  const start = Date.UTC(2026, 10, 5, 12) / 1000;
  const cd = candles([QUIET, QUIET, QUIET, QUIET, [100.2, 98.9, 99.0], QUIET, QUIET], start);
  const g = gradeCall(before, cd);
  assert.equal(g.outcome, "PENDING", "no time stop: still open with neither level touched");
  assert.equal(g.exitReason, undefined);
  assert.equal(timeStopPlan(before), null);
});

test("no timeStopH: unchanged", () => {
  const cd = candles([QUIET, QUIET, QUIET, QUIET, [100.2, 98.9, 99.0], QUIET, QUIET]);
  assert.equal(gradeCall(short({ timeStopH: undefined }), cd).outcome, "PENDING");
});

test("a bad declaration is refused: not whole hours, out of range, or with a split", () => {
  for (const v of [0, -1, 4.5, 169, "4h", null && 1]) {
    if (v === null) continue;
    assert.ok(timeStopPlan(short({ timeStopH: v }))?.invalid, String(v));
    assert.ok(callInvalidReason(short({ timeStopH: v })), String(v));
    assert.equal(gradeCall(short({ timeStopH: v }), candles([QUIET])).outcome, "INVALID");
  }
  const split = short({ exitPlan: "SPLIT_50", takeProfit2: 95 });
  assert.match(callInvalidReason(split), /split/);
});

test("the publish lock refuses a bad declaration, judged at the server's publish time (an old client createdAt can't skip it)", () => {
  const now = Date.UTC(2026, 10, 10);
  const bad = { ...short({ timeStopH: 500 }), isPublic: true, createdAt: Date.UTC(2026, 0, 1) };
  const out = sealTheses({ prev: [], incoming: [bad], registry: null, now });
  assert.equal(out.refused.length, 1);
  assert.match(out.refused[0].reason, /timeStopH/);
  const good = sealTheses({ prev: [], incoming: [{ ...short(), isPublic: true }], registry: null, now });
  assert.equal(good.refused.length, 0);
  assert.equal(good.theses[0].timeStopH, 4, "frozen with the call");
  assert.equal(good.theses[0].createdAt, now);
});

test("exitReason is server-only, and the hourly pass carries it", () => {
  assert.ok(SERVER_FIELDS.includes("exitReason"));
  // Both grading passes carry it: the hourly pass (PASS_FIELDS) and the minute grader (GRADE_FIELDS).
  assert.ok(PASS_FIELDS.includes("exitReason") && GRADE_FIELDS.includes("exitReason"));
  const src = readFileSync(new URL("./grading.mjs", import.meta.url), "utf8");
  assert.match(src, /if \(g\.exitReason\) t\.exitReason = g\.exitReason; else delete t\.exitReason;/);
});

test("on-chain: the declaration rides in the notes and comes back out", () => {
  assert.equal(registeredNotes("fade the pop", undefined, 4), "fade the pop #TIMESTOP_4H");
  assert.equal(registeredNotes("x", "SPLIT_50", undefined), `x ${SPLIT_TAG}`);
  assert.equal(registeredNotes("x #TIMESTOP_9H", undefined, 4), "x #TIMESTOP_4H", "a typed tag can't double-declare");
  const call = { symbol: "PERP_ETH_USDC", direction: "SHORT", entryPrice: 100, stopLoss: 102, takeProfit1: 97, takeProfit2: 0, notes: "fade #TIMESTOP_4H" };
  const t = thesisFromRegistration({ call, onChainId: null }, { txHash: "0x" + "ab".repeat(32), blockTimeMs: POST });
  assert.equal(t.timeStopH, 4);
  assert.equal(t.notes, "fade");
  const base = { symbol: "ETH", direction: "SHORT", entryPrice: 100, stopLoss: 102, takeProfit1: 97, notes: "" };
  assert.equal(checkRegistration({ ...base, timeStopH: 4 }), null);
  assert.equal(checkRegistration({ ...base, timeStopH: 0 })?.body?.error ?? checkRegistration({ ...base, timeStopH: 0 })?.error, "bad_time_stop");
});

test("copies keep the source's time stop; labels name it", () => {
  assert.equal(copiedTimeStop(short()), 4);
  assert.equal(copiedTimeStop(short({ timeStopH: undefined })), undefined);
  assert.equal(copiedTimeStop(short({ timeStopH: 4.5 })), undefined);
  assert.equal(timeExitLabel({ ...short(), gradedOutcome: "WIN", gradedR: 0.5, exitReason: "TIME" }), "CLOSED AT 4H");
  assert.equal(timeExitLabel({ ...short(), gradedOutcome: "WIN", gradedR: 1.5 }), null);
  assert.equal(timeExitLabel({ ...short(), exitReason: "TIME" }), null, "not graded yet");
});
