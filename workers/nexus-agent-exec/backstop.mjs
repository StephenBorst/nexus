// ── The exchange-side backstop stop (docs/research/live-plan-level-reclaim.md §5, item 2) ──────────
// exec's own stop lives in this worker: checked once a minute, closed at market. If the worker stalls
// (an outage, a stuck cron, an expired key), an open live position has no stop at all. So each LIVE
// entry also rests a reduce-only stop on Orderly, WIDER than the agent's own (1.5× the stop
// distance from the entry). In normal operation it is never hit: exec's stop closes first. It only
// catches a stalled worker. Every exit exec makes cancels it.
//
// The order is Orderly's own "position TP/SL" with a stop-loss child only, built field for field the
// way @orderly.network/hooks builds it (TPSL order creator, FULL position): algo_type
// POSITIONAL_TP_SL, child STOP_LOSS / CLOSE_POSITION / MARK_PRICE trigger, reduce_only. A positional
// stop closes whatever is left of the position, so partial take-profits need no resize.
//
// Not covered, on purpose (stated so nobody assumes otherwise):
//   - DCA positions: the ladder adds below the entry by design; a stop sized off the base entry would
//     fire mid-ladder. DCA keeps exec's stop only.
//   - The trail and breakeven don't move it: it stays at its entry level. It is a stalled-worker net,
//     not a second copy of the exit logic.
//   - A position closed by the backstop isn't booked to agent_trades (the ledger books only closes
//     exec executes and reads the fill of). exec alerts the owner instead (backstopHit).
// Pure; tests: backstop.test.mjs.

export const BACKSTOP_MULT = 1.5;
export const BACKSTOP_MAX_TRIES = 5;       // placement attempts per position before the owner is told
export const BACKSTOP_CLEANUP_TRIES = 10;  // cancel attempts on a stale one before it is dropped (owner told)

/** Statuses the SDK treats as a positional TP/SL still working (hooks: root_algo_status NEW / REPLACED / PARTIAL_FILLED). */
const LIVE_STATUSES = new Set(["NEW", "REPLACED", "PARTIAL_FILLED"]);

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

/** Does this position get a backstop? Live, single-entry (not DCA), with a usable entry and stop. */
export function backstopWanted(pos) {
  if (!pos || pos.paper || pos.dca) return false;
  const entry = num(pos.entry_price), sl = num(pos.slPercent);
  return Number.isFinite(entry) && entry > 0 && Number.isFinite(sl) && sl > 0 && (pos.direction === "LONG" || pos.direction === "SHORT");
}

/**
 * The backstop's trigger price: BACKSTOP_MULT × the stop distance beyond the entry, snapped to the
 * quote tick AWAY from the entry (so rounding never makes it tighter than asked).
 * @returns {number|null}
 */
export function backstopTrigger({ direction, entryPrice, slPercent, quoteTick, mult = BACKSTOP_MULT }) {
  const entry = num(entryPrice), sl = num(slPercent), m = num(mult);
  if (!(entry > 0) || !(sl > 0) || !(m > 0) || (direction !== "LONG" && direction !== "SHORT")) return null;
  const dist = (sl * m) / 100;
  if (direction === "LONG" && dist >= 1) return null; // a long stop at or below zero isn't a stop
  const raw = direction === "LONG" ? entry * (1 - dist) : entry * (1 + dist);
  const tick = num(quoteTick) > 0 ? num(quoteTick) : null;
  if (!tick) return raw;
  const decimals = Math.max(0, Math.round(-Math.log10(tick)));
  const steps = direction === "LONG" ? Math.floor(raw / tick + 1e-9) : Math.ceil(raw / tick - 1e-9);
  const px = parseFloat((steps * tick).toFixed(decimals));
  return px > 0 ? px : null;
}

/** The POST /v1/algo/order body: a position stop-loss, as Orderly's SDK sends it. */
export function backstopOrder({ symbol, direction, triggerPrice }) {
  const side = direction === "LONG" ? "SELL" : "BUY";
  return {
    algo_type: "POSITIONAL_TP_SL",
    trigger_price_type: "MARK_PRICE",
    symbol,
    margin_mode: "CROSS",
    child_orders: [{
      algo_type: "STOP_LOSS",
      reduce_only: true,
      side,
      type: "CLOSE_POSITION",
      trigger_price: triggerPrice,
      trigger_price_type: "MARK_PRICE",
      symbol,
      is_activated: true,
    }],
  };
}

/** The algo order id from a POST /v1/algo/order reply, or null (refused / unreadable). */
export function algoOrderIdFrom(reply) {
  if (!reply || reply.success !== true) return null;
  const d = reply.data || {};
  const id = d.order_id ?? d.algo_order_id ?? d.rows?.[0]?.order_id ?? d.rows?.[0]?.algo_order_id;
  const n = num(id);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The DELETE path that cancels one algo order (query params, as the SDK sends them). */
export const cancelPath = ({ id, symbol }) => `/v1/algo/order?order_id=${encodeURIComponent(id)}&symbol=${encodeURIComponent(symbol)}`;

const statusOf = (reply) => {
  if (!reply || reply.success !== true || !reply.data) return null;
  const s = reply.data.root_algo_status ?? reply.data.algo_status ?? reply.data.status;
  return typeof s === "string" && s ? s.toUpperCase() : null;
};

/** A GET /v1/algo/order/{id} reply says the order no longer works (cancelled, filled, rejected…). Unreadable = false. */
export function algoTerminal(reply) {
  const s = statusOf(reply);
  return s !== null && !LIVE_STATUSES.has(s);
}

/** Did the backstop fire? Triggered root or child, or a FILLED one. Unreadable = false (never guessed). */
export function backstopHit(reply) {
  if (!reply || reply.success !== true || !reply.data) return false;
  const d = reply.data;
  const kids = Array.isArray(d.child_orders) ? d.child_orders : [];
  const fired = (o) => o?.is_triggered === true || String(o?.algo_status || o?.status || "").toUpperCase() === "FILLED";
  return fired(d) || statusOf(reply) === "FILLED" || kids.some(fired);
}

/**
 * One pass over the stale backstops left by closes whose cancel didn't go through.
 * @param {Array<{id, symbol, tries?}>} list
 * @param {object} io { cancel(item) → reply, status(item) → reply }
 * @returns {Promise<{ left: Array, done: Array, dropped: Array }>}
 */
export async function sweepStaleBackstops(list, io) {
  const left = [], done = [], dropped = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || !item.id || !item.symbol) continue;
    let ok = false;
    try { ok = (await io.cancel(item))?.success === true; } catch { ok = false; }
    if (!ok) { try { ok = algoTerminal(await io.status(item)); } catch { ok = false; } }
    if (ok) { done.push(item); continue; }
    const tries = (Number(item.tries) || 0) + 1;
    if (tries >= BACKSTOP_CLEANUP_TRIES) dropped.push({ ...item, tries });
    else left.push({ ...item, tries });
  }
  return { left, done, dropped };
}
