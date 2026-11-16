// A caller's record, read for risk (2026-11-16, borst: "profit factor / max drawdown in R instead of Sharpe").
// From the SAME graded calls the board ranks on (lab-api grading.mjs computeCallerStats), in the order they
// CLOSED: profit factor (R won per R lost), the deepest peak-to-trough fall of the running R total, the
// longest run of losses, and expectancy with a 95% range. No Sharpe: calls aren't evenly spaced returns, so a
// Sharpe on them would look precise and mean nothing. Shown only from RISK_MIN_CALLS graded calls; below that a
// card says how many more. Anyone can rebuild every number from /verify. Pure, tested.

export const RISK_MIN_CALLS = 20;
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * @param {{ r: number, at?: number, closeAt?: number }[]} rows graded calls (R each), any order
 * @returns {null | { calls, ready, needed, profitFactor: number|null, maxDrawdownR, worstStreak, expectancy, low: number|null, high: number|null }}
 */
export function recordRisk(rows) {
  const list = (Array.isArray(rows) ? rows : [])
    .filter((x) => x && Number.isFinite(Number(x.r)))
    .map((x) => ({ r: Number(x.r), t: Number(x.closeAt) > 0 ? Number(x.closeAt) : Number(x.at) || 0 }))
    .sort((a, b) => a.t - b.t);
  const n = list.length;
  if (!n) return null;
  let cum = 0, peak = 0, maxDd = 0, streak = 0, worst = 0, win = 0, loss = 0, sum = 0;
  for (const { r } of list) {
    cum += r; sum += r;
    if (cum > peak) peak = cum;
    if (peak - cum > maxDd) maxDd = peak - cum;
    if (r < 0) { streak++; if (streak > worst) worst = streak; } else streak = 0;
    if (r > 0) win += r; else loss += -r;
  }
  const mean = sum / n;
  let low = null, high = null;
  if (n >= 2) {
    const sd = Math.sqrt(list.reduce((s, { r }) => s + (r - mean) ** 2, 0) / (n - 1));
    const half = 1.96 * (sd / Math.sqrt(n));
    low = r2(mean - half); high = r2(mean + half);
  }
  return {
    calls: n, ready: n >= RISK_MIN_CALLS, needed: Math.max(0, RISK_MIN_CALLS - n),
    profitFactor: loss > 0 ? r2(Math.min(win / loss, 99)) : null,   // null = no losses yet (not "infinite")
    maxDrawdownR: r2(maxDd), worstStreak: worst, expectancy: r2(mean), low, high,
  };
}

const sgn = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;

/** The lines a card prints. Below the minimum: one line saying how many more graded calls. */
export function riskLines(risk) {
  if (!risk) return ["No graded calls yet."];
  if (!risk.ready) return [`Risk stats show from ${RISK_MIN_CALLS} graded calls · ${risk.calls} so far, ${risk.needed} to go.`];
  const lines = [
    risk.profitFactor == null ? "Profit factor: no losing call yet." : `Profit factor ${risk.profitFactor.toFixed(2)} · R won per R lost.`,
    `Max drawdown −${risk.maxDrawdownR.toFixed(2)}R · the deepest fall of the running total, in close order.`,
    `Worst losing run ${risk.worstStreak} call${risk.worstStreak === 1 ? "" : "s"} in a row.`,
    `${sgn(risk.expectancy)}R per call · 95% range ${sgn(risk.low)} to ${sgn(risk.high)}.`,
  ];
  if (risk.low <= 0 && risk.high >= 0) lines.push("That range includes zero: not yet distinguishable from break-even.");
  return lines;
}

/** One short line for a board row ("PF 1.80 · max DD −6.00R"), or null below the minimum. */
export function riskBrief(risk) {
  if (!risk?.ready) return null;
  return `${risk.profitFactor == null ? "PF —" : `PF ${risk.profitFactor.toFixed(2)}`} · max DD −${risk.maxDrawdownR.toFixed(2)}R`;
}
