// TREND GATE · a registered conditioner study (docs/research/trend-gate-prereg.md, signed by borst 2026-11-16; counts from
// 2026-11-17T00:00Z). It labels events; it fires nothing, gates nothing and no worker that trades imports it (test-pinned). borst 2026-11-16: "macro grants permission,
// micro times the trigger" — before the BTC 4h trend gets any power over entries, it is graded like the stress study.
//
// The label: BTC's 4h trend as the event could see it. The last COMPLETE UTC 4h BTC bar closed at or before the
// event's decision close, its close vs the EMA-20 of complete 4h closes (trend4hByHour, the same rule the scanner reads
// use). WITH = a LONG while BTC trends UP or a SHORT while it trends DOWN; AGAINST = the other way; UNLABELLED = no
// trend yet (fewer than 20 complete 4h bars) or an exact tie, never counted as either.
import { hourMap, trend4hByHour } from "./explorerReads.mjs";

const H = 3600000;

/** The signed study's numbers (pinned to the page by trendGate.test.mjs). The judge, its own PR, reads these. */
export const TREND_GATE_STUDY = Object.freeze({
  from: "2026-11-17T00:00:00Z",
  limit: "2027-05-17T00:00:00Z",
  reads: Object.freeze([
    "rsi_reset_deep", "level_reclaim", "oi_div_reversal", "session_momentum", "confluence_follow", "oi_div_reversal_4h",
    "oi_coil_break", "session_fade", "level_reclaim_tight", "spot_absorb", "btc_lead_lag", "funding_basis_split",
    "smart_consensus_2x",
  ]),
  excluded: Object.freeze(["bb_rsi_momentum", "shelf_breakdown_short", "session_fade_short", "oi_div_reversal_4h_long"]),
  minEach: 30, minSmallAtLimit: 20, shifts: 1000, minShiftDays: 7, alpha: 0.05,
});

/** hour → "UP" | "DOWN" | null from BTC's recorded hourly tape (candle:hist, t in ms). */
export function btcTrendByHour(btcCandles) {
  return trend4hByHour(hourMap(btcCandles || []));
}

/**
 * An event's label. Events are stamped at their decision close (t, ms): the trend that close could see is the one at
 * the hour that closed at or before t (hour index floor(t/H) − 1). Nothing after t is read.
 * @returns {"WITH"|"AGAINST"|"UNLABELLED"}
 */
export function trendLabel(event, trendByHour) {
  const tr = trendByHour?.get(Math.floor(Number(event?.t) / H) - 1) ?? null;
  if (!tr) return "UNLABELLED";
  const side = String(event?.side || "").toUpperCase();
  if (side !== "LONG" && side !== "SHORT") return "UNLABELLED";
  return (side === "LONG") === (tr === "UP") ? "WITH" : "AGAINST";
}

/** Counts per label for a list of events. */
export function labelCounts(events, trendByHour) {
  const out = { events: 0, WITH: 0, AGAINST: 0, UNLABELLED: 0 };
  for (const e of events || []) { out.events++; out[trendLabel(e, trendByHour)]++; }
  return out;
}
