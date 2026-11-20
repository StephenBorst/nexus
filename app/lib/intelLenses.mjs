// Lab home's deep boards (borst 2026-11-20: "fold the old lens strip into the table and the coin drawer so those chips
// don't sit as a separate silo"). There is no chip strip any more. Each board opens from where its data already lives:
//   - the Wire: the full news list, the week's calendar, world-event catalysts;
//   - the market table: the full board behind a column (funding, venues, positioning, forecasts), plus the two boards
//     no column carries (Q Signals, the raw market tape) on the table's footer line.
// Per coin, every one of them is already a lens in the coin's drawer (app/lib/marketRead.mjs). One board opens at a time,
// under the table; `/lab?lens=<id>` still opens one directly (old links, ⌘K "news"). Rules here, tested.

/** The boards (ids kept from the lens strip so old `?lens=` links still land). `home` = where its opener lives. */
export const INTEL_LENSES = [
  { id: "news", label: "News", sub: "headlines read by our server, tagged by the coins they name", home: "wire" },
  { id: "funding", label: "Funding", sub: "every stretched perp, and where funding reverted vs kept stretching", home: "table", column: "funding" },
  { id: "venues", label: "Venues", sub: "the same coin’s funding on Orderly, Hyperliquid and OKX, side by side", home: "table", column: "gap" },
  { id: "positioning", label: "Positioning", sub: "where the leveraged crowd and the sharp wallets disagree", home: "table", column: "smart" },
  { id: "catalysts", label: "Catalysts", sub: "liquid prediction-market events mapped to the markets they move here", home: "wire" },
  { id: "calendar", label: "Calendar", sub: "US macro releases and dated world events, by day, in your time zone", home: "wire" },
  { id: "forecast", label: "Forecasts", sub: "where prediction markets disagree with price, our markets only", home: "table", column: "forecast" },
  { id: "qsignals", label: "Q Signals", sub: "Quotient’s fair value vs the market · PRO, each pull paid by your wallet", home: "table" },
  { id: "tape", label: "Market tape", sub: "movers, open interest and long/short, per market", home: "table" },
];

const IDS = new Set(INTEL_LENSES.map((l) => l.id));

/** A valid board id from a query value (case-insensitive), else null. */
export function lensFromQuery(v) {
  const id = String(v ?? "").trim().toLowerCase();
  return IDS.has(id) ? id : null;
}

/** The board a lab visit opens with: only one named in the link. Lab home itself opens with none (the Wire leads). */
export const initialBoard = (query) => lensFromQuery(query);

/** Opening the open board closes it; another replaces it; an unknown id changes nothing. */
export function toggleBoard(current, tapped) {
  if (!IDS.has(tapped)) return current;
  return current === tapped ? null : tapped;
}

export const boardById = (id) => INTEL_LENSES.find((l) => l.id === id) ?? null;
/** The boards a home offers (wire / table), in registry order. */
export const boardsAt = (home) => INTEL_LENSES.filter((l) => l.home === home);
/** The full board behind a market-table column, or null. */
export const boardForColumn = (col) => INTEL_LENSES.find((l) => l.column === col) ?? null;
