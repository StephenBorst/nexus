// ── How old a price/OI baseline may be (pure; tests: marketSnapshot.test.mjs) ──────────────────────
// `market:prev:{symbol}` is the snapshot the brain leaves each time it evaluates a market (every
// ~5 min, but only while a flat active agent watches it). Deltas measured from it are "the move
// since the last cycle". After a quiet stretch it can be hours or days old, and a delta from it is
// a multi-day move read as one cycle. One rule for every reader: the brain's signal (MOMENTUM,
// MEAN_REVERSION, OI_ONLY, CONFLUENCE) and lab-api's /signals rows + trend-regime OI.
// A snapshot older than PREV_MAX_AGE_MS (2 cycles + slack), without a time, or from the future
// is not a baseline: no delta.
export const PREV_MAX_AGE_MS = 12 * 60 * 1000;

export function prevSnapshotUsable(prev, now = Date.now()) {
  if (!prev || !(Number(prev.price) > 0)) return false;
  const t = Number(prev.timestamp);
  return Number.isFinite(t) && t <= now && now - t <= PREV_MAX_AGE_MS;
}
