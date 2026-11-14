// A ticker inside a button label (pure; tests: tickerLabel.test.mjs). Tickers run long ("FARTCOIN",
// "TRUMPWIN", a 19-letter meme); in a half-width phone button the name pushed the label past the edge.
// Up to TICKER_MAX characters show whole; a longer one shows its first TICKER_MAX - 1 and "…".
export const TICKER_MAX = 10;
export function tickerLabel(sym, max = TICKER_MAX) {
  const s = String(sym ?? "").trim();
  const chars = Array.from(s); // count characters, not UTF-16 units
  return chars.length <= max ? s : chars.slice(0, max - 1).join("") + "…";
}
