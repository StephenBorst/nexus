// Market drawer → a call (2026-11-14, borst: "lens → call"). The drawer shows inputs, never a side; the trader
// picks one there ("Post a call → Long / Short"), and the Thesis Engine opens on that coin with the side the
// trader chose and builds the levels from live price (1.2× H4 ATR stop), so Post is the next tap. Same
// localStorage contract every board uses (nexus_thesis_draft). Pure, tested.
import { marketCoin } from "./marketRead.mjs";

/**
 * The draft for a coin + the side the trader tapped. Clears the previous coin's levels and text, so nothing
 * from another call rides along. null for a bad coin or side.
 */
export function marketCallDraft(coin, side) {
  const c = marketCoin(coin);
  if (!c || (side !== "LONG" && side !== "SHORT")) return null;
  return {
    symbol: c, direction: side,
    entryPrice: "", stopLoss: "", takeProfit1: "",
    notes: "", catalyst: "", targetWindow: "",
    sideChosen: true, // the trader's own tap, not a suggestion: the WATCH gate doesn't un-arm it
    build: true,      // build the levels from live price on arrival
    source: "market-drawer",
  };
}
