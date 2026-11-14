// Smart Money's live feed: which opens/closes are worth a row. Rules here (tested); SmartMoneyView renders them.
//
// 2026-11-14 (borst: level up the Lab): the feed showed every fill the indexer saw, so "$15 size closed SHORT GRAM"
// and "$23 opened SHORT TAO" sat beside $55K entries. Moves under FEED_MIN_USD are folded behind a "show N small
// moves" toggle: hidden by default, never deleted, and the count says how many.

/** A move smaller than this (USD notional) is folded by default. */
export const FEED_MIN_USD = 1000;
/** Rows shown before "show more", and the most the feed ever lists. */
export const FEED_FIRST = 8;
export const FEED_MAX = 30;

const size = (e) => (typeof e?.szUsd === "number" && Number.isFinite(e.szUsd) ? Math.abs(e.szUsd) : 0);

/**
 * The rows to render, in the order given (the server sends newest first).
 * `showSmall` keeps the small moves in; `all` lifts the FEED_FIRST cap (never past FEED_MAX).
 * Returns { rows, small, more }: `small` = how many small moves are folded away (0 when shown), `more` = how many
 * more rows "show more" would add.
 */
export function feedRows(events, { showSmall = false, all = false, minUsd = FEED_MIN_USD } = {}) {
  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  const kept = showSmall ? list : list.filter((e) => size(e) >= minUsd);
  const small = showSmall ? 0 : list.length - kept.length;
  const capped = kept.slice(0, FEED_MAX);
  const rows = all ? capped : capped.slice(0, FEED_FIRST);
  return { rows, small, more: all ? 0 : capped.length - rows.length };
}
