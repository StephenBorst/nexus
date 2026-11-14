// Your own trades, measured. The Stats tab's record and its "where the money goes" read.
//
// Replaced the self-scored 0-100 "Trading Score" radar (2026-11-14, borst): a composite with made-up weights is a
// number nobody can check. This module only reports what the closed trades say, in dollars and counts, and says when
// the sample is too small to mean anything. Pure, no network, no clock: the Lab and the tests run the same code.
//
// Input rows are the Lab's ProcessedTrade shape: { symbol, direction "LONG"|"SHORT", pnl, timestamp (close, ms),
// openTimestamp?, leverage? }. pnl is the realized P&L Orderly reports for the closed trade.

/** Below this many closed trades the ratios (profit factor, payoff, break-even rate) are shown as "need N more". */
export const RECORD_MIN_TRADES = 20;
/** A slice (a market, a side, a hold time...) needs this many trades before it is named as a leak or a strength. */
export const SLICE_MIN_TRADES = 5;
/** Two slices that share at least this share of the bigger one's trades are the same finding: keep the first. */
const SAME_FINDING = 0.8;
const MAX_FINDINGS = 3;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const usable = (t) => t && isNum(t.pnl) && isNum(t.timestamp);
const ticker = (s) => {
  const m = /^PERP_([^_]+)_USDC(?:_.*)?$/.exec(String(s || ""));
  return m ? m[1] : String(s || "").replace("PERP_", "").replace("_USDC", "");
};
// direction is the position's side; never read `side` first (on a close it can be the closing order's SELL).
const sideOf = (t) => (String(t.direction || t.side || "").toUpperCase().startsWith("S") ? "SHORT" : "LONG");

/**
 * The record: counts, net, expectancy per trade, profit factor, payoff, the win rate the payoff needs to break even,
 * and the deepest peak-to-trough drop of realized P&L. Null when there is nothing closed.
 */
export function tradeRecord(trades) {
  const rows = (Array.isArray(trades) ? trades : []).filter(usable).sort((a, b) => a.timestamp - b.timestamp);
  const n = rows.length;
  if (!n) return null;

  let wins = 0, losses = 0, grossWin = 0, grossLoss = 0, best = -Infinity;
  for (const t of rows) {
    if (t.pnl > 0) { wins++; grossWin += t.pnl; }
    else if (t.pnl < 0) { losses++; grossLoss += -t.pnl; }
    if (t.pnl > best) best = t.pnl;
  }
  const net = grossWin - grossLoss;
  const avgWin = wins ? grossWin / wins : null;
  const avgLoss = losses ? grossLoss / losses : null;

  // Drawdown on realized P&L, starting flat at 0: the most money given back from a high-water mark.
  let running = 0, peak = 0, peakAt = null, maxDd = 0, ddFrom = null, ddTo = null;
  for (const t of rows) {
    running += t.pnl;
    if (running > peak) { peak = running; peakAt = t.timestamp; }
    const dd = peak - running;
    if (dd > maxDd) { maxDd = dd; ddFrom = peakAt; ddTo = t.timestamp; }
  }

  return {
    trades: n,
    wins,
    losses,
    net,
    winRate: wins / n,
    expectancy: net / n,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null, // null = no losing trade yet
    avgWin,
    avgLoss,
    payoff: avgWin != null && avgLoss != null ? avgWin / avgLoss : null,
    // At this payoff, a win rate above this breaks even (before anything else changes).
    breakevenWinRate: avgWin != null && avgLoss != null ? avgLoss / (avgWin + avgLoss) : null,
    maxDrawdown: maxDd,
    drawdownFrom: maxDd > 0 ? ddFrom : null, // null when the drop started before any gain (from the first trade)
    drawdownTo: maxDd > 0 ? ddTo : null,
    currentDrawdown: peak - running,
    // How much of the net profit one trade carries (null unless net > 0).
    bestTradeShare: net > 0 && best > 0 ? best / net : null,
    sampled: n >= RECORD_MIN_TRADES,
    needMore: Math.max(0, RECORD_MIN_TRADES - n),
  };
}

// ── slices ───────────────────────────────────────────────────────────
const HOLD_BUCKETS = [
  [3_600_000, "under 1h"], [14_400_000, "1–4h"], [43_200_000, "4–12h"],
  [86_400_000, "12–24h"], [259_200_000, "1–3 days"], [Infinity, "over 3 days"],
];
const LEV_BUCKETS = [[5, "1–5x"], [10, "5–10x"], [25, "10–25x"], [Infinity, "25x+"]];
// UTC, so the same trade lands in the same session on every device.
const SESSIONS = [[8, "ASIA", "Asia hours (00–08 UTC)"], [13, "EUROPE", "Europe hours (08–13 UTC)"], [21, "US", "US hours (13–21 UTC)"], [24, "LATE", "late US hours (21–24 UTC)"]];

function sliceKeys(t) {
  const out = [];
  const coin = ticker(t.symbol);
  const side = sideOf(t);
  const sideWord = side === "LONG" ? "longs" : "shorts";
  if (coin) out.push(["market", coin, coin]);
  out.push(["side", side, side === "LONG" ? "Longs" : "Shorts"]);
  if (coin) out.push(["marketSide", `${coin}:${side}`, `${coin} ${sideWord}`]);
  if (isNum(t.openTimestamp) && t.openTimestamp > 0 && t.openTimestamp <= t.timestamp) {
    const held = t.timestamp - t.openTimestamp;
    const b = HOLD_BUCKETS.find(([max]) => held < max);
    out.push(["hold", b[1], `Held ${b[1]}`]);
  }
  if (isNum(t.leverage) && t.leverage > 0) {
    const b = LEV_BUCKETS.find(([max]) => t.leverage < max);
    out.push(["leverage", b[1], `${b[1]} leverage`]);
  }
  const opened = isNum(t.openTimestamp) && t.openTimestamp > 0 ? t.openTimestamp : t.timestamp;
  const h = new Date(opened).getUTCHours();
  const s = SESSIONS.find(([end]) => h < end);
  out.push(["session", s[1], `Opened in ${s[2]}`]);
  return out;
}

function pick(cands, cmp, keep) {
  const chosen = [];
  for (const c of cands.filter(keep).sort(cmp)) {
    const dup = chosen.some((p) => {
      let shared = 0;
      for (const i of c.idx) if (p.idx.has(i)) shared++;
      return shared / Math.max(c.idx.size, p.idx.size) >= SAME_FINDING;
    });
    if (!dup) chosen.push(c);
    if (chosen.length >= MAX_FINDINGS) break;
  }
  return chosen;
}

/**
 * Where the money goes: the slices of the record that lost the most (leaks) and made the most (strengths), each
 * against everything else. Only slices with ≥ minTrades trades, and never the whole record as one slice.
 * Hindsight by construction: a slice that lost can win next. The UI says so.
 */
export function moneyLeaks(trades, { minTrades = SLICE_MIN_TRADES } = {}) {
  const rows = (Array.isArray(trades) ? trades : []).filter(usable);
  const n = rows.length;
  const total = rows.reduce((s, t) => s + t.pnl, 0);
  const map = new Map();
  rows.forEach((t, i) => {
    for (const [dim, key, label] of sliceKeys(t)) {
      const id = `${dim}|${key}`;
      let s = map.get(id);
      if (!s) { s = { dim, key, label, trades: 0, wins: 0, net: 0, idx: new Set() }; map.set(id, s); }
      s.trades++; s.net += t.pnl; s.idx.add(i);
      if (t.pnl > 0) s.wins++;
    }
  });
  const cands = [...map.values()].filter((s) => s.trades >= minTrades && s.trades < n);
  const shape = (s) => ({
    dim: s.dim,
    key: s.key,
    label: s.label,
    trades: s.trades,
    wins: s.wins,
    winRate: s.wins / s.trades,
    net: s.net,
    avg: s.net / s.trades,
    restTrades: n - s.trades,
    restNet: total - s.net,
  });
  const leaks = pick(cands, (a, b) => a.net - b.net, (s) => s.net < 0).map(shape);
  const strengths = pick(cands, (a, b) => b.net - a.net, (s) => s.net > 0).map(shape);
  return { trades: n, net: total, minTrades, leaks, strengths };
}

/** "−$142" / "+$80" with cents under $100, whole dollars above. */
export function signedUsd(v) {
  if (!isNum(v)) return "—";
  const a = Math.abs(v);
  const body = a >= 100 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}$${body}`;
}

/** One plain line for a slice: "9 trades · 3 won · −$142 net. Everything else: +$80 over 41." */
export function sliceLine(s) {
  const rest = s.restTrades > 0 ? ` Everything else: ${signedUsd(s.restNet)} over ${s.restTrades}.` : "";
  return `${s.trades} trades · ${s.wins} won · ${signedUsd(s.net)} net.${rest}`;
}
