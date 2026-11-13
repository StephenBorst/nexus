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
  if (closed != null && exit > 0) out.push({ key: exitKeyOf(row), kind: "exit", symbol: row.symbol, t: closed, px: exit });
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
  return { fills: legs.length, judged, onTape: n.ON_TAPE, near: n.NEAR, off: n.OFF, noTrades: n.NO_TRADES, noData: n.NO_DATA, averaged: n.AVERAGED, pending: n.PENDING };
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
  return parts.join(" · ");
}
