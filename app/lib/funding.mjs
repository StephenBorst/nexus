// ── Funding periodicity — the ONE place the ×1095 lives ──────────────────────
// Orderly funds every 8h, so an annualized funding figure is the period rate × 1095
// (3 × 365). That multiplier was written out by hand in eight places across the worker
// and the Lab — `* 1095 * 100`, `* 3 * 365 * 100`, and a `fundingPeriodsPerYear` config
// field — which is exactly the kind of literal that drifts silently: change the venue's
// funding interval and seven sites still annualize at the old cadence, with no test to
// catch it because each one "looks right" on its own.
//
// Deliberately NOT a formatting module. Display lives where it is rendered (MispricedBoard
// owns fmt8h/fmtYr); duplicating those here would recreate the two-sources-of-truth problem
// this file exists to remove. This is the constant and the one arithmetic that applies it.
//
// ⚠️ NEVER clamp the annualized result. A −0.188%/8h print on a thin FX perp really is
// −206%/yr; that is arithmetic on a real rate, and squashing it into a comfortable-looking
// range would be lying about the tape. Surface the multiplier instead — a reader who can
// see the ×1095 stops reading the number as a broken feed. A test below pins this.

/** Orderly funds three times a day. Annualized funding = per-period rate × this. */
export const FUNDING_PERIODS_PER_YEAR = 3 * 365; // 1095

/**
 * A readable rate, or null. The ONE guard for "is there actually a number here".
 * ⚠️ Number(null) is 0 and Number("") is 0, so both must be rejected BEFORE Number() —
 * a missing rate that reads as 0 reports a paying crowd as a free one. Returns null
 * rather than NaN because null is checkable at a call site while NaN propagates: it
 * renders as the string "NaN%", it poisons any arithmetic it touches, and inside a sort
 * comparator it compares false against everything, corrupting the ORDER of a whole table
 * rather than the position of one row.
 * @param {unknown} v
 * @returns {number|null}
 */
export function finiteOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Annualize a per-8h funding rate into PERCENT.
 * Takes the raw decimal rate as the venue reports it (0.0001 = 0.01% per 8h) and returns
 * percent per year (10.95). Absent/garbage input returns null rather than 0 — Number(null)
 * is 0, and a silent 0 would report a paying crowd as a free one.
 * @param {number|string|null|undefined} rate8h raw per-8h rate, as a decimal
 * @returns {number|null} percent per year, or null when there is no rate
 */
export function annualFundingPct(rate8h) {
  const v = finiteOrNull(rate8h);
  return v == null ? null : v * FUNDING_PERIODS_PER_YEAR * 100;
}
