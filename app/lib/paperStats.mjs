// ── Paper track-record math ──────────────────────────────────────────────────
// `state.paper_trades` is a ROLLING last-50 window (exec pops past 50). That is why the
// card's TRADES stuck at 50 and "since" slid forward as old rows fell off — the window
// is not the record. A lifetime record therefore has to be accrued ONCE, at close time,
// into a running aggregate; it cannot be recovered from a truncated window afterwards.
//
// Pure + dependency-free, imported by BOTH the exec worker (accrual) and the Lab
// (render), so the two can never disagree about what a number means.

export const EMPTY_PAPER_AGG = {
  trades: 0, wins: 0, losses: 0, grossWin: 0, grossLoss: 0, net: 0,
  firstTradeAt: null, lastTradeAt: null,
};

// Fold ONE closed paper trade into the lifetime aggregate. Immutable, and a malformed
// row is ignored rather than allowed to corrupt a record that can never be rebuilt.
export function accruePaperAgg(agg, trade) {
  const base = { ...EMPTY_PAPER_AGG, ...(agg || {}) };
  const pnl = Number(trade?.pnl);
  if (!Number.isFinite(pnl)) return base;
  const closedAt = Date.parse(trade?.closed_at ?? "") || Date.now();
  const openedAt = Date.parse(trade?.opened_at ?? "") || closedAt;
  const win = pnl > 0;                       // 0 counts as a loss (same rule the card uses)
  return {
    trades: base.trades + 1,
    wins: base.wins + (win ? 1 : 0),
    losses: base.losses + (win ? 0 : 1),
    grossWin: base.grossWin + (win ? pnl : 0),
    grossLoss: base.grossLoss + (win ? 0 : Math.abs(pnl)),
    net: base.net + pnl,
    // The lifetime start must never move forward, even if rows arrive out of order.
    firstTradeAt: base.firstTradeAt == null ? openedAt : Math.min(base.firstTradeAt, openedAt),
    lastTradeAt: Math.max(base.lastTradeAt || 0, closedAt) || closedAt,
  };
}

// Shape the aggregate into what AgentTrackRecord's `summary` prop expects.
// null => no lifetime record yet, so the card honestly falls back to the window.
export function paperSummary(agg) {
  const a = agg || null;
  if (!a || !Number.isFinite(a.trades) || a.trades <= 0) return null;
  return {
    trades: a.trades,
    winRate: (a.wins / a.trades) * 100,
    netPnl: a.net,
    avgWin: a.wins ? a.grossWin / a.wins : 0,
    avgLoss: a.losses ? a.grossLoss / a.losses : 0,
    firstTradeAt: a.firstTradeAt ?? undefined,
  };
}

// Entry notional of a row. Not stored directly, but entry_price x qty recovers it —
// which is what lets the size-scoped breakdown work on trades recorded BEFORE this shipped.
export function tradeNotional(t) {
  const n = Number(t?.entry_price) * Number(t?.qty);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function holdHours(t) {
  const a = Date.parse(t?.opened_at ?? ""), b = Date.parse(t?.closed_at ?? "");
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? (b - a) / 3600000 : null;
}

// The REAL exit vocabulary exec emits. There is no "signal flip" exit — WEBHOOK_CLOSE
// (an external signal flattening the position) is the closest thing, so it is labelled
// as such instead of shipping an always-zero "flip" column.
export const EXIT_LABELS = {
  SL: "stop", TIMEOUT: "time", TRAIL: "trail", BE: "breakeven", TP: "take-profit",
  TP_PARTIAL: "scale-out", WEBHOOK_CLOSE: "external / flip", KILLED: "kill switch",
};
const labelFor = (t) => {
  const r = String(t?.reason || "—");
  if (r === "TP_PARTIAL") return Number.isFinite(Number(t?.tp_level)) ? `TP${Number(t.tp_level)}` : "scale-out";
  return EXIT_LABELS[r] || r.toLowerCase();
};

const tally = (rows) => {
  const m = new Map();
  for (const t of rows) { const k = labelFor(t); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()]
    .map(([label, n]) => ({ label, n, pct: rows.length ? Math.round((n / rows.length) * 1000) / 10 : 0 }))
    .sort((a, b) => b.n - a.n);
};
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

// The blotter read: how losses END vs how wins END, and the win/loss size at the CURRENT
// position size only — mixing a $50 trade with an old fat notional makes avg$ meaningless.
// Exits that are supposed to BANK a gain. A row carrying one of these with pnl <= 0 is
// an anomaly worth surfacing, not averaging away.
const PROFIT_EXITS = new Set(["TP", "TP_PARTIAL"]);

const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * @param {any[]} trades
 * @param {{ currentNotional?: number|null, tolerancePct?: number, maxHoldHours?: number|null }} [opts]
 */
export function paperBlotter(trades, { currentNotional = null, tolerancePct = 25, maxHoldHours = null } = {}) {
  const rows = (Array.isArray(trades) ? trades : []).filter((t) => Number.isFinite(Number(t?.pnl)));
  const wins = rows.filter((t) => Number(t.pnl) > 0);
  const losses = rows.filter((t) => Number(t.pnl) <= 0);

  let atSize = null;
  if (Number.isFinite(Number(currentNotional)) && Number(currentNotional) > 0) {
    const target = Number(currentNotional), tol = target * (tolerancePct / 100);
    const inSize = rows.filter((t) => { const n = tradeNotional(t); return n != null && Math.abs(n - target) <= tol; });
    const w = inSize.filter((t) => Number(t.pnl) > 0).map((t) => Number(t.pnl));
    const l = inSize.filter((t) => Number(t.pnl) <= 0).map((t) => Math.abs(Number(t.pnl)));
    atSize = {
      notional: target, n: inSize.length, wins: w.length, losses: l.length,
      // ⚠️ null, NOT 0, when there is nothing at this size. mean([]) === 0 would render
      // "$0.00 avg win", which reads as a real measurement of a sample that doesn't exist.
      avgWin: w.length ? mean(w) : null,
      avgLoss: l.length ? mean(l) : null,
      net: inSize.reduce((s, t) => s + Number(t.pnl), 0),
      excluded: rows.length - inSize.length,
    };
  }

  // Is the retained window even describing the CURRENT bot? If every row is at a wildly
  // different notional, the percentages below are about a configuration that no longer
  // exists — the single most decision-relevant fact on the panel.
  const notionals = rows.map(tradeNotional).filter((n) => n != null);
  const medNotional = median(notionals);
  const sizeDrift = (medNotional != null && Number(currentNotional) > 0)
    ? { medianNotional: medNotional, currentNotional: Number(currentNotional), ratio: medNotional / Number(currentNotional) }
    : null;
  // "Stale" = the typical retained row is an order of magnitude off the current size.
  const staleWindow = !!sizeDrift && (sizeDrift.ratio >= 3 || sizeDrift.ratio <= 1 / 3);

  // Profit-labelled exits that closed RED. Either the fill diverged from the price that
  // triggered the exit, or a remainder/ladder row is mislabelled — the split by reason
  // says which, so this reports rather than guesses.
  const redProfitExits = rows.filter((t) => PROFIT_EXITS.has(String(t?.reason)) && Number(t.pnl) <= 0);
  const anomalies = {
    n: redProfitExits.length,
    byExit: tally(redProfitExits),
    worst: redProfitExits.reduce((w, t) => (w == null || Number(t.pnl) < Number(w.pnl) ? t : w), null),
  };

  // Did anything outlive the CURRENT max-hold cap? Separates "TIMEOUT is broken" from
  // "these rows predate the current cap".
  const cap = Number(maxHoldHours);
  const overHold = Number.isFinite(cap) && cap > 0
    ? (() => {
        const over = rows.map((t) => ({ t, h: holdHours(t) })).filter((x) => x.h != null && x.h > cap * 1.25);
        return { cap, n: over.length, maxH: over.reduce((m, x) => Math.max(m, x.h), 0) };
      })()
    : null;

  const hh = (xs) => mean(xs.map(holdHours).filter((h) => h != null));
  return {
    n: rows.length, wins: wins.length, losses: losses.length,
    winRate: rows.length ? Math.round((wins.length / rows.length) * 1000) / 10 : 0,
    lossByExit: tally(losses),
    winByExit: tally(wins),
    avgHoldWinH: hh(wins), avgHoldLossH: hh(losses),
    atSize, sizeDrift, staleWindow, anomalies, overHold,
  };
}
