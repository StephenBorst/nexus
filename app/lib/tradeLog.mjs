// ── The Trading Log, by one set of rules (borst 2026-11-26, "Copy Trades, Trade Log, Analytics: pick up") ───────────
// The log reads the account's closed positions from Orderly (/v1/position_history, the SDK's private query) and groups
// them by local day. Before this file the rules lived inline and disagreed with each other:
//   · a $0 day counted as a WIN in the filter but not in WIN DAYS; now win = P&L > 0, loss = P&L < 0, flat = 0, everywhere,
//   · the calendar printed the ALL-TIME P&L beside THIS MONTH's day count; `monthStats` reads only the month on screen,
//   · prices printed with toFixed(2), so a $0.0004 coin read "$0.00"; `fmtPrice` keeps 4 significant figures under $1,
//   · search matched only the raw "2026-11-5" key; `matchesSearch` reads the ticker, "2026-11-05", "nov 5" and "nov",
//   · Orderly returns at most 500 positions and the log never said so; `coverageLine` says it once it hits the cap.
// Pure + tested (tradeLog.test.mjs). Facts about your own trades: no grade, no advice.

export const HISTORY_LIMIT = 500;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const outcome = (pnl) => (num(pnl) > 0 ? "WIN" : num(pnl) < 0 ? "LOSS" : "FLAT");
const bare = (s) => String(s || "").replace(/^PERP_/, "").replace(/_USDC$/, "");

/**
 * One day (or any list of trades), counted. Trades: [{ symbol, pnl, timestamp, ... }].
 * @template {{ symbol: string, pnl: number }} T
 * @param {T[]} trades
 * @returns {{ pnl: number, trades: number, wins: number, losses: number, flat: number, winRate: number|null,
 *   best: T|null, worst: T|null, coins: { coin: string, pnl: number, trades: number }[] }}
 */
export function dayStats(trades) {
  const list = Array.isArray(trades) ? trades : [];
  let pnl = 0, wins = 0, losses = 0, flat = 0;
  /** @type {T|null} */ let best = null;
  /** @type {T|null} */ let worst = null;
  const by = new Map();
  for (const t of list) {
    const p = num(t?.pnl);
    pnl += p;
    const o = outcome(p);
    if (o === "WIN") wins++; else if (o === "LOSS") losses++; else flat++;
    if (p > 0 && (!best || p > num(best.pnl))) best = t;
    if (p < 0 && (!worst || p < num(worst.pnl))) worst = t;
    const c = bare(t?.symbol);
    const row = by.get(c) || { coin: c, pnl: 0, trades: 0 };
    row.pnl += p; row.trades++;
    by.set(c, row);
  }
  const coins = [...by.values()].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  return { pnl, trades: list.length, wins, losses, flat, winRate: list.length ? Math.round((wins / list.length) * 100) : null, best, worst, coins };
}

/** The day filter: wins = days that made money, losses = days that lost it; a flat day only under "all". */
export function dayPasses(filter, pnl) {
  if (filter === "wins") return num(pnl) > 0;
  if (filter === "losses") return num(pnl) < 0;
  return true;
}

/** Only the month on screen: its P&L, its trading days, its winning days. dayGroups keys are "YYYY-M-D" (local). */
export function monthStats(dayGroups, month, year) {
  let pnl = 0, days = 0, winDays = 0, trades = 0;
  for (const [k, g] of Object.entries(dayGroups || {})) {
    const [y, m] = k.split("-").map(Number);
    if (y !== year || m - 1 !== month) continue;
    days++; pnl += num(g?.pnl); trades += num(g?.trades);
    if (num(g?.pnl) > 0) winDays++;
  }
  return { pnl, days, winDays, trades };
}

/** Search a day by coin ("eth"), date ("2026-11-05", "2026-11-5", "nov 5", "11/5") or month ("nov"). */
export function matchesSearch(key, trades, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return true;
  if ((trades || []).some((t) => bare(t?.symbol).toLowerCase().includes(s))) return true;
  const [y, m, d] = String(key).split("-").map(Number);
  if (!y || !m || !d) return false;
  const pad = (x) => String(x).padStart(2, "0");
  const forms = [`${y}-${m}-${d}`, `${y}-${pad(m)}-${pad(d)}`, `${MONTHS[m - 1]} ${d}`, `${MONTHS[m - 1]} ${pad(d)}`, `${m}/${d}`, `${pad(m)}/${pad(d)}`, `${MONTHS[m - 1]} ${d} ${y}`];
  if (/^[a-z]{3,9}$/.test(s)) return MONTHS[m - 1] === s.slice(0, 3);
  return forms.includes(s) || s === `${y}-${m}` || s === `${y}-${pad(m)}`; // a whole day, or a whole month
}

/** A price as a trader reads it: "$61,234.50", "$1.2345", "$0.0004123". Never "$0.00" for a real price. */
export function fmtPrice(p) {
  const v = Number(p);
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1000) return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (v >= 1) return `$${Number(v.toFixed(4))}`;
  return `$${Number(v.toPrecision(4))}`;
}

/** How long the position was open: "45m", "3h 20m", "2d 4h". null without an open time. */
export function holdText(openTs, closeTs) {
  const o = num(openTs), c = num(closeTs);
  if (!(o > 0) || !(c >= o)) return null;
  const m = Math.round((c - o) / 60_000);
  if (m < 60) return `${m}m`;
  if (m < 1440) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h`; }
  const d = Math.floor(m / 1440), h = Math.round((m % 1440) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** Said once the read hits Orderly's cap, so a short log isn't read as the whole history. */
export function coverageLine(count, limit = HISTORY_LIMIT) {
  if (!(num(count) >= limit)) return null;
  return `Your last ${limit} closed positions. Orderly returns at most ${limit}, so older ones aren’t in this log.`;
}

/** "3 of 5 won" / "1 of 1 won" / "no trades": the day's count in words. Flat trades are neither. */
export function wonLine(st) {
  if (!st?.trades) return "no trades";
  const flat = st.flat ? ` · ${st.flat} flat` : "";
  return `${st.wins} of ${st.trades} won${flat}`;
}
