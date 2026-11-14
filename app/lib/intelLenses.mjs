// Lab home (Intel): the lenses behind the Board, as ONE card with a chip per lens instead of six stacked folds
// (2026-11-14, borst: "level up the Lab"). Only the chosen lens mounts, so first paint stays as light as the folds
// were. The choice is remembered per device; `/lab?lens=<id>` opens one directly.
// Rules here (tested); the card is app/pages/lab/IntelLenses.tsx.

/** Order = the funnel: the boards the Board summarizes first, the event/forecast layer, then the raw tape. */
export const INTEL_LENSES = [
  { id: "funding", label: "Funding", sub: "every stretched perp, and where funding reverted vs kept stretching", legacyKey: "nx_funding_board_open" },
  { id: "positioning", label: "Positioning", sub: "where the leveraged crowd and the sharp wallets disagree", legacyKey: "nx_positioning_open" },
  { id: "catalysts", label: "Catalysts", sub: "liquid prediction-market events mapped to the markets they move here", legacyKey: "nx_catalysts_open" },
  { id: "forecast", label: "Forecasts", sub: "where prediction markets disagree with price, our markets only", legacyKey: "nx_forecast_open" },
  { id: "qsignals", label: "Q Signals", sub: "Quotient’s fair value vs the market · PRO, each pull paid by your wallet", legacyKey: "nx_qsignals_open" },
  { id: "tape", label: "Tape", sub: "news, movers, open interest and long/short, per market", legacyKey: "nx_intel_deep_open" },
];

/** localStorage key: a lens id, or "none" when the reader closed the card. */
export const LENS_KEY = "nx_intel_lens";
export const LENS_NONE = "none";

const IDS = new Set(INTEL_LENSES.map((l) => l.id));

/** A valid lens id from a query value (case-insensitive), else null. */
export function lensFromQuery(v) {
  const id = String(v ?? "").trim().toLowerCase();
  return IDS.has(id) ? id : null;
}

/**
 * The lens to show on arrival. `get(key)` reads storage (may throw or return null).
 * Order: the query → the stored choice ("none" = closed) → the first lens the reader had opened under the old
 * fold keys (so nobody loses the board they kept open) → closed.
 */
export function initialLens(get, query) {
  const q = lensFromQuery(query);
  if (q) return q;
  const read = (k) => { try { return get(k); } catch { return null; } };
  const stored = read(LENS_KEY);
  if (stored === LENS_NONE) return null;
  if (IDS.has(stored)) return stored;
  for (const l of INTEL_LENSES) if (read(l.legacyKey) === "1") return l.id;
  return null;
}

/** Tapping the open lens closes the card; tapping another opens it. Returns [next, valueToStore]. */
export function nextLens(current, tapped) {
  if (!IDS.has(tapped)) return [current, current ?? LENS_NONE];
  return current === tapped ? [null, LENS_NONE] : [tapped, tapped];
}
