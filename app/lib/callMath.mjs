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

/**
 * The exit plan a COPY of a call carries: the source's declared split, or none. A copy that keeps
 * `takeProfit2` but drops `exitPlan` is graded TP1-only, a different trade from the source (BankrBot
 * review, 2026-10-26: entry 100, stop 90, TP1 120, TP2 140, TP1 then the stop grades +0.5R on the
 * source and +2R on such a copy). Every copy flow builds the field from this.
 */
export const copiedExitPlan = (source) => (source?.exitPlan === SPLIT_EXIT ? SPLIT_EXIT : undefined);

/**
 * Why the grader can never grade this call, from its levels alone, or null. Published calls are
 * frozen, so this is permanent. (gradeCall also answers INVALID when it has no candles; that is a
 * missing read, not this.)
 */
export function callInvalidReason(t) {
  if (!(num(t?.entryPrice) > 0 && num(t?.stopLoss) > 0 && num(t?.takeProfit1) > 0)) return "entry, stop or target missing";
  if (callRR(t) == null) return "stop or target on the wrong side of entry";
  if (splitPlan(t)?.invalid) return "split exit with TP2 not beyond TP1";
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
