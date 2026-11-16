// ── A call's numbers, derived from its own levels ───────────────────────────────────────────
// Cards used to print the STORED `riskReward`, which the caller's client writes. Some clients wrote
// it to TP2 (a Bankr call showed "R:R 1:5.00" beside levels that make 1:2.60 to TP1, and the grader
// paid 2.60). The grader pays the geometric R to TP1 (lab-api logic.mjs `callR`), so every card shows
// that, and the TP2 runner gets its own label. Display only: nothing here grades a call.
// Pure + dependency-free.

const num = (v) => Number(v);
const isLong = (t) => String(t?.direction).toUpperCase() === "LONG";

/** Reward ÷ risk from entry, stop and a target, 2dp. null when the levels don't make a call. */
function rTo(t, target) {
  const e = num(t?.entryPrice), s = num(t?.stopLoss), tp = num(target);
  if (!(e > 0 && s > 0 && tp > 0)) return null;
  const long = isLong(t);
  const risk = long ? e - s : s - e;
  const reward = long ? tp - e : e - tp;
  if (!(risk > 0 && reward > 0)) return null;
  return Math.round((reward / risk) * 100) / 100;
}

/** R to TP1: the number the grader pays on a WIN. Same rule as lab-api `callR` (pinned by test). */
export const callRR = (t) => rTo(t, t?.takeProfit1);

/** R to TP2, when the call has a runner target beyond TP1. null otherwise. */
export function runnerRR(t) {
  const r2 = rTo(t, t?.takeProfit2), r1 = callRR(t);
  return r2 != null && r1 != null && r2 > r1 ? r2 : null;
}

// ── Can the grader grade this call at all? ───────────────────────────────────────────────────
// ONE rule for the grader (lab-api logic.mjs gradeCall re-exports splitPlan from here), the publish
// lock, /theses/status and every card that says why a call isn't graded.

/** The declared split exit (lab-api gradeCall): half at TP1, half at TP2, both on the original stop. */
export const SPLIT_EXIT = "SPLIT_50";

/**
 * A call's declared split, or null for a single-target call.
 * A split whose TP2 IS its TP1 closes both halves at TP1: that is the single-target call, and it is
 * graded as one (borst, 2026-10-23: four Engine B calls posted this shape sat INVALID, ungraded). A
 * TP2 short of TP1 still makes the split INVALID: there the two halves can't both be honoured.
 * @returns {null | { invalid: true } | { r1: number, r2: number }} r2 = reward to TP2 ÷ risk, 2dp
 */
export function splitPlan(t) {
  if (t?.exitPlan !== SPLIT_EXIT) return null;
  const r1 = callRR(t);
  if (r1 != null && Number(t.takeProfit2) === Number(t.takeProfit1)) return null;
  const r2 = rTo(t, t?.takeProfit2);
  if (r1 == null || r2 == null || !(r2 > r1)) return { invalid: true };
  return { r1, r2 };
}

// ── Declared plans from 2026-11-16 (borst: "start on #1, trail 1R behind best close") ─────────────
// Both are declared by the CALL at publish and frozen with it, like the split and the time stop. Read
// only on calls published from PLANS_V2_FROM_MS: a call published earlier grades as before whatever it
// carries, so no stored stamp moves (no GRADE_V bump).
export const PLANS_V2_FROM_MS = Date.UTC(2026, 10, 16);   // 2026-11-16T00:00Z, the day they shipped

/**
 * `exitPlan: "SPLIT_50_BE"`: half closes at TP1; at TP1 the runner's stop moves to the ENTRY, then
 * trails TRAIL_R (1R = the call's own entry-to-stop distance) behind the best close since TP1, never
 * backwards. The runner closes at the trail or at TP2 (optional; without one it rides the trail). On
 * the grader's bars (1-minute for every call this can be on): the trail for a bar is set by the closes
 * BEFORE it; in a bar, the trail is checked before TP2 (a same-bar trail + TP2 = the trail); a trail exit
 * fills at the trail level. Total = 0.5·R1 + 0.5·(trail − entry) ÷ risk, or 0.5·R1 + 0.5·R2 at TP2: once
 * TP1 is banked the call can't close as a loss. Before TP1 it's an ordinary call on its original stop.
 */
export const SPLIT_BE_EXIT = "SPLIT_50_BE";
export const TRAIL_R = 1;

/** Plans read from this call, honouring the date it was published. */
const plansV2 = (t) => Number(t?.createdAt) >= PLANS_V2_FROM_MS;

/**
 * A call's breakeven-runner plan: null (none, or published before PLANS_V2_FROM_MS), { invalid, reason },
 * or { r1, r2 | null } (r2 = R to TP2 when one is declared).
 */
export function beRunnerPlan(t) {
  if (t?.exitPlan !== SPLIT_BE_EXIT || !plansV2(t)) return null;
  const r1 = callRR(t);
  if (r1 == null) return { invalid: true, reason: "stop or target on the wrong side of entry" };
  const tp2 = Number(t?.takeProfit2);
  if (!(tp2 > 0)) return { r1, r2: null };
  const r2 = rTo(t, tp2);
  if (r2 == null || !(r2 > r1)) return { invalid: true, reason: "a breakeven runner's TP2 must sit beyond TP1 (or leave TP2 out)" };
  return { r1, r2 };
}

/**
 * `fillWithinH: N` (whole hours 1–FILL_MAX_H): a resting entry that hasn't traded N hours after the post
 * EXPIRES (not a win, not a loss; counted nowhere but the caller's own fill rate). It also voids a
 * BREAKOUT entry whose stop trades first: when the market at the post (publishMark) sat between the stop
 * and the entry, price reaching the stop before the entry means the trade never happened. A limit entry
 * (between the market and its stop) can't be voided that way: price has to pass the entry to reach the
 * stop. A call filled at the post never expires.
 * @returns {null | { invalid: true, reason: string } | { hours: number }}
 */
export const FILL_MAX_H = 168;
export function fillWindowPlan(t) {
  if (t?.fillWithinH == null || !plansV2(t)) return null;
  const h = Number(t.fillWithinH);
  if (!Number.isInteger(h) || h < 1 || h > FILL_MAX_H) return { invalid: true, reason: `fillWithinH must be a whole number of hours from 1 to ${FILL_MAX_H}` };
  return { hours: h };
}

// ── +0.5R reached (2026-11-16): a heads-up while a call is open, never a grade ───────────────────
// The price at +0.5R (half the call's own risk past the entry, its way) and whether a bar reached it. Display +
// one alert only: nothing moves the stop or the grade. Not for calls whose TP1 is at or under +0.5R (TP1 comes
// first there), and only for calls published from HALF_R_FROM_MS, so an open call already past it isn't
// announced late.
export const HALF_R_FROM_MS = Date.UTC(2026, 10, 16, 6);   // 2026-11-16T06:00Z
export function halfRLevel(t) {
  if (!(Number(t?.createdAt) >= HALF_R_FROM_MS)) return null;
  const e = num(t?.entryPrice), s = num(t?.stopLoss), r1 = callRR(t);
  if (!(e > 0 && s > 0) || r1 == null || !(r1 > 0.5)) return null;
  return isLong(t) ? e + 0.5 * (e - s) : e - 0.5 * (s - e);
}

/** Why a call never filled, as stored by the grader (`expiredReason`). */
export const EXPIRED = "EXPIRED";
export const EXPIRE_TIME = "TIME";
export const EXPIRE_STOP_FIRST = "STOP_FIRST";

/** "EXPIRED · not filled in 12h" / "VOID · stop traded before the entry". null when not expired. */
export function expiredLabel(t) {
  if (t?.fillState !== EXPIRED) return null;
  if (t?.expiredReason === EXPIRE_STOP_FIRST) return "VOID · stop traded before the entry";
  const h = Number(t?.fillWithinH);
  return Number.isInteger(h) && h > 0 ? `EXPIRED · not filled in ${h}h` : "EXPIRED · not filled";
}

/** A graded breakeven runner, in words: "TP1 + TP2" / "TP1 · runner trailed out" / "TP1 · runner at breakeven". */
export function runnerExitLabel(t) {
  if (t?.exitPlan !== SPLIT_BE_EXIT || t?.gradedOutcome !== "WIN") return null;
  if (t?.exitReason === "TRAIL") return "TP1 · RUNNER TRAILED OUT";
  if (t?.exitReason === "BE") return "TP1 · RUNNER AT BREAKEVEN";
  return "TP1 + TP2";
}

/**
 * The exit plan a COPY of a call carries: the source's declared split, or none. A copy that keeps
 * `takeProfit2` but drops `exitPlan` is graded TP1-only, a different trade from the source (BankrBot
 * review, 2026-10-26: entry 100, stop 90, TP1 120, TP2 140, TP1 then the stop grades +0.5R on the
 * source and +2R on such a copy). Every copy flow builds the field from this. A breakeven runner is
 * kept too (2026-11-16).
 */
export const copiedExitPlan = (source) => (source?.exitPlan === SPLIT_EXIT || source?.exitPlan === SPLIT_BE_EXIT ? source.exitPlan : undefined);

/** The fill window a COPY carries: the source's, or none. */
export function copiedFillWindow(source) {
  const h = Number(source?.fillWithinH);
  return source?.fillWithinH != null && Number.isInteger(h) && h >= 1 && h <= FILL_MAX_H ? h : undefined;
}

// ── A declared time stop (borst, 2026-11-06; docs/research/engine-ab-time-stop-note-2026-11-06.md) ─────
// A call published with `timeStopH: N` that has hit neither its target nor its stop by the close of the
// Nth hourly bar after entry settles at that bar's close, graded R from entry to that close. Declared by
// the CALL at publish and frozen with it, like the split: one grader for every caller, no wallet logic.
// Bar 0 = the posting hour (filled at the post) or the fill hour (a resting order); bars 1..N are graded
// on as usual, TP and stop first, a same-bar TP + stop still a LOSS; the time stop only settles at bar
// N's close, and only once that hour has closed. A timeout's R > 0 = WIN, else LOSS; exit reason TIME.
// Forward-only twice over: only calls published from TIME_STOP_FROM_MS are read for it (a call
// published earlier grades as before even if it carries the field), and no earlier call declares it.

export const TIME_STOP_MAX_H = 168;
export const TIME_STOP_FROM_MS = Date.UTC(2026, 10, 6);   // 2026-11-06T00:00Z, the day it shipped
export const TIME_EXIT = "TIME";

/**
 * A call's declared time stop: null (none, or published before TIME_STOP_FROM_MS), { invalid, reason }
 * (refused at publish; INVALID if one slipped through), or { hours }.
 */
export function timeStopPlan(t) {
  if (t?.timeStopH == null) return null;
  if (!(Number(t?.createdAt) >= TIME_STOP_FROM_MS)) return null;
  const h = Number(t.timeStopH);
  if (!Number.isInteger(h) || h < 1 || h > TIME_STOP_MAX_H) return { invalid: true, reason: `timeStopH must be a whole number of hours from 1 to ${TIME_STOP_MAX_H}` };
  if (t.exitPlan === SPLIT_EXIT || t.exitPlan === SPLIT_BE_EXIT) return { invalid: true, reason: "a split exit can't also carry a time stop" };
  return { hours: h };
}

/**
 * A graded call a declared time stop closed (stored `exitReason: "TIME"`), as one label: "CLOSED AT 4H".
 * Its grade can be a small win or a small loss, so "HIT TP" / "Stopped out" would misread it. null otherwise.
 */
export function timeExitLabel(t) {
  if (t?.exitReason !== TIME_EXIT || (t?.gradedOutcome !== "WIN" && t?.gradedOutcome !== "LOSS")) return null;
  const h = Number(t?.timeStopH);
  return Number.isInteger(h) && h > 0 ? `CLOSED AT ${h}H` : "CLOSED ON TIME";
}

/** The time stop a COPY carries: the source's, or none (a copy without it grades a different trade). */
export function copiedTimeStop(source) {
  const h = Number(source?.timeStopH);
  return source?.timeStopH != null && Number.isInteger(h) && h >= 1 && h <= TIME_STOP_MAX_H && source?.exitPlan !== SPLIT_EXIT && source?.exitPlan !== SPLIT_BE_EXIT ? h : undefined;
}

/**
 * Why the grader can never grade this call, from its levels alone, or null. Published calls are
 * frozen, so this is permanent. (gradeCall also answers INVALID when it has no candles; that is a
 * missing read, not this.)
 */
export function callInvalidReason(t) {
  if (!(num(t?.entryPrice) > 0 && num(t?.stopLoss) > 0 && num(t?.takeProfit1) > 0)) return "entry, stop or target missing";
  if (callRR(t) == null) return "stop or target on the wrong side of entry";
  if (splitPlan(t)?.invalid) return "split exit with TP2 not beyond TP1";
  const ts = timeStopPlan(t);
  if (ts?.invalid) return ts.reason;
  const be = beRunnerPlan(t);
  if (be?.invalid) return be.reason;
  const fw = fillWindowPlan(t);
  if (fw?.invalid) return fw.reason;
  return null;
}

/**
 * A graded split whose runner was stopped: half closed at TP1, half on the original stop, so the grade
 * is 0.5·R1 − 0.5 (a small win, or a small loss when R1 < 1). "HIT TP" or "Stopped out" alone each
 * tell half of it (2026-10-23: three Engine B splits read HIT TP at +0.25R, one read stopped out at
 * −0.04R after hitting TP1). Read from the levels + the stored grade; display only.
 */
export function splitRunnerStopped(t) {
  const p = splitPlan(t);
  if (!p || p.invalid) return false;
  if (t?.gradedOutcome !== "WIN" && t?.gradedOutcome !== "LOSS") return false;
  const r = Number(t?.gradedR);
  return Number.isFinite(r) && Math.abs(r - (0.5 * p.r1 - 0.5)) < 0.011;
}

/** "1:2.60" for TP1, "—" when the levels don't make a call. */
export const fmtRR = (r) => (r == null ? "—" : `1:${r.toFixed(2)}`);

/**
 * Where an OPEN call stands against the mark, without a position size: the price move in % and in R
 * (move ÷ distance to the stop). Public calls carry no size, so a dollar P&L would always read $0.00.
 * @returns {{ pct:number, r:number|null } | null}
 */
export function liveMove(t, mark) {
  const e = num(t?.entryPrice), m = num(mark), s = num(t?.stopLoss);
  if (!(e > 0 && m > 0)) return null;
  const delta = isLong(t) ? m - e : e - m;
  const risk = isLong(t) ? e - s : s - e;
  return { pct: (delta / e) * 100, r: s > 0 && risk > 0 ? delta / risk : null };
}

/** "+0.42R · +1.30%" (U+2212 for negatives). */
export function fmtLiveMove(mv) {
  if (!mv) return "—";
  const sg = (v) => (v < 0 ? "−" : "+");
  const pct = `${sg(mv.pct)}${Math.abs(mv.pct).toFixed(2)}%`;
  return mv.r == null ? pct : `${sg(mv.r)}${Math.abs(mv.r).toFixed(2)}R · ${pct}`;
}
