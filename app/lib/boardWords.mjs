// The Board's phone rows in plain words (2026-11-14, borst: "more intuitive, clean"). The row read
// "ETH · +10.8%/yr · FADE SHORT / 1/4 · ↓ dn 7.2%": a newcomer can't tell who pays the funding, what "1/4" counts,
// or over what window the move is. Same numbers, said plainly. Tested; DecisionBoard renders it.

/** Positive funding = longs pay shorts. "longs pay 10.8%/yr" / "shorts pay 4.1%/yr" / "funding flat". */
export function fundingWords(annualPct) {
  if (annualPct == null || !Number.isFinite(annualPct)) return "—";
  const a = Math.abs(annualPct);
  if (a < 0.05) return "funding flat";
  return `${annualPct > 0 ? "longs" : "shorts"} pay ${a.toFixed(1)}%/yr`;
}

/** How many of the Board's 4 independent reads (callers, smart money, catalysts, forecasts) back the play. */
export const BOARD_READS = 4;
export function agreeWords(agree, hasPlay) {
  if (!hasPlay) return "no play";
  const n = Math.max(0, Math.min(BOARD_READS, Number(agree) || 0));
  return n === 0 ? `0 of ${BOARD_READS} reads agree` : `${n} of ${BOARD_READS} ${n === 1 ? "read agrees" : "reads agree"}`;
}

/** The trend read's window: classifyRegime looks back 48 one-hour candles (lab-api logic.mjs REGIME.LOOKBACK). */
export const TREND_WINDOW = "2 days";
export function trendWords(trend, movePct) {
  const m = movePct != null && Number.isFinite(movePct) ? ` ${Math.abs(movePct).toFixed(1)}%` : "";
  if (trend === "TREND_UP") return { text: `↑ up${m} over ${TREND_WINDOW}`, tone: "pos" };
  if (trend === "TREND_DOWN") return { text: `↓ down${m} over ${TREND_WINDOW}`, tone: "neg" };
  return { text: `no clear trend over ${TREND_WINDOW}`, tone: "faint" };
}
