// MAE / MFE IN R (borst 2026-11-16, "measuring excursions without live curve-fitting"): how far a trade went
// AGAINST it (maximum adverse excursion) and how far it went FOR it (maximum favourable excursion) while it was
// open, each in R (the trade's own risk, entry to stop). Display only: nothing grades, sizes or tunes on it. A
// tighter rule found by reading these is a NEW read, registered and graded first (read-pipeline.md).
//
// The bars: every bar after the fill bar up to and including the exit bar (or the last bar while open). Inside
// the fill bar the order of prints is unknown (the extreme may have come before the fill), so it is left out.
// Inside the exit bar it is unknown too, so that bar counts only up to the trade's own levels: the adverse side
// never past the stop (`maxAdverse`, 1R, or the exit's own R when a paper fill slipped past it), the favourable
// side never past the target the trade exited at (`maxFavor`). Bars are 1-minute for calls graded on minutes,
// 1-hour otherwise and for paper trades (candle:hist): precision = the bar.

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * @param {{ long: boolean, entry: number, risk: number, highs: number[], lows: number[],
 *           exitBar?: number|null, maxAdverse?: number, maxFavor?: number }} p
 *   highs/lows: the bars after the fill, oldest first; exitBar = the index (in them) of the bar the trade closed in.
 * @returns {{ maeR: number, mfeR: number } | null} both ≥ 0; null with no bar or no risk
 */
export function excursionR({ long, entry, risk, highs, lows, exitBar = null, maxAdverse = 1, maxFavor = Infinity }) {
  const e = Number(entry), k = Number(risk);
  if (!(e > 0) || !(k > 0) || !Array.isArray(highs) || !Array.isArray(lows) || !highs.length) return null;
  let mae = 0, mfe = 0;
  const last = exitBar == null ? highs.length - 1 : Math.min(exitBar, highs.length - 1);
  for (let i = 0; i <= last; i++) {
    const h = Number(highs[i]), l = Number(lows[i]);
    if (!(h > 0) || !(l > 0)) continue;
    let adv = (long ? e - l : h - e) / k, fav = (long ? h - e : e - l) / k;
    if (i === exitBar) { adv = Math.min(adv, maxAdverse); fav = Math.min(fav, maxFavor); }
    if (adv > mae) mae = adv;
    if (fav > mfe) mfe = fav;
  }
  return { maeR: r2(mae), mfeR: r2(mfe) };
}

/**
 * A closed paper row's excursion from the recorded hourly tape (candle:hist, t in ms). The entry's hour is the
 * fill bar (left out); the exit's hour is the exit bar. Risk = entry × sl_percent (exec stamps it from
 * 2026-11-12); a row without it has no R, so no excursion.
 */
export function paperExcursion(row, candleHist) {
  const entry = Number(row?.entry_price), sl = Number(row?.sl_percent);
  const opened = Date.parse(row?.opened_at ?? "") || Number(row?.opened_at), closed = Date.parse(row?.closed_at ?? "") || Number(row?.closed_at);
  if (!(entry > 0) || !(sl > 0) || !Number.isFinite(opened) || !Number.isFinite(closed) || !Array.isArray(candleHist)) return null;
  const H = 3600000, from = Math.floor(opened / H) * H + H, exitHour = Math.floor(closed / H) * H;
  const bars = candleHist.filter((c) => c && Number(c.t) >= from && Number(c.t) <= exitHour).sort((a, b) => a.t - b.t);
  if (!bars.length) return null;
  const long = row.direction !== "SHORT", risk = entry * sl / 100;
  const exitIdx = bars.findIndex((c) => Number(c.t) === exitHour);
  const exitPx = Number(row.exit_price);
  const exitR = exitPx > 0 ? ((long ? exitPx - entry : entry - exitPx) / risk) : null;
  const tp = Number(row.tp_percent);
  return excursionR({
    long, entry, risk, highs: bars.map((c) => +c.h), lows: bars.map((c) => +c.l), exitBar: exitIdx >= 0 ? exitIdx : null,
    maxAdverse: Math.max(1, exitR != null && exitR < 0 ? -exitR : 0),
    maxFavor: row.reason === "TP" && tp > 0 ? tp / sl : Math.max(exitR ?? 0, 0),
  });
}

/** "Went 0.40R against · 1.20R for" — one line for a card. */
export function excursionLine(x) {
  if (!x || !Number.isFinite(x.maeR) || !Number.isFinite(x.mfeR)) return null;
  return `Went ${x.maeR.toFixed(2)}R against · ${x.mfeR.toFixed(2)}R for, while open`;
}
