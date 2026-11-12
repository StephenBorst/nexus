// ── Fixed-risk sizing (`config.riskPerTradeUsd`) ──────────────────────────────────────────────────
// Build #1 of docs/research/live-plan-level-reclaim.md (borst's go 2026-11-07: "sizing first"). PAPER ONLY.
//
// Why. The agent sizes by margin (notional = capitalPerTrade × leverage). The graded exit's stop is 1.2× the
// coin's H4 ATR, measured from 1.1% (BTC) to 6.6% (WLD) at level_reclaim's events, so a fixed size bets about
// 6× more dollars on a WLD stop than on a BTC one. The scoreboard weighs every trade as 1R. Fixed-risk sizing
// makes the dollars match the grade: notional = riskPerTradeUsd ÷ the trade's own stop %, so a stop-out
// loses riskPerTradeUsd (before fees and slippage) and P&L ÷ riskPerTradeUsd = the graded R.
//
// One rule, every surface: exec (enterPosition), the backtest replays (per-trade notional in `aggregate` and
// the portfolio replay's daily P&L) and lab-api's config check all import this file. Parity is untouched: it
// pairs entries with events, and sizing never changes WHETHER or WHEN an entry happens.
//
// Rules:
//   - only with the graded exit (`exitContract: "R_CONTRACT"`): the stop must be known before the entry,
//     from the same H4 ATR the scoreboard grades with;
//   - PAPER only (lifting it is build #3 of the live plan, its own reviewed PR);
//   - not with vol-targeted capital (`volTargetPct`) or DCA: two sizing rules for one trade;
//   - `capitalPerTrade` stays the MARGIN CEILING: a very tight stop would otherwise ask for a huge notional.
//     A capped trade risks less than riskPerTradeUsd; exec records the risk it actually took (`risk_usd`).
import { usesGradedExit } from "./gradedExit.mjs";

export const RISK_PER_TRADE_MAX_USD = 1000;

const num = (x) => (x === undefined || x === null || x === "" ? null : Number(x));

/** True when the config asks for fixed-risk sizing (a positive number). */
export const usesRiskSizing = (config) => num(config?.riskPerTradeUsd) > 0;

/**
 * Why this config can't size by fixed risk, or null when it can (or doesn't ask to). `paper` = will the
 * entry be simulated. One answer for exec (before any order) and lab-api (before storing a config).
 */
export function riskSizingRefusal(config, paper, { liveLift = false } = {}) {
  const v = num(config?.riskPerTradeUsd);
  if (v === null || v === 0) return null;
  if (!Number.isFinite(v) || v < 0) return "riskPerTradeUsd must be a positive number of dollars";
  if (v > RISK_PER_TRADE_MAX_USD) return `riskPerTradeUsd is capped at $${RISK_PER_TRADE_MAX_USD} a trade`;
  // `liveLift` = app/lib/liveLift.mjs liveLifted() (build #3, disarmed): the one wallet the plan lifts.
  if (!paper && liveLift !== true) return "fixed-risk sizing is paper-only: no live trading without its own review";
  if (!usesGradedExit(config)) return "fixed-risk sizing needs the graded exit, so the stop is known before the entry";
  if (num(config.volTargetPct) > 0) return "fixed-risk sizing and vol-targeted capital size the trade two different ways";
  if (config.dcaEnabled) return "fixed-risk sizing sizes one entry; DCA adds more";
  return null;
}

/**
 * The margin for one trade at its own stop. `slPercent` = the stop distance in % (e.g. 2.21).
 * Returns { margin, notional, capped } or null when the inputs can't size a trade (no stop, no leverage).
 * `maxMargin` (capitalPerTrade) caps the margin; `capped` says it bound.
 */
export function riskSizedMargin({ riskPerTradeUsd, slPercent, leverage, maxMargin }) {
  const risk = num(riskPerTradeUsd), sl = num(slPercent), lev = num(leverage), cap = num(maxMargin);
  if (!(risk > 0) || !(sl > 0) || !(lev > 0)) return null;
  let notional = risk / (sl / 100);
  let margin = notional / lev;
  let capped = false;
  if (cap > 0 && margin > cap) { margin = cap; notional = cap * lev; capped = true; }
  const r2 = (x) => Math.round(x * 100) / 100;
  return { margin: r2(margin), notional: r2(notional), capped };
}

/**
 * The notional a replay books for one trade: fixed-risk at the trade's own stop when the config asks for it
 * (and can), else the flat capitalPerTrade × leverage. Default capital 50 / leverage 1 as the replays use.
 */
export function tradeNotional(config, slPercent) {
  const flat = (config?.capitalPerTrade || 50) * (config?.leverage || 1);
  if (!usesRiskSizing(config) || riskSizingRefusal(config, true)) return flat;
  const s = riskSizedMargin({ riskPerTradeUsd: config.riskPerTradeUsd, slPercent, leverage: config.leverage || 1, maxMargin: config.capitalPerTrade || 50 });
  return s ? s.notional : flat;
}

/** The dollars a filled position actually risks to its stop (qty × entry × stop %). */
export function riskTaken(qty, entryPrice, slPercent) {
  const v = Number(qty) * Number(entryPrice) * (Number(slPercent) / 100);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}
