// "Post this position as a call": the Trade page's hand-off from an open Orderly position to the Lab's
// call draft (localStorage nexus_thesis_draft, the contract every board uses). Display + draft only:
// nothing here publishes, signs or touches the position.
//
// The rules, each one there for the grader (lab-api gradeCall):
//   - SIDE = the position's side (qty > 0 = LONG, < 0 = SHORT).
//   - ENTRY = the Orderly MARK at the tap, never the position's average open price. A call starts when it
//     is published; an old fill price would make it a resting order at a level price already left
//     (entryAtMark.mjs: only an entry within 0.3% of the market fills at the post).
//   - STOP / TARGET = the position's own TP/SL triggers, only when they sit on the right side of the mark
//     (LONG: stop < mark < target; SHORT: target < mark < stop). A level on the wrong side would make the
//     call INVALID (callMath callInvalidReason), so it's dropped and the trader sets it.
//   - Nothing about size, margin or P&L leaves the account: the draft carries prices only.

import { bareTicker } from "./bookRisk.mjs";

const pos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const dpFor = (px) => (px >= 1000 ? 1 : px >= 1 ? 3 : 6);
const fmt = (px, dp) => String(Number(px.toFixed(dp)));

/**
 * @param {{ symbol:string, position_qty:number, mark_price:number, full_tp_sl?: { tp_trigger_price?:number, sl_trigger_price?:number } }} row
 * @returns {null | { symbol:string, direction:"LONG"|"SHORT", entryPrice:string, stopLoss?:string, takeProfit1?:string, notes:string }}
 */
export function positionCallDraft(row) {
  const qty = Number(row?.position_qty);
  const mark = pos(row?.mark_price);
  const sym = bareTicker(row?.symbol);
  if (!qty || !Number.isFinite(qty) || mark == null || !/^[A-Z0-9]{1,16}$/.test(sym)) return null;
  const direction = qty > 0 ? "LONG" : "SHORT";
  const dp = dpFor(mark);
  const tp = pos(row?.full_tp_sl?.tp_trigger_price);
  const sl = pos(row?.full_tp_sl?.sl_trigger_price);
  const tpOk = tp != null && (direction === "LONG" ? tp > mark : tp < mark);
  const slOk = sl != null && (direction === "LONG" ? sl < mark : sl > mark);
  const draft = { symbol: sym, direction, entryPrice: fmt(mark, dp) };
  if (slOk) draft.stopLoss = fmt(sl, dp);
  if (tpOk) draft.takeProfit1 = fmt(tp, dp);
  const kept = [slOk && "stop", tpOk && "target"].filter(Boolean);
  const dropped = [sl != null && !slOk && "stop", tp != null && !tpOk && "target"].filter(Boolean);
  draft.notes = [
    `Your ${sym} ${direction.toLowerCase()} as a call. Entry = the Orderly mark when you tapped: a call starts when it's posted, not at your fill.`,
    kept.length ? `${kept.join(" and ")} from your position's TP/SL.` : "",
    dropped.length ? `Your ${dropped.join(" and ")} sat on the wrong side of the market for a new call, so set ${dropped.length > 1 ? "them" : "it"} here.` : "",
    !kept.length && !dropped.length ? "Set your stop and target." : "",
  ].filter(Boolean).join(" ");
  return draft;
}

/** The open position on `symbol` (Orderly full symbol), or null. */
export function openPositionOn(rows, symbol) {
  const s = String(symbol || "");
  return (Array.isArray(rows) ? rows : []).find((r) => r && r.symbol === s && Number(r.position_qty) !== 0) || null;
}
