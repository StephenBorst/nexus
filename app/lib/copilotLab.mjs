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

// ── The user's (or any wallet's) published calls, as GET /theses/status/:wallet reads them (2026-11-16) ─────────────
// Public calls only, the same set /feed shows. The state is the grader's stamp; a live mark is distance, never a grade:
// a mark through the entry is a fill only once the grader says so (the route's own note).
export const CALL_STATE_WORDS = Object.freeze({
  WORKING: "waiting for the entry to trade",
  OPEN: "live (the entry traded)",
  RUNNER: "split call, first target hit, second half running",
  UNCHECKED: "posted, not checked by the grader yet",
  INVALID: "can never be graded (levels on the wrong side); stays published, counts nowhere",
});

// How a graded call closed, when it wasn't a plain TP / stop (declared time stop; plans v2's breakeven runner).
const EXIT_WORDS = Object.freeze({ TIME: "time stop", TRAIL: "runner closed on its trailing stop after the first target", BE: "runner stopped out at the entry after the first target" });

/** @param {any} reply GET /theses/status/:wallet  @param {{ max?: number }} [opts] */
export function callsForCopilot(reply, { max = 8 } = {}) {
  if (!reply || typeof reply !== "object" || !Array.isArray(reply.calls)) return { error: "calls unavailable right now" };
  const iso = (ms) => (Number(ms) > 0 ? new Date(Number(ms)).toISOString().replace(/\.\d{3}/, "") : null);
  const coin = (s) => String(s || "").replace(/^PERP_/, "").replace(/_USDC$/, "");
  const open = reply.calls.slice(0, max).map((c) => ({
    coin: coin(c.symbol), side: c.direction, state: CALL_STATE_WORDS[c.state] || c.state,
    entry: c.entryPrice, stop: c.stopLoss, target: c.takeProfit1, target2: c.takeProfit2 ?? undefined,
    planned_r: c.plannedR?.tp1 ?? null, time_stop_h: c.timeStopH ?? undefined,
    posted_utc: iso(c.postedAt), filled_utc: iso(c.filledAt) ?? undefined,
    ...(c.invalidReason ? { invalid_reason: c.invalidReason } : {}),
    ...(c.live ? {
      mark: c.live.mark,
      ...(c.live.moveR != null ? { move_r: c.live.moveR } : {}),
      stop_away_r: c.live.levels?.stop?.r ?? null, target_away_r: c.live.levels?.tp1?.r ?? null,
      ...(c.live.crossedEntrySincePost != null ? { price_crossed_entry_since_post: c.live.crossedEntrySincePost } : {}),
    } : {}),
  }));
  const recent = (Array.isArray(reply.recent) ? reply.recent : []).slice(0, 5).map((c) => ({
    coin: coin(c.symbol), side: c.direction, outcome: c.graded?.outcome ?? c.state, r: c.graded?.r ?? null,
    exit: EXIT_WORDS[c.exitReason] ?? undefined, graded_utc: iso(c.graded?.at),
  }));
  return {
    counts: reply.counts ?? null,
    open_calls: open, more_open: Math.max(0, reply.calls.length - max),
    recent_graded: recent,
    ...(reply.marksAvailable === false ? { marks: "unread right now: no live distances" } : reply.marksStale ? { marks: `stale (${reply.markAgeSec}s old)` } : {}),
    note: "state = the grader's stamp. mark / move_r / *_away_r are live distances in units of the call's risk, not a grade: a mark through the entry is a fill only once the grader stamps it. Public calls only.",
  };
}

// ── The signal scoreboard in chat, with the tide (2026-11-16, borst: "copilot knows the tide") ──────────────────────
// GET /intel/axis-backtest → the copilot's answer. Every axis on recorded history (in-sample) as before, plus each
// REGISTERED read's served stage and its OUT-OF-SAMPLE split per side against a random entry on that side, so the model
// can say "its shorts made +0.5R but a random short made +0.7R" instead of praising a side that rode the market.
const sideVsRandom = (sides, random, side) => {
  const s = sides?.[side], rb = random?.bySide?.[side];
  const events = s?.events ?? 0;
  if (!events) return null;
  if (!rb || rb.verdict === "TOO_FEW" || rb.pctBeaten == null) return { events, read_mean_r: s?.r?.meanR ?? null, vs_random: "too few to test" };
  return { events, read_mean_r: s?.r?.meanR ?? rb.realMeanR ?? null, random_entry_mean_r: rb.randomMedianR ?? null, beat_pct_of_random: rb.pctBeaten, verdict: rb.verdict };
};

/** @param {any} sc the scoreboard reply  @returns {object} */
export function scoreboardForCopilot(sc) {
  if (!sc || !Array.isArray(sc.axes) || !sc.axes.length) return { error: "scorecard warming up — check back" };
  const byName = new Map(sc.axes.map((a) => [a.name, a]));
  const vsRandom = (r) => !r ? null : r.verdict === "TOO_FEW" ? { verdict: "TOO_FEW", events: r.n }
    : { verdict: r.verdict, beat_pct_of_random: r.pctBeaten, read_mean_r: r.realMeanR, random_entry_mean_r: r.randomMedianR, events: r.n };
  const reads = Array.isArray(sc.pipeline?.reads) ? sc.pipeline.reads : [];
  return {
    as_of: sc.asOf, pooled_markets: sc.config?.coins?.length ?? null, min_samples_to_rate: sc.config?.minSamples ?? null,
    tide: sc.tide && typeof sc.tide.LONG?.meanR === "number" && typeof sc.tide.SHORT?.meanR === "number"
      ? { random_long_mean_r: sc.tide.LONG.meanR, random_short_mean_r: sc.tide.SHORT.meanR, from: sc.tide.from, to: sc.tide.to }
      : null,
    registered_reads: reads.map((r) => {
      const o = byName.get(r.axis)?.oos;
      return {
        read: r.axis, label: byName.get(r.axis)?.label ?? null, trades: r.side ?? "BOTH", stage: r.stage, next: r.next ?? null,
        new_data_since: r.registeredAt ?? null, events: r.numbers?.events ?? 0, mean_r: r.numbers?.events ? r.numbers.meanR : null,
        long: o ? sideVsRandom(o.sides, o.random, "LONG") : null,
        short: o ? sideVsRandom(o.sides, o.random, "SHORT") : null,
      };
    }),
    axes: sc.axes.map((a) => ({
      signal: a.label, verdict: a.verdict,
      best: a.best && a.verdict !== "INSUFFICIENT"
        ? { horizon_h: a.best.h, hit_rate_pct: a.best.hitRate, mean_forward_bps: a.best.meanBps, observations: a.best.samples, walk_forward_stable: a.best.stable }
        : "accruing — not yet rated",
      vs_random: a.random?.bySide ? { long: vsRandom(a.random.bySide.LONG), short: vsRandom(a.random.bySide.SHORT) } : null,
    })),
    note: "registered_reads = the reads under test, graded on NEW data only (events since new_data_since); stage is the served one. axes = every read on all recorded history (old data, in-sample). " +
      "Judge each side against its random entry, never against zero: a side that made money while trailing its random entry rode the market; a side that lost less than its random entry still lost. " +
      "PREDICTIVE is graded against zero. A read is not an edge until it BEATS_RANDOM on its side. We publish the misses too.",
  };
}
