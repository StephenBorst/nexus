// ── The recorded universe: which markets the basis × CVD read is recorded and graded on ──────
// The scoreboard's one live read (basis_x_cvd) was picked on nine coins. Widening the recorder gives
// it more events per day AND a holdout: coins the rule was never looked at on. borst (2026-10-16):
// the new list comes to him for sign-off first, it passes a LIQUIDITY filter (not just "listed on
// both"), and the new coins are record-and-grade only: no trading change, no agent config change.
//
// This module only RANKS candidates. It never changes what is recorded: the lists live in
// app/lib/recordedUniverse.mjs (the nine + the signed-off holdout), changed only by a reviewed edit.
//
// A candidate needs three markets, because basis = OKX perp vs OKX spot and the agent trades
// Orderly: an Orderly PERP_<X>_USDC, OKX <X>-USDT spot, OKX <X>-USDT-SWAP. Names must match
// exactly (coinToSpot in flow.mjs is a plain <X>-USDT): an Orderly name OKX doesn't carry under
// the same ticker (e.g. a 1000-prefixed coin) is listed as `unmatched`, never guessed.
//
// Liquidity is read on all three legs. A thin spot leg makes the basis a quote artefact; a thin
// OKX perp makes CVD a handful of prints; a thin Orderly book means a paper fill no live order
// could get. USD figures: OKX SPOT volCcy24h is quote volume (USDT); OKX SWAP volCcy24h is BASE
// volume, priced at `last`; Orderly `24h_amount` is quote volume, `open_interest` is base × mark.

import { RECORDED_COINS, HOLDOUT_COINS } from "../../app/lib/recordedUniverse.mjs";
export { RECORDED_COINS, HOLDOUT_COINS };

// Floors, all in USD over 24h, signed off by borst 2026-10-16. The OKX legs feed the read (basis =
// spot vs perp, CVD = perp prints). The Orderly legs only have to show real trades behind the
// candles we grade on (record-and-grade: nothing fills there), so they sit at "no thinner than the
// nine we already grade" — first proposed at $1M / $500k, which failed six of our own nine.
export const UNIVERSE_RULES = Object.freeze({
  minOkxSpotUsd: 5_000_000,
  minOkxSwapUsd: 20_000_000,
  minOrderlyVolUsd: 40_000,
  minOrderlyOiUsd: 30_000,
  // Same ticker, same asset? Orderly mark vs OKX perp last. Past this gap the names are treated as
  // different coins (unmatched), never guessed.
  maxPriceGapPct: 2,
});

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const bareOf = (sym) => String(sym || "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");

/**
 * @param {{ orderlyRows: object[], okxSpot: object[], okxSwap: object[], rules?: object, recorded?: string[] }} input
 * @returns {{ rules, rows, passing: string[], newPassing: string[], unmatched: string[] }}
 */
export function rankUniverse({ orderlyRows = [], okxSpot = [], okxSwap = [], rules = UNIVERSE_RULES, recorded = RECORDED_COINS, holdout = HOLDOUT_COINS } = {}) {
  const spot = new Map(), swap = new Map();
  for (const t of okxSpot || []) {
    const m = /^([A-Z0-9]+)-USDT$/.exec(String(t?.instId || ""));
    if (m) spot.set(m[1], num(t.volCcy24h));
  }
  for (const t of okxSwap || []) {
    const m = /^([A-Z0-9]+)-USDT-SWAP$/.exec(String(t?.instId || ""));
    if (m) swap.set(m[1], { usd: num(t.volCcy24h) * num(t.last), last: num(t.last) });
  }
  const rec = new Set(recorded), hold = new Set(holdout);
  const rows = [], unmatched = [];
  for (const r of orderlyRows || []) {
    const sym = String(r?.symbol || "");
    if (!/^PERP_[A-Z0-9]+_USDC$/.test(sym)) continue;
    const coin = bareOf(sym);
    const hasSpot = spot.has(coin), hasSwap = swap.has(coin);
    if (!hasSpot || !hasSwap) { unmatched.push(`${coin} (${!hasSpot && !hasSwap ? "no OKX spot or perp" : !hasSpot ? "no OKX spot" : "no OKX perp"})`); continue; }
    const mark = num(r.mark_price), okxLast = swap.get(coin).last;
    const gap = mark > 0 && okxLast > 0 ? Math.abs(mark - okxLast) / okxLast * 100 : null;
    if (rules.maxPriceGapPct != null && (gap == null || gap > rules.maxPriceGapPct)) {
      unmatched.push(`${coin} (${gap == null ? "no price to compare" : `price gap ${gap.toFixed(1)}% vs OKX`})`);
      continue;
    }
    const row = {
      coin,
      recorded: rec.has(coin),
      holdout: hold.has(coin),
      priceGapPct: Math.round(gap * 100) / 100,
      orderlyVolUsd: Math.round(num(r["24h_amount"])),
      orderlyOiUsd: Math.round(num(r.open_interest) * num(r.mark_price)),
      okxSpotVolUsd: Math.round(spot.get(coin)),
      okxSwapVolUsd: Math.round(swap.get(coin).usd),
    };
    const fails = [];
    if (row.okxSpotVolUsd < rules.minOkxSpotUsd) fails.push("OKX spot volume");
    if (row.okxSwapVolUsd < rules.minOkxSwapUsd) fails.push("OKX perp volume");
    if (row.orderlyVolUsd < rules.minOrderlyVolUsd) fails.push("Orderly volume");
    if (row.orderlyOiUsd < rules.minOrderlyOiUsd) fails.push("Orderly open interest");
    rows.push({ ...row, pass: fails.length === 0, fails });
  }
  // Thinnest leg decides the order: a coin is only as liquid as its weakest market.
  const weakest = (x) => Math.min(x.okxSpotVolUsd / rules.minOkxSpotUsd, x.okxSwapVolUsd / rules.minOkxSwapUsd, x.orderlyVolUsd / rules.minOrderlyVolUsd, x.orderlyOiUsd / rules.minOrderlyOiUsd);
  rows.sort((a, b) => weakest(b) - weakest(a) || a.coin.localeCompare(b.coin));
  for (const x of rows) x.weakestLegX = Math.round(weakest(x) * 100) / 100;
  const passing = rows.filter((x) => x.pass).map((x) => x.coin);
  // A holdout coin under a floor, or no longer matched on OKX, is NAMED (holdoutFailing) — the list
  // changes only by review.
  return {
    rules, rows, passing,
    newPassing: passing.filter((c) => !rec.has(c) && !hold.has(c)),
    holdoutFailing: [...hold].filter((c) => !passing.includes(c)),
    unmatched: unmatched.sort(),
  };
}
