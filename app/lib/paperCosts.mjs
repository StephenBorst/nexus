// ── The paper record, re-read with costs ────────────────────────────────────────────────────
// Paper P&L (exec computePnl) is price move × size: no trading fee and no funding. A live
// account pays both. This re-reads the RETAINED paper rows (state.paper_trades, last 50) with:
//   fees    = (entry notional + exit notional) × the taker rate, in bps per side
//   funding = entry notional × the funding the position paid while held (heldFundingBps, from
//             the hourly rates in oi:hist), positive = paid, negative = collected
// Display only: nothing here writes the ledger, and exec is untouched. A row whose funding
// can't be read (an hour with no recorded rate) is counted in `fundingMissing` and left out
// of the funding sum, never read as free.

import { fundingByHour, heldFundingBps } from "./funding.mjs";
import { tradeNotional, holdHours } from "./paperStats.mjs";

/** What the Lab assumes until the account's real taker rate is set (the grader's 3 bps/side). */
export const ASSUMED_TAKER_BPS = 3;

/**
 * The taker rate to use, and where it came from.
 * @param {unknown} configured env value (string), or undefined
 * @returns {{ feeBps: number, feeSource: "account" | "assumed" }}
 */
export function paperFeeRate(configured) {
  const n = configured == null || configured === "" ? NaN : Number(configured);
  return Number.isFinite(n) && n >= 0 && n <= 100
    ? { feeBps: n, feeSource: "account" }
    : { feeBps: ASSUMED_TAKER_BPS, feeSource: "assumed" };
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * @param {Array<object>} trades paper rows (entry_price, exit_price, qty, direction, pnl, symbol, opened_at, closed_at)
 * @param {{ feeBps: number, oiHistBySymbol?: Record<string, Array<{t:number, funding?:number}>> }} o
 */
export function paperCostReread(trades, { feeBps, oiHistBySymbol = {} }) {
  const fmaps = new Map();
  const fmapFor = (sym) => {
    if (!fmaps.has(sym)) fmaps.set(sym, oiHistBySymbol[sym] ? fundingByHour(oiHistBySymbol[sym]) : null);
    return fmaps.get(sym);
  };
  let gross = 0, fees = 0, funding = 0, counted = 0, fundingMissing = 0, skipped = 0;
  for (const t of trades || []) {
    const pnl = Number(t?.pnl);
    const entryN = tradeNotional(t);
    const exitN = Number(t?.exit_price) * Number(t?.qty);
    if (!Number.isFinite(pnl) || entryN == null || !(Number.isFinite(exitN) && exitN > 0)) { skipped++; continue; }
    counted++;
    gross += pnl;
    fees += (entryN + exitN) * feeBps / 10_000;
    const opened = Date.parse(t.opened_at ?? "");
    const hh = holdHours(t);
    const side = t.direction === "LONG" || t.direction === "SHORT" ? t.direction : null;
    const bps = Number.isFinite(opened) && hh != null && side
      ? heldFundingBps(fmapFor(String(t.symbol || "")), Math.round(opened / 3600000), Math.max(1, Math.round(hh)), side)
      : null;
    if (bps == null) fundingMissing++;
    else funding += entryN * bps / 10_000;
  }
  return {
    trades: counted,
    skipped,
    feeBps,
    grossUsd: round2(gross),
    feesUsd: round2(fees),
    fundingUsd: round2(funding),
    fundingMissing,
    netUsd: round2(gross - fees - funding),
  };
}
