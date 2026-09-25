// ── Funding, at both horizons ────────────────────────────────────────────────
// Orderly funds every 8h, so an annualized funding figure is nothing more than the
// period rate × 1095 (3 × 365). They are the SAME fact at two horizons.
//
// Why this exists: the Mispriced Board led with the annualized number alone, and a thin
// FX perp printing −206%/yr reads as a broken feed until you can see it is −0.188% every
// 8h, charged 1095 times. The fix is to SHOW the arithmetic, not to hide the result.
//
// ⚠️ NEVER clamp the annualized figure into a "reasonable" range. It is arithmetic on a
// real rate; squashing it would be lying about the tape, and the whole board rests on the
// claim that every column is verifiable against public data.
//
// Pure + dependency-free so the worker, the Lab and the tests all read the same rule.

export const FUNDING_PERIODS_PER_YEAR = 1095; // 3 × 365 — mirrors MISPRICED.fundingPeriodsPerYear

/** Annualize a period (per-8h) funding rate expressed in percent. */
export function annualizeFundingPct(period8hPct) {
  const v = Number(period8hPct);
  if (!Number.isFinite(v)) return null;
  return v * FUNDING_PERIODS_PER_YEAR;
}

/** Recover the period (per-8h) rate from an annualized one, both in percent. */
export function periodFromAnnualPct(annualPct) {
  const v = Number(annualPct);
  if (!Number.isFinite(v)) return null;
  return v / FUNDING_PERIODS_PER_YEAR;
}

/**
 * Format a per-8h funding rate for display: "-0.188%", "+0.01%", "0".
 * Period rates are small, so precision scales with magnitude — a live rate must never
 * round away to a flat "0.00%", which would report a paying crowd as a free one.
 * Returns null (not a string) when there is no number, so callers can omit the line
 * entirely rather than print a placeholder.
 * @param {number|null|undefined} period8hPct
 * @returns {string|null}
 */
export function fmtFunding8h(period8hPct) {
  if (period8hPct == null || period8hPct === "") return null;
  const n = Number(period8hPct);
  if (!Number.isFinite(n)) return null;
  const a = Math.abs(n);
  const dp = a >= 0.1 ? 3 : a >= 0.01 ? 4 : 5;
  const body = n.toFixed(dp).replace(/0+$/, "").replace(/\.$/, "");
  return `${n > 0 ? "+" : ""}${body}%`;
}

// ── Liquidity confidence ─────────────────────────────────────────────────────
// The board's server gate is $50k of OI, and that gate is correct: open_interest arrives
// in BASE units and is priced to USD before the compare, so a wide funding print on a dust
// book is already excluded. But clearing $50k is not the same as being liquid — on a thin
// book a few positions can pin funding at an extreme for days with no crowd to unwind,
// which is the entire premise of the fade. So we do NOT tighten the gate (that silently
// drops live markets); we mark the read low-confidence and leave the number on screen.
export const BOARD_MIN_OI_USD = 50_000;   // the server floor (MISPRICED.minOiUsd)
export const THIN_OI_USD = 1_000_000;     // 20× the floor — below this, low confidence

/** True when a market clears the board's floor but is too thin to trust the crowd read. */
export function isThinBook(oiUsd, thinUnder = THIN_OI_USD) {
  // ⚠️ Number(null) is 0, which is "< $1M" — absent OI would flag as THIN BOOK and assert
  // a liquidity read we never took. No reading ⇒ no claim.
  if (oiUsd == null || oiUsd === "") return false;
  const v = Number(oiUsd);
  if (!Number.isFinite(v)) return false;
  return v < thinUnder;
}
