// ── Basis × CVD graded exit — regime window (docs/research/graded-exit-regime-prereg.md) ───────
// The signed test's fixed numbers and its regime rule, in one place. The scoreboard reports the day
// counts with `btcDailyRegimes` and the watcher judges with `regimeConditionMet`; regimeWindow.test.mjs
// pins every number here to the page's text. Measurement only: nothing here trades.
//
// The regime, in the page's words: for each UTC day in the window, BTC's 30-day return = that day's
// close ÷ the close 30 days earlier − 1, on Orderly daily candles for PERP_BTC_USDC (/tv/history,
// resolution D). UP ≥ +10% · DOWN ≤ −10% · FLAT between. Met = at least 14 days (not necessarily in a
// row) in each of two different states, and one of the two is DOWN.

export const REGIME_WINDOW = Object.freeze({
  axis: "basis_x_cvd",
  doc: "docs/research/graded-exit-regime-prereg.md",
  registeredAt: "2026-10-27T00:00:00Z",
  limitAt: "2027-04-27T00:00:00Z",
  symbol: "PERP_BTC_USDC",
  lookbackDays: 30,
  upPct: 10,
  downPct: -10,
  minDays: 14,
  minTrades: 30,
});

export const regimeFromMs = () => Date.parse(REGIME_WINDOW.registeredAt);
export const regimeLimitMs = () => Date.parse(REGIME_WINDOW.limitAt);

const DAY = 86_400_000;

// One state per return (a fraction, 0.1 = +10%).
export function regimeState(ret) {
  if (!Number.isFinite(ret)) return null;
  if (ret * 100 >= REGIME_WINDOW.upPct) return "UP";
  if (ret * 100 <= REGIME_WINDOW.downPct) return "DOWN";
  return "FLAT";
}

/**
 * Day counts for the window from Orderly daily candles ([{t: day start in SECONDS, c}]).
 * A day counts once it has closed (its start + 24h ≤ now) and lies in [fromMs, toMs). A day whose
 * close or 30-days-earlier close is missing is counted in `missing`, never given a state.
 */
export function btcDailyRegimes(daily, { fromMs = regimeFromMs(), toMs = regimeLimitMs(), now = Date.now() } = {}) {
  const close = new Map();
  for (const d of Array.isArray(daily) ? daily : []) {
    const t = Number(d?.t) * 1000, c = Number(d?.c);
    if (Number.isFinite(t) && c > 0) close.set(Math.floor(t / DAY) * DAY, c);
  }
  const counts = { UP: 0, DOWN: 0, FLAT: 0 };
  let missing = 0;
  const days = [];
  const end = Math.min(toMs, now);
  for (let d = Math.ceil(fromMs / DAY) * DAY; d + DAY <= end; d += DAY) {
    const c = close.get(d), prev = close.get(d - REGIME_WINDOW.lookbackDays * DAY);
    if (!(c > 0) || !(prev > 0)) { missing++; continue; }
    const ret = c / prev - 1;
    const state = regimeState(ret);
    counts[state]++;
    days.push({ day: new Date(d).toISOString().slice(0, 10), retPct: Math.round(ret * 10_000) / 100, state });
  }
  return { counts, missing, days };
}

// The page's condition: ≥ minDays in each of two different states, one of them DOWN.
export function regimeConditionMet(counts) {
  const n = (s) => Number(counts?.[s]) || 0;
  const min = REGIME_WINDOW.minDays;
  return n("DOWN") >= min && (n("UP") >= min || n("FLAT") >= min);
}

// The label a result judged without the condition carries, e.g. "one regime only: UP 140 days, FLAT 42 days".
export function regimeLabel(counts) {
  const parts = ["UP", "DOWN", "FLAT"].filter((s) => (Number(counts?.[s]) || 0) > 0).map((s) => `${s} ${counts[s]} days`);
  if (regimeConditionMet(counts)) return `regime condition met: ${parts.join(", ")}`;
  const atMin = ["UP", "DOWN", "FLAT"].filter((s) => (Number(counts?.[s]) || 0) >= REGIME_WINDOW.minDays).length;
  return `${atMin <= 1 ? "one regime only" : "regime condition not met (no DOWN regime)"}: ${parts.join(", ") || "no days counted"}`;
}
