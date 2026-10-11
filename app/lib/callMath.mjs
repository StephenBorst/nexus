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
