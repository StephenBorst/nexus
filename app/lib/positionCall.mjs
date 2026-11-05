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
//
// "Post this limit order as a call" (orderCallDraft): a RESTING limit entry maps onto a resting call. ENTRY = the
// order's limit price; the grader counts the call only once price trades there (filled at the post if the limit sits
// within 0.3% of the mark, else graded from its fill hour, never filled = PENDING), exactly like the order. Only plain
// entries qualify (LIMIT / POST_ONLY, not reduce-only: a reduce-only order closes a position, it isn't a call). The
// note says the one thing the trader must know: a published call is permanent, so cancelling the order later doesn't
// cancel the call. Levels: the trader sets stop and target in the Thesis Engine.

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

const ENTRY_ORDER_TYPES = new Set(["LIMIT", "POST_ONLY"]);

/** The newest resting limit ENTRY on `symbol` (Orderly full symbol), or null. */
export function restingEntryOrderOn(rows, symbol) {
  const s = String(symbol || "");
  const ok = (Array.isArray(rows) ? rows : []).filter((o) =>
    o && o.symbol === s && !o.reduce_only && ENTRY_ORDER_TYPES.has(String(o.type || "").toUpperCase())
    && (o.side === "BUY" || o.side === "SELL") && pos(o.price) != null && !o.algo_order_id
    && Number(o.quantity) > Number(o.executed || o.total_executed_quantity || 0));
  ok.sort((a, b) => (Number(b.created_time) || 0) - (Number(a.created_time) || 0));
  return ok[0] || null;
}

/**
 * @param {{ symbol:string, side:"BUY"|"SELL", type:string, price:number, reduce_only?:boolean }} order
 * @returns {null | { symbol:string, direction:"LONG"|"SHORT", entryPrice:string, notes:string }}
 */
export function orderCallDraft(order) {
  const px = pos(order?.price);
  const sym = bareTicker(order?.symbol);
  if (px == null || order?.reduce_only || !ENTRY_ORDER_TYPES.has(String(order?.type || "").toUpperCase())) return null;
  if (order?.side !== "BUY" && order?.side !== "SELL") return null;
  if (!/^[A-Z0-9]{1,16}$/.test(sym)) return null;
  const direction = order.side === "BUY" ? "LONG" : "SHORT";
  // The order's EXACT price (exchange prices are already on the tick): rounding would move the call's entry off
  // the order's, so the call could fill where the order didn't.
  const entryPrice = String(px);
  return {
    symbol: sym, direction, entryPrice,
    notes: `Your ${sym} limit ${order.side === "BUY" ? "buy" : "sell"} at ${entryPrice} as a call. It counts once price trades at your entry, like the order. Published calls are permanent: cancelling the order later won't cancel the call. Set your stop and target.`,
  };
}
