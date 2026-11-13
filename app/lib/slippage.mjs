// ── Live slippage: what the exchange filled vs the mark exec decided on ─────────────────────────────────
// borst, 2026-11-13: measure execution the honest way. Paper fills AT the mark, so it has no slippage by
// construction; only LIVE orders can say what execution costs. Since 2026-11-06 exec books each live market
// order at Orderly's own fill (`average_executed_price`, logic.mjs fillPriceFrom). Here that fill is compared
// with the mark the order was decided on:
//
//   bps = (fill − mark) ÷ mark × 10 000, signed so POSITIVE = paid worse than the mark
//         (a buy filled above it, a sell filled below it); negative = price improvement.
//
// Only fills the exchange confirmed count (`source: "exchange"`). One that fell back to the mark is unknown,
// not zero: it is left out, never booked as 0 bps.
//
// Pure. exec keeps the last SLIP_KEEP records in `agent:state` (`live_slip`, exec-owned like the rest of the
// state); lab-api serves them at GET /agent/:a/slippage. Display + record: nothing trades on it. Its use: the
// live plan judges after costs, and paper P&L carries none (no fees, funding or slippage).

export const SLIP_KEEP = 100;
export const ORDER_KINDS = ["entry", "add", "partial", "close"];

const r1 = (x) => Math.round(x * 10) / 10;

/** The side of an order: an entry or DCA add trades WITH the position, a partial or close AGAINST it. */
export function orderSide(direction, kind) {
  const long = String(direction).toUpperCase() !== "SHORT";
  const opening = kind === "entry" || kind === "add";
  return long === opening ? "BUY" : "SELL";
}

/** Signed slippage in bps (positive = worse than the mark), or null when either price is unusable. */
export function slippageBps(side, mark, fill) {
  const m = Number(mark), f = Number(fill);
  if (!(m > 0) || !(f > 0)) return null;
  const raw = (f - m) / m * 10_000;
  return r1(side === "SELL" ? -raw : raw);
}

/**
 * One record for a live order the exchange confirmed, or null (paper, a mark fallback, a bad price).
 * @param {{ t:number, symbol:string, direction:string, kind:string, mark:number, fill:{price:number, source:string}|null, orderId?:any }} o
 */
export function slipRecord({ t, symbol, direction, kind, mark, fill, orderId }) {
  if (!fill || fill.source !== "exchange" || !ORDER_KINDS.includes(kind)) return null;
  const side = orderSide(direction, kind);
  const bps = slippageBps(side, mark, fill.price);
  if (bps == null) return null;
  return { t: Number(t), symbol, kind, side, mark: Number(mark), fill: Number(fill.price), bps, ...(orderId != null ? { order_id: String(orderId) } : {}) };
}

/** Newest first, capped. Returns a new list. */
export function pushSlip(list, rec, keep = SLIP_KEEP) {
  if (!rec) return Array.isArray(list) ? list : [];
  return [rec, ...(Array.isArray(list) ? list : [])].slice(0, keep);
}

function stats(bps) {
  if (!bps.length) return { n: 0 };
  const s = [...bps].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  return {
    n: s.length,
    medianBps: r1(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2),
    meanBps: r1(s.reduce((a, b) => a + b, 0) / s.length),
    p90Bps: r1(q(0.9)),
    worstBps: r1(s[s.length - 1]),
  };
}

/** The summary a page prints: overall and per order kind. n = 0 = nothing measured (never "0 bps"). */
export function slippageSummary(list) {
  const rows = (Array.isArray(list) ? list : []).filter((r) => r && Number.isFinite(r.bps));
  return {
    ...stats(rows.map((r) => r.bps)),
    byKind: Object.fromEntries(ORDER_KINDS.map((k) => [k, stats(rows.filter((r) => r.kind === k).map((r) => r.bps))])),
  };
}

/** One plain line, or null when nothing was measured. */
export function slippageLine(s) {
  if (!s || !s.n) return null;
  const sign = (x) => (x > 0 ? `+${x}` : `${x}`);
  return `Live slippage over ${s.n} exchange fill${s.n === 1 ? "" : "s"}: median ${sign(s.medianBps)} bps, worst ${sign(s.worstBps)} bps (positive = paid worse than the mark)`;
}
