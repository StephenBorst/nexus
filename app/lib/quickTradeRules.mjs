// ── Quick Trade's money rules (borst 2026-11-27, "keep going thru them all") ─────────────────────────────────────────
// What the audit found on the Lab's one-screen market order (QuickTrade.tsx):
//   · LEVERAGE: Orderly sets leverage PER MARKET (and per margin mode). The ticket changed the ACCOUNT's max leverage
//     (`useLeverage().update({ leverage })`, no symbol) and compared against it, so a 2× ticket could fill at whatever
//     that market was set to. The agent always sends the symbol (exec `/v1/client/leverage {symbol, leverage}`). Now the
//     ticket reads the market's own leverage (`useLeverageBySymbol`) and sets it with the symbol and margin mode
//     (`useSymbolLeverage(symbol).update`), as the trading page does.
//   · LIQUIDATION: the ticket printed `mark × (1 − 1/lev + mmr)`, an isolated-margin guess, on a cross-margin account,
//     where the real line depends on everything else held. It now shows Orderly's own estimate for the exact order
//     (useOrderEntry `estLiqPrice`, after the side and size are set), on the confirm step, and says when there is none.
//   · CONFIRM: only orders over $100 asked twice. A 50× $90 order fired on one tap. Now ≥ 10× also asks.
//   · MAX: free collateral × leverage to the cent is refused by Orderly (fees + the move while it fills). It keeps 5%.
//   · RESULT: `submit()` answers `{ success }`; the ticket said "order placed ✓" without reading it. It reads it now,
//     and says what happened ("sent", not "filled") in ink: green/red is money only.
// Pure + tested (quickTradeRules.test.mjs).

export const CONFIRM_OVER_USD = 100;
export const CONFIRM_FROM_LEV = 10;
export const MAX_BUFFER = 0.95;

/** Two taps for a big or high-leverage order. */
export const needsConfirm = ({ notional, lev }) => Number(notional) > CONFIRM_OVER_USD || Number(lev) >= CONFIRM_FROM_LEV;

/** The Max chip: free collateral × leverage, keeping 5% for fees and the move while it fills. */
export function maxNotionalFor(freeCollateral, lev) {
  const f = Number(freeCollateral), l = Number(lev);
  if (!(f > 0) || !(l > 0)) return 0;
  return Math.floor(f * l * MAX_BUFFER);
}

/** Does the market's leverage have to change before this order? Unknown current = yes (set it, never assume). */
export function leverageChange(chosen, current) {
  const c = Number(chosen);
  if (!(c >= 1)) return null;
  return Number(current) === c ? null : c;
}

const px = (n) => (n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : Number(n.toPrecision(5)).toString());

/**
 * Orderly's liquidation estimate for this exact order, in words. null estimate = say there's none.
 * @returns {{ line: string, warn: boolean }}
 */
export function liqLine({ estLiqPrice, mark, side }) {
  const e = Number(estLiqPrice), m = Number(mark);
  if (!(e > 0) || !(m > 0)) return { line: "Orderly gives no liquidation price for this order (the account has room to spare, or the estimate isn’t ready).", warn: false };
  const dist = side === "BUY" ? (m - e) / m : (e - m) / m;
  const pct = Math.abs(dist * 100);
  const warn = dist <= 0.05;
  return { line: `Orderly estimates liquidation at $${px(e)}, ${pct.toFixed(1)}% from the mark, after this order. Cross margin: it moves with everything else you hold.`, warn };
}

/** What the order did, from Orderly's answer. */
export function placedResult(res, { side, qty, coin }) {
  const word = side === "BUY" ? "long" : "short";
  if (res && res.success === false) {
    const why = res.message || res?.data?.message || "Orderly refused it";
    return { ok: false, text: `Orderly refused the ${coin} ${word}: ${why}. Nothing was placed.` };
  }
  return { ok: true, text: `Market ${word} ${qty} ${coin} sent to Orderly. It shows under Open positions once it fills.` };
}
