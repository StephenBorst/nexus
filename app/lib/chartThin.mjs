// Thin a chart's data before it reaches the SVG (2026-11-21). Pure, tested (chartThin.test.mjs).
//
// Why: the X-Ray hands AnalyticsView every closed trade, and a market-making wallet can close 17,000 in a week. One
// <rect> + <title> per trade and a 17,000-point path froze the page (the tab hung with the data loaded). A chart can
// only show a few hundred columns anyway, so:
//   • bars: consecutive trades are summed into ≤ BAR_MAX buckets, each labelled with its trade range and sum;
//   • the equity line: each bucket keeps its lowest and highest point in time order, plus the exact first and last,
//     so a drawdown and the final value stay where they are.
// Nothing here changes a number anywhere else: the grades, win rate and totals are computed on every trade.

export const BAR_MAX = 400;
export const LINE_MAX = 800;

/** min / max of a long array without spreading it into Math.min (which overflows the stack past ~100k). */
export function extent(values) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values || []) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return { lo, hi };
}

/** ≤ max points: first, last, and each bucket's low + high in time order. */
export function thinSeries(points, max = LINE_MAX) {
  const p = Array.isArray(points) ? points : [];
  if (p.length <= max) return p;
  const buckets = Math.max(1, Math.floor((max - 2) / 2));
  const size = Math.ceil((p.length - 2) / buckets);
  const out = [p[0]];
  for (let s = 1; s < p.length - 1; s += size) {
    const e = Math.min(p.length - 1, s + size);
    let iLo = s, iHi = s;
    for (let i = s; i < e; i++) { if (p[i] < p[iLo]) iLo = i; if (p[i] > p[iHi]) iHi = i; }
    if (iLo === iHi) out.push(p[iLo]);
    else if (iLo < iHi) out.push(p[iLo], p[iHi]);
    else out.push(p[iHi], p[iLo]);
  }
  out.push(p[p.length - 1]);
  return out;
}

const money = (v) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;

/**
 * ≤ max bars. Each bar = `size` consecutive trades summed. Labels: one trade keeps its own label; a bucket says
 * "Trades 41–80 · 40 trades · +$12.30". @returns {{ values: number[], labels: string[] | undefined, size: number }}
 */
export function bucketBars(values, labels, max = BAR_MAX) {
  const v = Array.isArray(values) ? values : [];
  if (v.length <= max) return { values: v, labels, size: 1 };
  const size = Math.ceil(v.length / max);
  const outV = [], outL = [];
  for (let s = 0; s < v.length; s += size) {
    const e = Math.min(v.length, s + size);
    let sum = 0;
    for (let i = s; i < e; i++) sum += v[i];
    outV.push(sum);
    outL.push(`Trades ${s + 1}–${e} · ${e - s} trades · ${money(sum)}`);
  }
  return { values: outV, labels: outL, size };
}
