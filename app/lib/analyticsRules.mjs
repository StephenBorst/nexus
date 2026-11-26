// ── Analytics tab, by one set of rules (borst 2026-11-26, "Copy Trades, Trade Log, Analytics: pick up") ─────────────
// What the audit found and what this file fixes:
//   · the equity curve and the per-trade bars plotted the rows in the order Orderly returned them, while the label said
//     "oldest → newest" (tradeStats sorts; this tab didn't): `chronological` sorts once, by close time,
//   · PEAK HOURS ranked an hour with ONE winning trade as the best hour: `peakHours` ranks only hours with
//     ≥ SLICE_MIN_TRADES trades, by net dollars (a high win rate on tiny wins isn't a good hour),
//   · WEEKEND WR painted any win rate above 0% green and printed "0.0%" with no weekend trades: `weekSplit` says
//     "—" with none, and win rates are ink (green/red is money only),
//   · the PERFORMANCE card printed the average loss and the worst trade without a sign ("$13.70"): `perfRows` signs
//     every dollar figure,
//   · Sharpe / Sortino on dollar P&L of trades with different sizes and gaps: removed (the house rule: no Sharpe on
//     uneven trades); YOUR RECORD already carries expectancy, profit factor, payoff and drawdown from tradeStats.
// Pure + tested (analyticsRules.test.mjs). Facts about your own closed trades; no grade, no advice.
import { SLICE_MIN_TRADES } from "./tradeStats.mjs";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);

/** The rows oldest → newest by close time (rows without a time keep their place at the start). */
export function chronological(orders) {
  return (Array.isArray(orders) ? orders : []).map((o, i) => [o, i])
    .sort((a, b) => (num(a[0]?.timestamp) || 0) - (num(b[0]?.timestamp) || 0) || a[1] - b[1]).map(([o]) => o);
}

const fmtUsd = (v) => `$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "+$12.40" / "−$13.70" / "$0.00": a dollar figure never loses its sign. */
export function signed(v) {
  const x = num(v);
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "$0.00";
  return `${x > 0 ? "+" : "−"}${fmtUsd(x)}`;
}

/** "$42.5k" / "$1.20M" / "$812": traded notional, unsigned. */
export function compactUsd(v) {
  const a = Math.abs(num(v));
  if (!Number.isFinite(a) || a <= 0) return "—";
  if (a >= 1e9) return `$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `$${(a / 1e3).toFixed(1)}k`;
  return `$${Math.round(a).toLocaleString("en-US")}`;
}

/**
 * The PERFORMANCE card, every dollar signed. tone: pos | neg | neutral (colour only on money that won or lost).
 * @returns {{ label: string, value: string, tone: "pos"|"neg"|"neutral", sub?: string }[]}
 */
export function perfRows(orders) {
  const rows = Array.isArray(orders) ? orders : [];
  const wins = rows.filter((o) => num(o.pnl) > 0), losses = rows.filter((o) => num(o.pnl) < 0);
  const avg = (l) => (l.length ? l.reduce((s, o) => s + num(o.pnl), 0) / l.length : null);
  const best = wins.length ? Math.max(...wins.map((o) => num(o.pnl))) : null;
  const worst = losses.length ? Math.min(...losses.map((o) => num(o.pnl))) : null;
  const volume = rows.reduce((s, o) => s + (Math.abs(num(o.qty)) * Math.abs(num(o.price)) || 0), 0);
  const v = (x) => (x == null ? "—" : signed(x));
  return [
    { label: "AVG WIN", value: v(avg(wins)), tone: wins.length ? "pos" : "neutral", sub: `${wins.length} winning` },
    { label: "AVG LOSS", value: v(avg(losses)), tone: losses.length ? "neg" : "neutral", sub: `${losses.length} losing` },
    { label: "BEST TRADE", value: v(best), tone: best != null ? "pos" : "neutral" },
    { label: "WORST TRADE", value: v(worst), tone: worst != null ? "neg" : "neutral" },
    { label: "VOLUME", value: compactUsd(volume), tone: "neutral", sub: "closed size × exit price" },
  ];
}

/**
 * Hours of the day (local, as the viewer sees them). `peak` = hours with ≥ min trades, best net dollars first.
 * @returns {{ hours: { h: number, trades: number, wins: number, pnl: number }[], peak: { h: number, trades: number, wins: number, pnl: number }[], thin: boolean }}
 */
export function peakHours(orders, { min = SLICE_MIN_TRADES, top = 3, hourOf = (t) => new Date(t).getHours() } = {}) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, trades: 0, wins: 0, pnl: 0 }));
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!Number.isFinite(num(o?.timestamp))) continue;
    const b = hours[hourOf(num(o.timestamp))];
    if (!b) continue;
    b.trades++; b.pnl += num(o.pnl) || 0; if (num(o.pnl) > 0) b.wins++;
  }
  const peak = hours.filter((b) => b.trades >= min && b.pnl > 0).sort((a, b) => b.pnl - a.pnl || b.trades - a.trades).slice(0, top);
  return { hours, peak, thin: !hours.some((b) => b.trades >= min) };
}

/** Weekdays vs weekends (local): trades, win rate (null with none), net. */
export function weekSplit(orders, { dayOf = (t) => new Date(t).getDay() } = {}) {
  const part = () => ({ trades: 0, wins: 0, pnl: 0, winRate: null });
  const out = { weekday: part(), weekend: part() };
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!Number.isFinite(num(o?.timestamp))) continue;
    const d = dayOf(num(o.timestamp));
    const p = d === 0 || d === 6 ? out.weekend : out.weekday;
    p.trades++; p.pnl += num(o.pnl) || 0; if (num(o.pnl) > 0) p.wins++;
  }
  for (const p of [out.weekday, out.weekend]) p.winRate = p.trades ? Math.round((p.wins / p.trades) * 100) : null;
  return out;
}

/** "62% won · 13 trades" / "—". */
export const wonWords = (wins, trades) => (trades ? `${Math.round((wins / trades) * 100)}% won · ${trades} ${trades === 1 ? "trade" : "trades"}` : "—");
