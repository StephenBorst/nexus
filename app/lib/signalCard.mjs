// ── Scoreboard card: what each read is, and the one honest line about it ───────────────
// Display only. Every number comes from /intel/axis-backtest as served; nothing here grades.
// Pure + tested (signalCard.test.mjs), so the /proof card and anything else that shows a
// read's summary can't word the same evidence two ways.

// What each read IS — a plain description of the rule, never how good it is (the grade says
// that, and the grade moves; a sentence praising a read would go stale the day it slips).
export const AXIS_BLURB = {
  basis_x_cvd: "Buys the widest perp discount only when aggressor flow agrees in the same hour.",
  basis_extreme: "Fades an extreme perp premium or discount to spot.",
  basis_dev: "Fades basis when it strays far from its own usual level, on either side.",
  basis_dev_x_cvd: "The two-sided basis read, taken only when aggressor flow agrees.",
  basis_x_smart: "Basis extreme, taken only when smart-money positioning agrees.",
  basis_x_liqflush: "Basis extreme, timed to a liquidation flush.",
  rsi_reset_deep: "Buys an RSI pullback under 45 while the broader trend stays up.",
  rsi_reset_trend: "An RSI reset that holds, taken only in an up-trend regime.",
  rsi_reset_held: "Buys an RSI reset that holds above 45 in an uptrend.",
  smart_follow: "Takes the side the most profitable accounts are positioned on.",
  smart_fade: "Funding fade, taken only when smart money agrees.",
  funding_fade: "Fades extreme funding. The old flagship, kept as the baseline.",
  cvd_divergence: "Price and aggressor flow disagree; takes the flow's side.",
  liq_flush: "Fades the move after a burst of liquidations.",
  rs_value_pullback: "Relative-strength leaders pulling back to value. Proxy inputs.",
  rs_value_pullback_rsi: "The value pullback, with RSI at 45 or higher. Proxy inputs.",
  rs_value_pullback_candle: "Relative-strength leaders pulling back to weekly VWAP. Real candles.",
  rs_value_pullback_candle_rsi: "The VWAP pullback, with RSI at 45 or higher. Real candles.",
  rs_value_pullback_rotation: "The VWAP pullback, vetoed unless volume rotates in.",
};

// "RSI reset <45 (uptrend)" → { main: "RSI reset <45", aside: "(uptrend)" }. Only a trailing
// parenthetical is split off; a label with none (or with text after it) stays whole.
export function splitLabel(label) {
  const s = String(label || "");
  const m = s.match(/^(.*\S)\s+(\([^()]*\))$/);
  return m ? { main: m[1], aside: m[2] } : { main: s, aside: "" };
}

const TIER = { PREDICTIVE: 0, PROMISING: 1, NOISE: 2, INSUFFICIENT: 3 };
const BASE_RANK = { BEATS_RANDOM: 0, LEANS_ABOVE: 1, NOT_DISTINGUISHABLE: 2, TOO_FEW: 3, BELOW_RANDOM: 4 };

// Ranked by evidence: the board's verdict first, then how the read fares against random entries
// in its own window, then sample size. Stable for equal keys.
export function rankAxes(axes) {
  return (Array.isArray(axes) ? axes : [])
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const t = (TIER[x.a?.verdict] ?? 3) - (TIER[y.a?.verdict] ?? 3);
      if (t) return t;
      const b = (BASE_RANK[x.a?.random?.pooled?.verdict] ?? 3) - (BASE_RANK[y.a?.random?.pooled?.verdict] ?? 3);
      if (b) return b;
      const p = (y.a?.random?.pooled?.pctBeaten ?? -1) - (x.a?.random?.pooled?.pctBeaten ?? -1);
      if (p) return p;
      return x.i - y.i;
    })
    .map((x) => x.a);
}

// Compact cards: the board keeps every read visible, but a read with no edge doesn't get the
// same room as one that might have one.
export const isCompact = (a) => !a || a.verdict === "NOISE" || a.verdict === "INSUFFICIENT" || !a.best;

// The one honest line: what the evidence says today, in the order a reader needs it —
// which sides it trades, whether it clears the market's drift, and whether it beats random
// entries. Built only from served numbers; returns { text, tone } where tone is one of
// "pos" | "neg" | "neutral" (the card maps tone to a colour).
export function takeaway(a) {
  if (!a || !a.best || a.verdict === "INSUFFICIENT") return { text: "Accruing. Not enough history to rate yet.", tone: "neutral" };
  const parts = [];
  const L = a.sides?.LONG?.events ?? 0, S = a.sides?.SHORT?.events ?? 0;
  if (L + S > 0 && S === 0) parts.push("Long-only in practice");
  else if (L + S > 0 && L === 0) parts.push("Short-only in practice");
  const drift = a.best.drift;
  const clearsDrift = drift ? drift.excessBps > 0 : null;
  const rb = a.random?.pooled;
  let tone = "neutral";
  if (rb?.verdict === "BEATS_RANDOM") { parts.push(`beats random entries in its window (${rb.pctBeaten}%)`); tone = "pos"; }
  else if (rb?.verdict === "BELOW_RANDOM") { parts.push(`reliably worse than random entries (${rb.pctBeaten}%)`); tone = "neg"; }
  else if (rb?.verdict === "LEANS_ABOVE") {
    parts.push(`leans above random entries (${rb.pctBeaten}%), not yet separated` + (rb.moreTradesNeeded ? `, ~${rb.moreTradesNeeded} more events` : ""));
  } else if (rb?.verdict === "NOT_DISTINGUISHABLE") parts.push("can't yet be told apart from random entries");
  else if (rb?.verdict === "TOO_FEW") parts.push("too few events to test against random");
  if (clearsDrift === false) { parts.push("edge doesn’t clear the market’s drift"); if (tone === "neutral") tone = "neg"; }
  if (!parts.length) return { text: "Graded. No baseline yet.", tone };
  const text = parts.join(" · ");
  return { text: text[0].toUpperCase() + text.slice(1) + ".", tone };
}

// One side's bar: width = share of random replays the read beat (0–100), sign = its mean R.
// A side that never fired says so; a side too thin to test says that instead of a bar.
export function sideBar(a, side) {
  const s = a?.sides?.[side];
  const rb = a?.random?.bySide?.[side];
  const events = s?.events ?? 0;
  if (!events) return { events: 0, state: "never", label: "never fires" };
  const meanR = s?.r?.samples ? s.r.meanR : null;
  if (!rb || rb.verdict === "TOO_FEW" || rb.pctBeaten == null) return { events, state: "thin", meanR, label: "too few to test" };
  return { events, state: "tested", meanR, pct: Math.max(0, Math.min(100, rb.pctBeaten)), verdict: rb.verdict };
}
