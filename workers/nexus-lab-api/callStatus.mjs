// ── Where a wallet's calls stand, and the moments worth a ping ───────────────────────────────────
// Two things an agent running a strategy needs without reading a page:
//   1. callStatusRow — one call's state (WORKING / OPEN / RUNNER / UNCHECKED, or its grade) and how
//      far the live mark is from each of its levels, in % and in R. Served by GET /theses/status/:wallet.
//   2. fillEvents — what the hourly pass just changed that the owner should hear about: a resting
//      order that filled (FILL), a declared split whose first half closed (TP1). Sent like a
//      resolution (in-app + phone push + Telegram), after the record is written.
//
// Two clocks, never mixed: the STATE comes from the hourly grader's stamps (fillState, filledAt,
// tp1HitAt, gradedOutcome), the DISTANCES from a live mark. A live mark through the entry is not a
// fill until the grader says so (an hour's high/low decides that, not one mark read).
// Pure; display and alerts only. Nothing here changes a grade.
import { callLifecycle } from "../../app/lib/callLifecycle.mjs";
import { callR, splitPlan } from "./logic.mjs";

const r2 = (n) => Math.round(n * 100) / 100;
const bare = (s) => String(s || "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");

/** WIN / LOSS (graded) · CLOSED (closed another way) · WORKING · OPEN · RUNNER (split, TP1 half done) · UNCHECKED. */
export function callState(t) {
  if (t?.gradedOutcome === "WIN" || t?.gradedOutcome === "LOSS") return t.gradedOutcome;
  const lc = callLifecycle(t);
  if (lc === "OPEN" && t.tp1HitAt) return "RUNNER";
  return lc;
}

/**
 * One call as an agent reads it. `mark` = the live Orderly mark for its market, or null.
 * levels.*.pct = (level − mark) / mark, signed; levels.*.r = |level − mark| in units of the call's
 * risk (entry to stop). moveR = the open position's move in R, signed in the trade's direction.
 */
export function callStatusRow(t, mark) {
  const long = String(t.direction).toUpperCase() === "LONG";
  const entry = Number(t.entryPrice), stop = Number(t.stopLoss), tp1 = Number(t.takeProfit1), tp2 = Number(t.takeProfit2) || 0;
  const risk = Math.abs(entry - stop);
  const state = callState(t);
  const split = splitPlan(t);
  const row = {
    id: t.id, symbol: t.symbol, direction: long ? "LONG" : "SHORT",
    entryPrice: entry, stopLoss: stop, takeProfit1: tp1, takeProfit2: tp2 > 0 ? tp2 : null,
    exitPlan: t.exitPlan ?? null,
    plannedR: { tp1: callR(t), tp2: split && !split.invalid ? split.r2 : null },
    postedAt: t.createdAt ?? null,
    state,
    filledAt: t.filledAt ?? null,
    tp1HitAt: t.tp1HitAt ?? null,
    graded: state === "WIN" || state === "LOSS" ? { outcome: state, r: t.gradedR ?? null, at: t.gradedAt ?? null } : null,
    live: null,
  };
  const m = Number(mark);
  if (!(m > 0) || !(risk > 0) || row.graded || state === "CLOSED") return row;
  const away = (lvl) => ({ price: lvl, pct: r2(((lvl - m) / m) * 100), r: r2(Math.abs(lvl - m) / risk) });
  row.live = { mark: m, levels: { entry: away(entry), stop: away(stop), tp1: away(tp1), ...(tp2 > 0 ? { tp2: away(tp2) } : {}) } };
  if (state === "OPEN" || state === "RUNNER") row.live.moveR = r2((long ? m - entry : entry - m) / risk);
  if (state === "WORKING") {
    // Which side of the entry the market sat on at the post vs now. A change means price has been
    // through the entry since; the hourly grade decides whether that was a fill.
    const pm = Number(t.publishMark?.px);
    row.live.crossedEntrySincePost = pm > 0 ? Math.sign(pm - entry) !== Math.sign(m - entry) : null;
  }
  return row;
}

/**
 * What the pass changed that the owner should hear about. `before` = the call's fillState and
 * tp1HitAt before the pass. A call filled AT the post isn't news (it was live from the start): FILL
 * is only a resting order that traded later (filledAt after the post).
 * @returns {("FILL"|"TP1")[]}
 */
export function fillEvents(before, t) {
  const out = [];
  if (t.fillState === "OPEN" && before?.fillState !== "OPEN" && Number(t.filledAt) > Number(t.createdAt)) out.push("FILL");
  if (t.tp1HitAt && !before?.tp1HitAt) out.push("TP1");
  return out;
}

/** The words for one event. Plain, like a resolution: what happened and what's next. */
export function fillEventMessage(t, kind) {
  const sym = bare(t?.symbol), dir = String(t?.direction || "").toUpperCase();
  if (kind === "TP1") {
    const r = callR(t);
    const banked = r == null ? "" : ` · half closed +${r2(r / 2)}R`;
    return { type: "call_tp1", message: `${sym} ${dir} reached TP1 ${t.takeProfit1}${banked} · runner open to ${t.takeProfit2}, stop ${t.stopLoss}` };
  }
  return { type: "call_fill", message: `${sym} ${dir} filled at ${t.entryPrice} · the call is live and graded from here · stop ${t.stopLoss}, TP1 ${t.takeProfit1}` };
}
