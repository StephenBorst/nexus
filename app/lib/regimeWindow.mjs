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

// ── The judgment, word for word from the page's "The window" + "The bar" ──────────────────────
// Read once a day by the pipeline watcher (pipelineWatch.mjs). Inputs are the served scorecard's
// `axes[basis_x_cvd].regimeWindow` (main card), the holdout line's same block, and the top-level
// `regimeWindow.regime` day counts. Returns null when any input can't be read (never a judgment on a
// missing number). Statuses: COUNTING until judged; then one of INCONCLUSIVE · FAILS · CLEARS ·
// NOT_CLEARED, all final.
export const REGIME_OUTCOMES = Object.freeze(["INCONCLUSIVE", "FAILS", "CLEARS", "NOT_CLEARED"]);

export function judgeRegimeWindow({ main, holdout, regime, readVerdict = null }, now = Date.now()) {
  if (!main || !holdout || !regime || regime.error || !regime.counts) return null;
  const ex = main.exitGraded || {};
  const trades = Number(ex.samples) || 0;
  const net = Number.isFinite(Number(ex.netBps)) ? Number(ex.netBps) : null;
  const met = regimeConditionMet(regime.counts);
  const label = regimeLabel(regime.counts);
  const atLimit = now >= regimeLimitMs();
  const numbers = { trades, netBps: net, regime: { ...regime.counts }, regimeMet: met, readVerdict };
  const judged = (trades >= REGIME_WINDOW.minTrades && met) || atLimit;
  if (!judged) {
    const need = [];
    if (trades < REGIME_WINDOW.minTrades) need.push(`${REGIME_WINDOW.minTrades - trades} more counted trades`);
    if (!met) need.push(`the regime condition (${label})`);
    return { status: "COUNTING", reason: `needs ${need.join(" and ")}, or the six-month limit (${REGIME_WINDOW.limitAt})`, numbers };
  }
  const tag = met ? "" : ` · ${label}`;
  if (trades < REGIME_WINDOW.minTrades) return { status: "INCONCLUSIVE", reason: `${trades} counted trades at the six-month limit${tag}`, numbers };
  if (!(net > 0)) return { status: "FAILS", reason: `net after fees ${net ?? "unread"} bps over ${trades} trades${tag}`, numbers };
  const r = main.r || {}, hr = holdout.r || {};
  const pct = (b) => (b && Number.isFinite(Number(b.pctBeaten)) ? Number(b.pctBeaten) : null);
  const longPct = pct(main.random?.bySide?.LONG), hLongPct = pct(holdout.random?.bySide?.LONG);
  const missed = [];
  if (!((Number(r.samples) || 0) >= 30)) missed.push(`read out-of-sample events ${r.samples || 0} (needs 30)`);
  if (!(Number(r.meanR) > 0)) missed.push(`read mean R ${r.meanR ?? "unread"} (needs > 0)`);
  if (!r.stable) missed.push("read halves disagree");
  if (!(longPct != null && longPct >= 95)) missed.push(`LONG beats ${longPct ?? "—"}% of random (needs 95%)`);
  if (!((Number(hr.samples) || 0) >= 30)) missed.push(`holdout events ${hr.samples || 0} (needs 30)`);
  if (!(Number(hr.meanR) > 0)) missed.push(`holdout mean R ${hr.meanR ?? "unread"} (needs > 0)`);
  if (!(hLongPct != null && hLongPct >= 80)) missed.push(`holdout LONG beats ${hLongPct ?? "—"}% of random (needs 80%)`);
  if (missed.length) return { status: "NOT_CLEARED", reason: `net +${net} bps over ${trades} trades, but: ${missed.join("; ")}${tag}`, numbers };
  return { status: "CLEARS", reason: `net +${net} bps over ${trades} trades; read mean R +${r.meanR}, halves agree, LONG ${longPct}% vs random; holdout ${hr.samples} events, +${hr.meanR}R, ${hLongPct}%${tag}`, numbers };
}

// The judged result, set ONCE by the watcher PR that records the judgment (null while counting).
// Final: the shelf and any display read this before the live judge, so a later flip of the served
// numbers can't change a recorded result. pipelineWatch.test.mjs pins it to the snapshot.
export const REGIME_RESULT = null;
