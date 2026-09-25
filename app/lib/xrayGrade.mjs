// ── Wallet X-Ray grading: time windows, the copy gate, liq distance ──────────
// Pure + dependency-free (tested in xrayGrade.test.mjs) so the /analyze page and
// anything else that grades a pasted wallet read the SAME rules.
//
// The grade is its COMPONENTS (trades, win rate, net, profit factor) — never a
// single opaque score. Below a window's minimum trade count there is no grade at
// all: the window reads ACCRUING. A "grade" on 3 fills is luck, not an edge.

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// Minimum CLOSED trades before a window is graded. ALL shares 30D's bar: a lifetime
// of 12 trades is no more of a record than a month of 12.
export const XRAY_WINDOWS = [
  { key: "24H", ms: DAY, min: 5 },
  { key: "7D", ms: 7 * DAY, min: 10 },
  { key: "30D", ms: 30 * DAY, min: 20 },
  { key: "ALL", ms: null, min: 20 },
];
export const GATE_WINDOW = "30D";
// The watched (Orderly) record is graded per daily window, not per trade — the same
// 20-sample bar, counted in graded days.
export const WATCHED_MIN_DAYS = 20;

export const windowSpec = (key) => XRAY_WINDOWS.find((w) => w.key === key) || XRAY_WINDOWS[2];

// Trades whose close (timestamp) falls inside the window ending at `now`.
export function tradesInWindow(trades, key, now) {
  const w = windowSpec(key);
  const list = Array.isArray(trades) ? trades : [];
  if (w.ms == null) return list;
  const from = now - w.ms;
  return list.filter((t) => Number.isFinite(t?.timestamp) && t.timestamp >= from && t.timestamp <= now);
}

// Does the tape reach back to the window start? When Hyperliquid history is
// truncated we hold only the most recent slice — a window older than that slice is
// graded on what we have, and must say so.
/** @param {string} key @param {number} now @param {{ truncated?: boolean, oldestTs?: number | null }} [opts] */
export function windowComplete(key, now, { truncated = false, oldestTs = null } = {}) {
  const w = windowSpec(key);
  if (!truncated) return true;
  if (w.ms == null) return false;
  return Number.isFinite(oldestTs) && oldestTs <= now - w.ms;
}

// The window grade. Same inputs AnalyticsView reads (closed-trade pnl), shown as its
// parts. pf = gross win / gross loss (Infinity when there are no losses).
export function gradeWindow(trades, key) {
  const w = windowSpec(key);
  const list = (Array.isArray(trades) ? trades : []).filter((t) => Number.isFinite(t?.pnl));
  let wins = 0, grossWin = 0, grossLoss = 0;
  for (const t of list) {
    if (t.pnl > 0) { wins++; grossWin += t.pnl; } else { grossLoss += Math.abs(t.pnl); }
  }
  const n = list.length;
  const losses = n - wins;
  const net = grossWin - grossLoss;
  const base = { key: w.key, min: w.min, trades: n, need: Math.max(0, w.min - n), net };
  if (n < w.min) return { ...base, status: "ACCRUING" };
  return {
    ...base,
    status: "GRADED",
    wins, losses,
    winRate: (wins / n) * 100,
    pf: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgWin: wins ? grossWin / wins : 0,
    avgLoss: losses ? grossLoss / losses : 0,
    expectancy: net / n,
  };
}

export function gradeAllWindows(trades, now) {
  const out = {};
  for (const w of XRAY_WINDOWS) out[w.key] = gradeWindow(tradesInWindow(trades, w.key, now), w.key);
  return out;
}

// 30D is the default — it answers "is this edge still alive". If 30D can't be graded
// yet, fall back to ALL when ALL can; otherwise stay on 30D and show it accruing.
export function defaultWindow(grades) {
  if (grades?.["30D"]?.status === "GRADED") return { key: "30D", fellBack: false };
  if (grades?.ALL?.status === "GRADED") return { key: "ALL", fellBack: true };
  return { key: "30D", fellBack: false };
}

// The decay row: how the edge holds up as the window narrows (ALL → 30D → 7D).
export function decayRow(grades) {
  return ["ALL", "30D", "7D"].map((key) => {
    const g = grades?.[key];
    return g && g.status === "GRADED"
      ? { key, status: "GRADED", pf: g.pf, trades: g.trades }
      : { key, status: "ACCRUING", pf: null, trades: g?.trades ?? 0, need: g?.need ?? windowSpec(key).min };
  });
}

// ── The copy gate ─────────────────────────────────────────────────────────────
// Nothing one-taps a copy unless the wallet's recent record clears the bar:
//   evidence  = a GRADED 30D Hyperliquid window that is net positive with PF > 1,
//               OR a watched Orderly record with ≥ 20 graded days, net positive;
//   veto      = ANY graded evidence that is negative (30D net ≤ 0 or PF ≤ 1, or the
//               watched record underwater) — a weak read on one venue isn't
//               outvoted by a good one on the other.
// Returns the reasons in plain words so a locked gate can say WHY, not just hide.
/** @param {{ hl30?: any, watched?: any }} [input] */
export function edgeGate({ hl30 = null, watched = null } = {}) {
  const reasons = [];
  const evidence = [];
  let veto = false;

  if (hl30) {
    if (hl30.status !== "GRADED") {
      reasons.push(`Hyperliquid 30D: ${hl30.trades} closed trade${hl30.trades === 1 ? "" : "s"}, needs ${hl30.min} to grade`);
    } else if (hl30.net <= 0 || !(hl30.pf > 1)) {
      veto = true;
      reasons.push(`Hyperliquid 30D: ${hl30.net <= 0 ? "net negative" : "no edge"} (PF ${fmtPf(hl30.pf)} over ${hl30.trades} trades)`);
    } else {
      evidence.push({ source: "HL30", label: `30D grade · ${hl30.trades} trades · PF ${fmtPf(hl30.pf)} · ${hl30.winRate.toFixed(0)}% win` });
    }
  }

  if (watched && !watched.building && Number.isFinite(watched.netRealized)) {
    const days = watched.gradedWindows ?? 0;
    if (watched.netRealized < 0) {
      veto = true;
      reasons.push(`Watched record underwater over ${watched.daysTracked ?? days}d`);
    } else if (days < WATCHED_MIN_DAYS) {
      reasons.push(`Watched record: ${days} graded day${days === 1 ? "" : "s"}, needs ${WATCHED_MIN_DAYS}`);
    } else if (watched.netRealized > 0) {
      evidence.push({ source: "WATCHED", label: `watched ${days}d · net positive` });
    } else {
      reasons.push("Watched record flat — no edge shown");
    }
  }

  if (!evidence.length && !reasons.length) reasons.push("No per-trade tape or watched record to grade yet");
  const pass = !veto && evidence.length > 0;
  return { pass, evidence, reasons: pass ? [] : reasons };
}

export function fmtPf(pf) {
  if (pf === Infinity) return "∞";
  return Number.isFinite(pf) ? pf.toFixed(2) : "—";
}

// ── Watched-record windows (Orderly) ──────────────────────────────────────────
// Net realized over the window from the daily snapshot series. Needs a snapshot at or
// before the window start — if watching began later the window isn't covered and we
// say how much IS covered instead of passing a short span off as the full window.
export function watchedWindow(series, key, now) {
  const w = windowSpec(key);
  const s = (Array.isArray(series) ? series : [])
    .filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.realized))
    .sort((a, b) => a.t - b.t);
  if (s.length < 2) return { key: w.key, covered: false, coveredDays: 0 };
  const last = s[s.length - 1];
  const coveredDays = (last.t - s[0].t) / DAY;
  // A series that stopped updating can't speak for "the last 24h".
  if (now - last.t > 2.5 * DAY) return { key: w.key, covered: false, coveredDays, stale: true };
  if (w.ms == null) return { key: w.key, covered: true, coveredDays, net: last.realized - s[0].realized };
  // Allow a few hours of cron slack on the baseline snapshot.
  const from = now - w.ms + 6 * HOUR;
  let base = null;
  for (const p of s) { if (p.t <= from) base = p; else break; }
  if (!base || base === last) return { key: w.key, covered: false, coveredDays };
  return { key: w.key, covered: true, coveredDays, net: last.realized - base.realized };
}

// ── Liquidation distance ──────────────────────────────────────────────────────
// % the mark must move against the position to hit the venue-REPORTED liq price.
// Only ever computed from a reported liq price — never estimated. null = none reported
// (e.g. Hyperliquid cross margin with no liq in range, or a venue that doesn't publish it).
export function liqDistancePct(side, mark, liq) {
  const m = Number(mark), l = Number(liq);
  if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(l) || l <= 0) return null;
  const d = side === "SHORT" ? (l - m) / m : (m - l) / m;
  return Math.max(0, d * 100);
}

// Hyperliquid coin → Orderly coin (mirrors the worker's hlCoinToOrderly): HL's k-prefixed
// thousand-unit coins are 1000-prefixed on Orderly; builder-deployed "dex:COIN" markets
// have no Orderly twin. Copy is offered only when the result is a LISTED Orderly perp.
export function hlCoinToOrderly(coin) {
  if (!coin || coin.includes(":")) return null;
  if (/^k[A-Z]/.test(coin)) return "1000" + coin.slice(1);
  return coin;
}
