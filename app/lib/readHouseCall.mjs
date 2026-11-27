// ── The house caller for a CLEARED registered read (borst 2026-11-27) ─────────────────────────────────────────────────
// pipeline-if-then.md: at Tradeable "the house caller may publish this read only, as its own PR on borst's go, from a new
// house wallet so its record is its own", and (signed 2026-11-17) "Only a CLEARED read may be marketed or promoted: … the
// house caller". So this caller is wired for btc_lead_lag and stays OFF by construction until the read is CLEARED: every
// run re-reads the same gate the paid feed reads (soldRead.mjs `soldReadGate` → isCleared). Not cleared = posts nothing,
// previews nothing.
//
// Its wallet is its own (worker var HOUSE_READ_CALLER_ADDRESS, 0x65eC…C0C8). The old house caller (HOUSE_CALLER_ADDRESS)
// and house-1's sealed poster (0x76A2…B17B, nexus-house-signal) are untouched. Calls are written server-side through the
// same seal as any publish (labWrite prepareSeal → commit), so no key is used or stored here.
//
// Each call is the read's own event on the graded contract the scoreboard grades it on (as the sealed poster builds
// one): entry at the Orderly mark, stop 1.2× H4 ATR, target 1.5R, time stop 168h. One call per event; one per coin +
// side per 24h (the house caller's dedupe); only events from the last hour (the read's own live window).
import { gradedExitLevels } from "./gradedExit.mjs";
import { R_CONTRACT } from "./rContract.mjs";

export const READ_HOUSE_READS = Object.freeze({ btc_lead_lag: "BTC impulse, lagging alt follows" });
export const READ_HOUSE_COOLDOWN_MS = 24 * 3600 * 1000;
export const READ_HOUSE_MAX_AGE_MS = 3600 * 1000;
export const READ_HOUSE_MAX_PER_RUN = 3;

const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;
export const readHouseCallId = (axis, coin, side, eventT) => `houseread-${axis}-${coin}-${side}-${eventT}`;

/**
 * The events to post this run, from the read's live rows (soldRows' shape) and the wallet's existing calls.
 * @returns {{ coin, side, eventT }[]}
 */
export function readHouseDue({ axis, rows = [], existing = [], now, max = READ_HOUSE_MAX_PER_RUN }) {
  const out = [];
  for (const r of rows) {
    if (out.length >= max) break;
    if (r?.side !== "LONG" && r?.side !== "SHORT") continue;
    const eventT = Date.parse(r.event_at);
    if (!Number.isFinite(eventT) || eventT > now || now - eventT >= READ_HOUSE_MAX_AGE_MS) continue;
    const id = readHouseCallId(axis, r.symbol, r.side, eventT);
    const dup = existing.some((t) => t?.id === id
      || (t?.symbol === r.symbol && t?.direction === r.side && now - (Number(t.createdAt) || 0) < READ_HOUSE_COOLDOWN_MS));
    if (dup) continue;
    out.push({ coin: r.symbol, side: r.side, eventT });
  }
  return out;
}

/** The call for one event. Null when the mark or the ATR is unusable (retried next run inside the hour). */
export function readHouseCall({ axis, coin, side, eventT, markPx, atrFrac, now }) {
  const label = READ_HOUSE_READS[axis];
  const lv = gradedExitLevels(atrFrac);
  if (!label || !lv || !(markPx > 0) || !Number.isFinite(markPx)) return null;
  const long = side === "LONG";
  const dp = markPx >= 1000 ? 1 : markPx >= 1 ? 3 : markPx >= 0.01 ? 5 : 8;
  const entry = round(markPx, dp);
  const stopLoss = round(long ? entry * (1 - lv.slPercent / 100) : entry * (1 + lv.slPercent / 100), dp);
  const takeProfit1 = round(long ? entry * (1 + lv.tpPercent / 100) : entry * (1 - lv.tpPercent / 100), dp);
  if (stopLoss === entry || takeProfit1 === entry) return null;
  return {
    id: readHouseCallId(axis, coin, side, eventT),
    symbol: coin,
    direction: side,
    entryPrice: entry,
    stopLoss,
    takeProfit1,
    takeProfit2: 0,
    riskReward: R_CONTRACT.rMultiple,
    timeStopH: R_CONTRACT.maxHoldH,
    riskPercent: 0, accountSize: 0, fundingRate: 0, positionSize: 0, leverage: 0,
    fundingCost8h: 0, fundingCost24h: 0, fundingCost72h: 0,
    createdAt: now,
    status: "ACTIVE",
    actualPnl: null,
    isPublic: true,
    source: "house-read",
    houseRead: axis,
    catalyst: `${label} (${axis})`,
    notes: `House call for the registered read ${axis}, which cleared on /proof. `
      + "Entry at the mark, stop 1.2x H4 ATR, target 1.5R, 168h. Graded from public price. Not advice.",
  };
}
