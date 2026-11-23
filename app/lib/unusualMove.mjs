// ── Unusual moves: a coin moved more than it usually does, by its OWN history (borst 2026-11-23, after the inbox) ──
// The projection band's 25–75% box is crossed half the time by construction, so alerting on it would be noise. This
// measures instead: every 4-hour move the coin made over its last 90 days (hourly bars, overlapping windows), and the
// 10th / 90th percentile of those moves as the lines. A move past a line is unusual for THAT coin (a 3% hour is normal
// for a small cap and rare for BTC). The alert says how rare, in words, from the same numbers. Facts only: no
// direction, no "chase" or "fade"; a move is not a signal.
//
// Pure + tested (unusualMove.test.mjs). Runner: lab-api marketWatch.mjs (the */5 coin alerts, `markets` switch).

const H = 3600_000;
export const MOVE_HOURS = 4;
export const MOVE_LOOKBACK_DAYS = 90;
export const MOVE_PCT = 90;            // the line: beyond 90% of past moves (and the 10% line for drops)
export const MOVE_MIN_SAMPLES = 500;   // fewer past windows than this = no lines, no alert
export const MOVE_COOLDOWN_MS = MOVE_HOURS * H; // one alert per side per coin per window

const pctl = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];

/** Hourly closes keyed by hour, oldest first; bars: [{t (ms), c}]. */
function hourly(bars) {
  const m = new Map();
  for (const b of Array.isArray(bars) ? bars : []) {
    const t = Math.floor(Number(b?.t) / H) * H, c = Number(b?.c);
    if (Number.isFinite(t) && c > 0) m.set(t, c);
  }
  return m;
}

/**
 * The coin's own lines: the 10th and 90th percentile of its `hours`-hour moves over the lookback, in %.
 * @returns {{ up: number, down: number, moves: number[], samples: number } | null}
 */
export function moveLines(bars, { hours = MOVE_HOURS, lookbackDays = MOVE_LOOKBACK_DAYS, now = Date.now(), pct = MOVE_PCT } = {}) {
  const m = hourly(bars);
  const from = now - lookbackDays * 24 * H;
  const moves = [];
  for (const [t, c] of m) {
    if (t < from) continue;
    const before = m.get(t - hours * H);
    if (before > 0) moves.push((c / before - 1) * 100);
  }
  if (moves.length < MOVE_MIN_SAMPLES) return null;
  const sorted = [...moves].sort((a, b) => a - b);
  return { up: pctl(sorted, pct), down: pctl(sorted, 100 - pct), moves: sorted, samples: sorted.length };
}

/** The move now: the latest close vs the close `hours` before it. null when either hour is missing. */
export function currentMove(bars, { hours = MOVE_HOURS } = {}) {
  const m = hourly(bars);
  if (!m.size) return null;
  const last = Math.max(...m.keys());
  const before = m.get(last - hours * H);
  return before > 0 ? { pct: (m.get(last) / before - 1) * 100, at: last } : null;
}

/**
 * Is the move past the coin's own line? `share` = how many of its past moves this one beats, on its side.
 * @returns {{ side: "UP"|"DOWN"|null, movePct: number, line: number|null, share: number|null }}
 */
export function unusualMove(lines, move) {
  if (!lines || !move || !Number.isFinite(move.pct)) return { side: null, movePct: move?.pct ?? NaN, line: null, share: null };
  const p = move.pct;
  if (p > 0 && p >= lines.up) {
    const share = Math.round((lines.moves.filter((x) => x < p).length / lines.samples) * 100);
    return { side: "UP", movePct: p, line: lines.up, share };
  }
  if (p < 0 && p <= lines.down) {
    const share = Math.round((lines.moves.filter((x) => x > p).length / lines.samples) * 100);
    return { side: "DOWN", movePct: p, line: lines.down, share };
  }
  return { side: null, movePct: p, line: null, share: null };
}

/** Fire once per side per window: a new side, or the same side after the cooldown. prev = { side, at } | null. */
export function moveDue(prev, side, now) {
  if (!side) return false;
  if (!prev || prev.side !== side) return true;
  return now - Number(prev.at) >= MOVE_COOLDOWN_MS;
}

const sign = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;
/** "ETH rose 4.1% in 4 hours: higher than 96% of its 4-hour moves in the last 90 days (its 90% line is +3.2%). …" */
export function moveMessage(coin, u, { hours = MOVE_HOURS, lookbackDays = MOVE_LOOKBACK_DAYS } = {}) {
  const verb = u.side === "UP" ? "rose" : "fell";
  const cmp = u.side === "UP" ? "higher than" : "lower than";
  const lineName = u.side === "UP" ? `${MOVE_PCT}% line` : `${100 - MOVE_PCT}% line`;
  return `${coin} ${verb} ${Math.abs(u.movePct).toFixed(1)}% in ${hours} hours: ${cmp} ${u.share}% of its ${hours}-hour moves in the last ${lookbackDays} days (its ${lineName} is ${sign(u.line)}). A move, not a signal.`;
}
