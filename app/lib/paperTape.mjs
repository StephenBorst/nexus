// ── Paper fills, checked against the public tape ────────────────────────────────────────────────────
// borst, 2026-11-13: "verifying paper agent trades against the public minute tape kills the last 'trust our
// server' skepticism on arena and /proof."
//
// A paper trade is a row our own exec wrote: an entry price, an exit price, two times. Nothing traded on an
// exchange, so nothing outside us vouches for it. This checks each fill against Orderly's PUBLIC 1-minute
// bars for the minute it was taken: did the market actually trade at that price then?
//
//   ON_TAPE    the price sits inside that minute's traded low–high (or the minute before: exec reads the
//              price a moment before it stamps the row, and a read at 12:00:59 can be stamped 12:01:00).
//   NEAR       outside it by ≤ TAPE_TOL_BPS. Paper fills at the MARK, an index price, not a trade: at a
//              minute's extreme the mark can sit a hair beyond the trades. Said as near, with the distance.
//   OFF        further out. Shown with its distance; never hidden.
//   NO_TRADES  Orderly printed no bar in either minute (no trades), so there's nothing to check against.
//   AVERAGED   a DCA position's entry is the blended average of several adds: no single price traded. Its
//              entry is labelled, not judged (its exit still is).
//
// TRIGGER CHECK (2026-11-13, borst's go). A stop or target exit fires when the MARK crosses its level. The
// mark can spike past a level that no trade ever reached: a "phantom" stop, a measurement error on paper and
// real money lost to an index wick live. For an SL or TP row whose level the row carries (`sl_percent`,
// `tp_percent`: exec stamps both on paper rows, record only), the exit check also asks: did the tape trade
// at or through that level in the minutes up to the exit?
//   TRADED      some bar from 2 minutes before the exit's minute through that minute reached the level
//               (exec checks once a minute, so the cross happened inside that span)
//   MARK_ONLY   no bar reached it: the exit fired on the mark alone. Shown with how far the tape stayed off.
// TRAIL / BE / TIMEOUT / KILLED / WEBHOOK_CLOSE and TP ladders carry no fixed level: nothing to judge.
//
// Pure. The checker that fetches the bars and keeps the evidence is lab-api paperTape.mjs (hourly, read-only
// on agent state: exec writes the trades, something else checks them). Paper exits stay market-order exits
// at the mark, as live executes: this checks that the price was real, not that a wick could have filled it.

export const TAPE_TOL_BPS = 10;
const MIN = 60;

const ms = (v) => { const n = typeof v === "number" ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };

/** The key of a position's entry fill: shared by the open position and every row it closes into. */
export const entryKey = (symbol, openedMs) => `e:${symbol}:${openedMs}`;
/** The key of one closed row's exit fill. */
export const exitKey = (rowId) => `x:${rowId}`;
/** A row's exit key: its id (exec stamps `paper_<ms>`), else its market + close time, so no row is skipped. */
export const exitKeyOf = (row) => exitKey(row?.id || `${row?.symbol}:${ms(row?.closed_at)}`);

/**
 * The level a stop or target exit fired at, from the row's own stop/target %, or null (no fixed level, or the
 * row doesn't carry it, or its entry is a DCA average). `side`: STOP or TARGET.
 */
export function exitLevel(row) {
  const e = Number(row?.entry_price);
  if (!(e > 0) || row?.entry_avg) return null;
  const long = row?.direction !== "SHORT";
  const sl = Number(row?.sl_percent), tp = Number(row?.tp_percent);
  if (row?.reason === "SL" && sl > 0) return { side: "STOP", long, px: e * (1 + (long ? -sl : sl) / 100) };
  if (row?.reason === "TP" && tp > 0) return { side: "TARGET", long, px: e * (1 + (long ? tp : -tp) / 100) };
  return null;
}

/**
 * Did the tape trade at or through an exit's level in the minutes up to the exit (TRADED), or did the exit fire
 * on the mark alone (MARK_ONLY, with `bps` = how far the tape's extreme stayed from the level)?
 * @returns {{ verdict: "TRADED"|"MARK_ONLY"|"NO_TRADES", level: number, bps?: number }}
 */
export function judgeTrigger(level, tMs, bars) {
  const m = Math.floor(tMs / 1000 / MIN) * MIN;
  const span = (Array.isArray(bars) ? bars : []).filter((b) => Array.isArray(b) && b[0] >= m - 2 * MIN && b[0] <= m);
  const lvl = Math.round(level.px * 1e8) / 1e8;
  if (!span.length) return { verdict: "NO_TRADES", level: lvl };
  const lo = Math.min(...span.map((b) => Number(b[3]))), hi = Math.max(...span.map((b) => Number(b[2])));
  // A long's stop / a short's target is below the price: the tape must reach DOWN to it. Else UP.
  const below = (level.side === "STOP") === level.long;
  const reached = below ? lo <= level.px : hi >= level.px;
  if (reached) return { verdict: "TRADED", level: lvl };
  const bps = Math.round(((below ? lo - level.px : level.px - hi) / level.px) * 10_000 * 10) / 10;
  return { verdict: "MARK_ONLY", level: lvl, bps };
}

/** The fills one closed paper row asks to check: [{ key, kind, symbol, t (ms), px }] plus averaged entries. */
export function legsOf(row) {
  const out = [];
  if (!row || !row.symbol) return out;
  const opened = ms(row.opened_at), closed = ms(row.closed_at);
  const entry = Number(row.entry_price), exit = Number(row.exit_price);
  if (opened != null && entry > 0) {
    out.push(row.entry_avg
      ? { key: entryKey(row.symbol, opened), kind: "entry", symbol: row.symbol, t: opened, px: entry, averaged: true }
      : { key: entryKey(row.symbol, opened), kind: "entry", symbol: row.symbol, t: opened, px: entry });
  }
  if (closed != null && exit > 0) {
    const level = exitLevel(row);
    out.push({ key: exitKeyOf(row), kind: "exit", symbol: row.symbol, t: closed, px: exit, ...(level ? { level } : {}) });
  }
  return out;
}

/** The entry fill of an open PAPER position (a DCA one is averaged), or null. */
export function openLeg(pos) {
  if (!pos || !pos.paper || !pos.symbol) return null;
  const opened = ms(pos.opened_at), px = Number(pos.dca ? pos.base_entry_price : pos.entry_price);
  if (opened == null || !(px > 0)) return null;
  return { key: entryKey(pos.symbol, opened), kind: "entry", symbol: pos.symbol, t: opened, px };
}

/** Every fill a wallet's paper state asks to check, newest first, one per key. */
export function walletLegs(state) {
  const seen = new Map();
  const pos = openLeg(state?.current_position);
  if (pos) seen.set(pos.key, pos);
  for (const row of Array.isArray(state?.paper_trades) ? state.paper_trades : []) {
    for (const leg of legsOf(row)) if (!seen.has(leg.key)) seen.set(leg.key, leg);
  }
  return [...seen.values()].sort((a, b) => b.t - a.t);
}

/**
 * Judge one fill against the bars around it ([[t, o, h, l, c], …], t in seconds).
 * @returns {{ verdict: "ON_TAPE"|"NEAR"|"OFF"|"NO_TRADES", bps?: number, bar?: number[] }}
 */
export function judgeFill(px, tMs, bars) {
  const m = Math.floor(tMs / 1000 / MIN) * MIN;
  const near = (Array.isArray(bars) ? bars : []).filter((b) => Array.isArray(b) && (b[0] === m || b[0] === m - MIN));
  if (!near.length) return { verdict: "NO_TRADES" };
  let best = null;
  for (const b of near) {
    const h = Number(b[2]), l = Number(b[3]);
    if (px >= l && px <= h) return { verdict: "ON_TAPE", bps: 0, bar: b };
    const d = (px < l ? l - px : px - h) / px * 10_000;
    if (!best || d < best.d) best = { d, b };
  }
  const bps = Math.round(best.d * 10) / 10;
  return { verdict: bps <= TAPE_TOL_BPS ? "NEAR" : "OFF", bps, bar: best.b };
}

const VERDICTS = ["ON_TAPE", "NEAR", "OFF", "NO_TRADES", "NO_DATA", "AVERAGED", "PENDING"];

/**
 * Count the checks over a wallet's fills. `checks` = key → stored check ({ verdict, … }); a fill with no check
 * yet counts as PENDING.
 */
export function tapeSummary(legs, checks) {
  const n = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  for (const leg of legs) {
    const v = leg.averaged ? "AVERAGED" : checks?.[leg.key]?.verdict || "PENDING";
    n[VERDICTS.includes(v) ? v : "PENDING"]++;
  }
  const judged = n.ON_TAPE + n.NEAR + n.OFF;
  // Stop / target exits whose trigger was checked, and those that fired on the mark alone.
  let triggers = 0, markOnly = 0;
  for (const leg of legs) {
    const t = leg.level ? checks?.[leg.key]?.trigger?.verdict : null;
    if (t === "TRADED" || t === "MARK_ONLY") triggers++;
    if (t === "MARK_ONLY") markOnly++;
  }
  return { fills: legs.length, judged, onTape: n.ON_TAPE, near: n.NEAR, off: n.OFF, noTrades: n.NO_TRADES, noData: n.NO_DATA, averaged: n.AVERAGED, pending: n.PENDING, triggers, markOnly };
}

/** Add two summaries (an Arena operator's wallets read as one slot). */
export function addSummaries(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return Object.fromEntries(Object.keys(a).map((k) => [k, (a[k] || 0) + (b[k] || 0)]));
}

/** The one line a page prints for a summary, or null when there's nothing judged yet. Plain words, no claim beyond the counts. */
export function tapeLine(s) {
  if (!s || !s.judged) return null;
  const parts = [`${s.onTape} of ${s.judged} paper fills traded inside Orderly’s public 1-minute range`];
  if (s.near) parts.push(`${s.near} within ${TAPE_TOL_BPS / 100}%`);
  parts.push(`${s.off} off`);
  if (s.triggers) parts.push(s.markOnly ? `${s.markOnly} of ${s.triggers} stop/target exits fired on the mark with no trade at the level` : `all ${s.triggers} stop/target exits traded at their level`);
  return parts.join(" · ");
}

// ── Live fills, on the same tape (borst 2026-11-13, the $10 live test's readiness) ───────────────────
// A live fill is the exchange's own (`average_executed_price`, exec books it; app/lib/slippage.mjs keeps each one
// with its mark in `state.live_slip`). It is a trade, so it should sit inside its minute's range: ON_TAPE. This
// checks that the price the record shows is the price the market printed, by a reader that isn't exec. Kept
// apart from the paper fills (LIVE and PAPER never mix): its own keys, summary and line. Only exchange-confirmed
// fills are recorded; a fill that fell back to the mark is unknown and isn't checked.

/** The key of one live fill: its Orderly order id, else its market, kind and time. */
export const liveKey = (r) => `l:${r?.order_id != null ? r.order_id : `${r?.symbol}:${r?.kind}:${ms(r?.t)}`}`;

/** A wallet's live fills to check, newest first: [{ key, kind: "live_<kind>", symbol, t, px, live: true }]. */
export function liveLegs(state) {
  const out = [];
  for (const r of Array.isArray(state?.live_slip) ? state.live_slip : []) {
    const t = ms(r?.t), px = Number(r?.fill);
    if (t == null || !(px > 0) || !r?.symbol) continue;
    out.push({ key: liveKey(r), kind: `live_${r.kind}`, symbol: r.symbol, t, px, live: true, ...(r.order_id != null ? { orderId: String(r.order_id) } : {}) });
  }
  return out.sort((a, b) => b.t - a.t);
}

/** The one line for live fills, or null when none is judged yet. */
export function liveTapeLine(s) {
  if (!s || !s.judged) return null;
  const parts = [`${s.onTape} of ${s.judged} live fills sit inside Orderly’s public 1-minute range`];
  if (s.near) parts.push(`${s.near} within ${TAPE_TOL_BPS / 100}%`);
  parts.push(`${s.off} off`);
  return parts.join(" · ");
}
