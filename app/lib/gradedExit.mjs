// ── The GRADED EXIT — the R contract, traded by the agent (paper only) ──────────────────────────
// The scoreboard grades every read with one frozen exit (app/lib/rContract.mjs): stop = 1.2× the
// coin's H4 ATR-14, target = 1.5× the stop, 168h hold. On Oct 15 Basis × CVD graded +0.19R on that
// exit (n62, beats 97.3% of random entries) while the preset's flat TP 2.5 / SL 2 / 12h exit lost out
// of sample. This module lets the agent trade THAT exit, so the read and the trade are one thing.
//
// One rule, every surface: exec (paper entries), the backtest replay, the scoreboard's "as traded"
// line (axisbt) and lab-api's config writes all import from here, so they can't size the stop
// differently. The ruler is the SAME h4Atr14Frac the R grade uses; the multiples are R_CONTRACT's.
//
// ⚠️ PAPER ONLY (borst, 2026-10-15). There is no 3% stop cap on this path (volScaledStops keeps its
// own). A volatile coin's graded stop can be 4–6%, and that never reaches live money without its
// own review: `gradedExitRefusal` refuses every non-PAPER config, exec checks it before any order,
// lab-api refuses to store it. Turning it on for live = editing this rule in a reviewed PR.
//
// The exit is the WHOLE contract. Anything that would make the agent trade a different exit than
// the one graded (a scale-out ladder, a trailing stop, breakeven, DCA, vol-scaled stops, a hold
// other than 168h) is refused, not merged: the leftover-`takeProfits` incident (Sept 25) is exactly
// a config trading something other than its grade.
import { R_CONTRACT } from "./rContract.mjs";
import { h4Atr14Frac } from "./atr.mjs";

export const GRADED_EXIT = "R_CONTRACT";
// Hours of 1H candles read to build the H4 ATR-14 (15 four-hour bars need ≥60h; the grader's
// atrPctH4At reads the same 80).
export const GRADED_EXIT_LOOKBACK_H = 80;
// A data-sanity bound, not a cap: a 1.2× H4 ATR stop past 20% means the candles are wrong, so the
// agent sits out rather than trade it. Real stops on the 12 recorded markets sit far below this.
export const GRADED_EXIT_MAX_STOP_PCT = 20;
// Pre-registered out-of-sample start for the scoreboard's "as traded" line
// (docs/research/graded-exit-prereg.md). Trades entered after this instant were not seen when the
// variant was chosen (Oct 15). Pinned to the doc by gradedExit.test.mjs.
export const GRADED_EXIT_OOS_CUTOFF_MS = Date.parse("2026-10-16T00:00:00Z");

export const usesGradedExit = (config) => config?.exitContract === GRADED_EXIT;

/** Stop/target % for an H4 ATR-14 fraction, or null (no ATR / not sane). */
export function gradedExitLevels(atrFrac) {
  if (!Number.isFinite(atrFrac) || !(atrFrac > 0)) return null;
  const sl = atrFrac * R_CONTRACT.atrMult * 100;
  if (!(sl <= GRADED_EXIT_MAX_STOP_PCT)) return null;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return { slPercent: r3(sl), tpPercent: r3(sl * R_CONTRACT.rMultiple) };
}

/** Same, from hourly candles [{t (seconds), h, l, c}] — the last GRADED_EXIT_LOOKBACK_H of them. */
export function gradedExitLevelsFromHourly(hourly) {
  if (!Array.isArray(hourly)) return null;
  return gradedExitLevels(h4Atr14Frac(hourly.slice(-(GRADED_EXIT_LOOKBACK_H + 1))));
}

/**
 * Why this config can't trade the graded exit, or null when it can (or doesn't ask to).
 * `paper` = will the entry be simulated. One answer for exec (before any order) and lab-api
 * (before storing a config).
 */
export function gradedExitRefusal(config, paper) {
  if (!usesGradedExit(config)) return null;
  if (!paper) return "the graded exit is paper-only: no live trading without its own review";
  if (Number(config.maxHoldHours) !== R_CONTRACT.maxHoldH) return `the graded exit holds up to ${R_CONTRACT.maxHoldH}h; this config says ${config.maxHoldHours}h`;
  if (Array.isArray(config.takeProfits) && config.takeProfits.length) return "a take-profit ladder would replace the graded target";
  if (Number(config.trailingStopPct) > 0) return "a trailing stop is not part of the graded exit";
  if (Number(config.breakevenTriggerPct) > 0) return "a breakeven stop is not part of the graded exit";
  if (config.dcaEnabled) return "DCA is not part of the graded exit";
  if (config.volScaledStops) return "vol-scaled stops and the graded exit size the stop two different ways";
  return null;
}
