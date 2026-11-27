// ── btc_lead_lag's own paper wallet: the preset and the hidden setup link (borst 2026-11-27, option (a)) ──────────────
// btc_lead_lag was served TRADEABLE on 2026-11-26 (#445). Its keyless house run (housePaper.mjs, 0x9737…17a5) has
// traded it since 2026-11-20 on the house config; the read's own wallet runs THAT config exactly, field for field
// (btcLeadLagPaper.test.mjs pins it equal to housePaperConfig("btc_lead_lag")), so the two records trade one rule.
// The brain already trades it: signalMode REGISTERED_READ + read (registeredReadLive.mjs, PAPER only, no live lift).
//
// Loaded only through the hidden link /lab?tab=agent&deploy=btc-lead-lag-paper on a FRESH wallet (a zero-start
// record), then registered on /ops (paperClaim.mjs). Once registered, that wallet is the run /proof shows and the one
// judged at 30 trades (paperJudge.mjs `judgmentsFor`); the house run keeps running as data, unjudged.
import { LEVEL_RECLAIM_MAIN_SYMBOLS } from "./levelReclaim.mjs";

export const BTC_LEAD_LAG_DEPLOY = "btc-lead-lag-paper";
export const BTC_LEAD_LAG_PAPER_CONFIG = Object.freeze({
  mode: "PAPER",
  signalMode: "REGISTERED_READ",
  read: "btc_lead_lag",
  exitContract: "R_CONTRACT",
  maxHoldHours: 168,
  symbols: [...LEVEL_RECLAIM_MAIN_SYMBOLS],
  leverage: 3,
  capitalPerTrade: 50,
  maxTradesPerDay: 24,
  maxDailyLossUsdc: 1000,
  takeProfits: [],
  trailingStopPct: 0,
  breakevenTriggerPct: 0,
  dcaEnabled: false,
  volScaledStops: false,
  invertSignal: false,
  respectRegime: false,
  respectSmartMoney: false,
  maxSignalAgeSec: 0,
});
