// The copilot's view of three Lab panels (2026-11-15): funding across venues, the events calendar and the risk desk.
// Each shaper takes what the panel itself reads (the same route reply, the same riskDesk() result) and returns a small
// object for the model, built with the panel's own rules, so the copilot and the screen say the same thing. Facts
// only: no side, no score, no advice. An unread source stays named in `unread`, never turned into "nothing".
// Pure, tested (copilotLab.test.mjs).

import { venueLine, VENUE_NOTE } from "./crossFunding.mjs";
import { untilWords, eventDetail, CALENDAR_NOTE } from "./eventsCalendar.mjs";
import { riskLine, usd, RISK_NOTE } from "./riskDesk.mjs";
import { watchRow } from "./watchlist.mjs";

const DAY = 86_400_000;
const bare = (c) => String(c ?? "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "").replace(/[^A-Z0-9]/g, "");
const unreadOf = (r) => (Array.isArray(r?.unread) ? r.unread : []);

/**
 * GET /intel/funding-venues[/:coin] → the copilot's answer.
 * One coin: its row + line. The board: the `max` widest gaps (rows arrive sorted by gap).
 * @param {any} reply
 * @param {{ coin?: string|null, max?: number }} [opts]
 */
export function venuesForCopilot(reply, { coin = null, max = 8 } = {}) {
  if (!reply || typeof reply !== "object") return { error: "funding across venues unavailable" };
  const unread = unreadOf(reply);
  const view = (r) => ({ coin: r.coin, orderly_pct_yr: r.orderly, hyperliquid_pct_yr: r.hyperliquid, okx_pct_yr: r.okx, gap_pts_yr: r.gap, line: venueLine(r) });
  if (coin) {
    const row = reply.row ?? (Array.isArray(reply.rows) ? reply.rows.find((r) => r.coin === bare(coin)) : null);
    if (!row) return { coin: bare(coin), listed: false, note: `No funding row for ${bare(coin)} on Orderly.`, unread };
    return { ...view(row), unread, note: VENUE_NOTE };
  }
  const rows = Array.isArray(reply.rows) ? reply.rows : [];
  if (!rows.length) return { error: "funding across venues unavailable", unread };
  return { widest_gaps: rows.filter((r) => r.gap != null).slice(0, max).map(view), coins_listed: rows.length, unread, note: VENUE_NOTE };
}

/**
 * GET /intel/calendar → what is scheduled in the next `days` days, optionally only rows touching `coin` (macro rows
 * touch every coin, so they stay). Times in UTC plus "in 2h 10m"; the model has no viewer time zone.
 * @param {any} reply
 * @param {{ now?: number, days?: number, coin?: string|null, max?: number }} [opts]
 */
export function calendarForCopilot(reply, { now = Date.now(), days = 7, coin = null, max = 15 } = {}) {
  if (!reply || typeof reply !== "object" || !Array.isArray(reply.events)) return { error: "events calendar unavailable" };
  const span = Math.min(Math.max(Number(days) || 7, 1), 45) * DAY;
  const c = coin ? bare(coin) : null;
  const rows = reply.events
    .filter((e) => Number.isFinite(e?.at) && e.at <= now + span)
    .filter((e) => !c || e.kind === "MACRO" || (e.coins ?? []).includes(c));
  return {
    events: rows.slice(0, max).map((e) => ({
      kind: e.kind, title: e.title, at_utc: new Date(e.at).toISOString().replace(".000", ""), when: untilWords(e.at, now), detail: eventDetail(e),
    })),
    more: Math.max(0, rows.length - max),
    unread: unreadOf(reply),
    ...(reply.macroStale ? { macro_stale: true } : {}),
    note: CALENDAR_NOTE.replace("Times in your time zone. ", "Times in UTC. "),
  };
}

/** riskDesk() (the Lab's YOUR OPEN RISK) → the copilot's answer. Null desk = the account isn't read. */
export function riskForCopilot(desk) {
  if (!desk || !Array.isArray(desk.positions)) return { error: "open positions not read (is the trading account connected?)" };
  if (!desk.positions.length) return { open_positions: 0, note: "No open positions." };
  return {
    open_positions: desk.positions.length,
    positions: desk.positions.map((p) => ({
      coin: p.coin, side: p.side, notional: usd(p.notional),
      liquidation_pct_away: p.liqDistPct,
      stop: p.stop.kind === "full" ? (p.stop.pastLiq ? "past liquidation (never fires)" : p.stop.lockedIn ? "locks in profit" : `loses ${usd(p.stop.loss)}`) : p.stop.kind === "partial" ? "on part only" : "none",
      funding_per_day: p.fundingPerDay == null ? null : usd(p.fundingPerDay),
      line: riskLine(p),
    })),
    book: {
      equity: desk.equity == null ? null : usd(desk.equity),
      gross: usd(desk.gross), net: usd(desk.net),
      exposure_x: desk.leverage,
      at_stops: usd(desk.atStops), at_stops_pct_of_account: desk.atStopsPct,
      unstopped: desk.unstopped,
      funding_per_day: desk.fundingPerDay == null ? null : usd(desk.fundingPerDay),
    },
    flags: (desk.flags ?? []).map((f) => `${f.level === "warn" ? "WARN" : "WATCH"}: ${f.text}`),
    note: `${RISK_NOTE} funding_per_day: negative = this book pays, positive = it earns.`,
  };
}

/**
 * The trader's Watching list (this device, nx_watchlist_v1) + GET /intel/markets?coins= → the panel's rows, by its own
 * rule (watchRow). Read only: asking in chat never moves the "since your last look" baseline (the panel does that).
 * @param {{ coins?: string[], seen?: Record<string, any> }} watch
 * @param {any} reply
 */
export function watchlistForCopilot(watch, reply) {
  const coins = Array.isArray(watch?.coins) ? watch.coins : [];
  if (!coins.length) return { watching: 0, note: "Nothing on the Watching list. Open a coin (tap its name anywhere) and press ☆ Watch; up to 10, kept on this device." };
  if (!reply || !Array.isArray(reply.coins)) return { watching: coins.length, coins, error: "live prices unread right now" };
  const live = Object.fromEntries(reply.coins.map((c) => [c.coin, c]));
  const pct = (v) => (v == null ? null : Math.round(v * 100) / 100);
  return {
    watching: coins.length,
    rows: coins.map((c) => {
      const r = watchRow(c, live[c] ?? null, watch.seen?.[c]);
      if (r.unread) return { coin: r.coin, unread: true };
      return {
        coin: r.coin, price: r.price, change_24h_pct: pct(r.change24hPct),
        since_last_look_pct: pct(r.sincePct), last_look: r.sinceAt ? new Date(r.sinceAt).toISOString().replace(/\.\d{3}/, "") : null,
        changed_since: r.first ? "first look: watching from now" : r.changes,
      };
    }),
    note: "The Watching panel on Lab home, read as is. 'changed_since' = the same changes the market alerts fire on (funding stretched, 2× smart-money consensus formed or flipped, forecast ±15 pts). Inputs, not a grade.",
  };
}
