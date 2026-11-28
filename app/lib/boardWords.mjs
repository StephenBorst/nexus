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

// The other reads (graded callers, smart money, catalysts, forecasts), each in its own words, NEVER counted (borst
// 2026-11-28, Lab pass): the board used to print "3/4 reads agree", rank rows by that count and call 3+ "confluence".
// None of the four is graded on the scoreboard, so adding them up is a tally of ungraded reads (CLAUDE.md: show
// inputs, never a tally). Each lean is listed; whether it sides with the fade is the reader's call.
export const LENS_LABELS = Object.freeze({ callers: "callers", smart: "smart money", catalyst: "catalysts", forecast: "forecasts" });
/** "callers long · smart money short" / null when no read has a lean. */
export function otherReadsLine(lens) {
  const parts = [];
  for (const [k, label] of Object.entries(LENS_LABELS)) {
    const v = lens?.[k];
    if (v === "LONG" || v === "SHORT") parts.push(`${label} ${v.toLowerCase()}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/** Your own closed trades on one side, as a count: "your shorts: 6 of 9 won". Only from 5 trades on that side. */
export const SIDE_MIN_TRADES = 5;
export function sideRecordLine(trades, dir) {
  if (dir !== "LONG" && dir !== "SHORT") return null;
  const side = (Array.isArray(trades) ? trades : []).filter((t) => t && t.direction === dir && Number.isFinite(Number(t.pnl)));
  if (side.length < SIDE_MIN_TRADES) return null;
  const won = side.filter((t) => Number(t.pnl) > 0).length;
  return `your ${dir === "LONG" ? "longs" : "shorts"}: ${won} of ${side.length} won`;
}

/** The trend read's window: classifyRegime looks back 48 one-hour candles (lab-api logic.mjs REGIME.LOOKBACK). */
export const TREND_WINDOW = "2 days";
export function trendWords(trend, movePct) {
  const m = movePct != null && Number.isFinite(movePct) ? ` ${Math.abs(movePct).toFixed(1)}%` : "";
  if (trend === "TREND_UP") return { text: `↑ up${m} over ${TREND_WINDOW}`, tone: "pos" };
  if (trend === "TREND_DOWN") return { text: `↓ down${m} over ${TREND_WINDOW}`, tone: "neg" };
  return { text: `no clear trend over ${TREND_WINDOW}`, tone: "faint" };
}
