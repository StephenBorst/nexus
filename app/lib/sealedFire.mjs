// A sealed read's fire → one public call (docs/research/sealed-reads.md §2, signed 2026-11-20). The private worker only
// says, signed by the read's own wallet: "<read> fired <coin> <side> at <hour>". Everything a call is graded on is built
// HERE, in public, from the frozen contract: entry = the Orderly mark when posted, stop = 1.2× H4 ATR-14, target = 1.5R,
// time stop 168h. Pure.
import { gradedExitLevels } from "./gradedExit.mjs";
import { R_CONTRACT } from "./rContract.mjs";
import { sealedCountsFrom } from "./sealedReads.mjs";

export const FIRE_WINDOW_MS = 5 * 60 * 1000;   // page §2.1: not posted within 5 minutes = not counted
export const FIRE_SKEW_MS = 60 * 1000;          // a fire stamped up to a minute in the future (clocks) is accepted
export const COOLDOWN_MS = 24 * 3600 * 1000;    // one call per coin per side per 24h (the rule's own limit, held here too)
const HOUR = 3600e3;
const SIDES = ["LONG", "SHORT"];

/** The exact text the read's wallet signs for one fire. ASCII; one fire, one call. */
export function sealedFireMessage(name, coin, side, fireAt) {
  return "Nexus sealed read: fire\n"
    + `Read: ${name}\nCoin: ${coin}\nSide: ${side}\nFired at: ${new Date(fireAt).toISOString()}\n`
    + "Posts one public call, graded from public price. No funds move. No trades.";
}

/**
 * Is this fire acceptable now? Returns null when it is, else { code, status, hint }.
 * `log` = the read's stored fires [{coin, side, fireAt, status}] (for the cooldown + duplicates).
 */
export function fireRefusal({ read, coin, side, fireAt, now, log = [], dryRun = false }) {
  if (!read) return { code: "unknown_read", status: 404, hint: "No sealed read by that name." };
  if (typeof coin !== "string" || !/^[A-Z0-9]{2,12}$/.test(coin)) return { code: "bad_coin", status: 400, hint: "coin = a bare ticker, e.g. ETH." };
  if (!SIDES.includes(side)) return { code: "bad_side", status: 400, hint: "side = LONG or SHORT." };
  if (!Number.isSafeInteger(fireAt) || fireAt % HOUR !== 0) return { code: "bad_time", status: 400, hint: "fireAt = the firing bar's close, on the hour, in ms." };
  if (fireAt - now > FIRE_SKEW_MS) return { code: "future", status: 400, hint: "fireAt is in the future." };
  const starts = sealedCountsFrom(read);
  if (!dryRun && (!starts || fireAt < Date.parse(starts))) return { code: "not_started", status: 409, hint: starts ? `Counts from ${starts}.` : "Not started: the X post is not recorded yet." };
  if (log.some((e) => e.coin === coin && e.side === side && e.fireAt === fireAt)) return { code: "duplicate", status: 409, hint: "This fire is already on record." };
  if (now - fireAt > FIRE_WINDOW_MS) return { code: "late", status: 409, hint: "Received more than 5 minutes after the fire: recorded as a miss, no call." };
  const last = log.filter((e) => e.coin === coin && e.side === side && e.status === "POSTED").reduce((m, e) => Math.max(m, e.fireAt), -Infinity);
  if (fireAt - last < COOLDOWN_MS) return { code: "cooldown", status: 409, hint: "One call per coin per side per 24 hours." };
  return null;
}

const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;

/**
 * The call, from the mark and the coin's H4 ATR fraction. Null when either is unusable (the fire stays retryable
 * inside its window). Every field the Lab's call card reads is set, as for any systematic call.
 */
export function sealedCall({ read, coin, side, fireAt, markPx, atrFrac, now }) {
  const lv = gradedExitLevels(atrFrac);
  if (!lv || !(markPx > 0) || !Number.isFinite(markPx)) return null;
  const long = side === "LONG";
  const dp = markPx >= 1000 ? 1 : markPx >= 1 ? 3 : markPx >= 0.01 ? 5 : 8;
  const entry = round(markPx, dp);
  const stopLoss = round(long ? entry * (1 - lv.slPercent / 100) : entry * (1 + lv.slPercent / 100), dp);
  const takeProfit1 = round(long ? entry * (1 + lv.tpPercent / 100) : entry * (1 - lv.tpPercent / 100), dp);
  if (stopLoss === entry || takeProfit1 === entry) return null;
  return {
    id: `sealed-${read.name}-${coin}-${side}-${fireAt}`,
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
    source: "sealed-read",
    sealedRead: read.name,
    catalyst: `${read.label} (sealed)`,
    notes: `${read.label}, sealed read ${read.name}. Rule fingerprint ${read.fingerprint.slice(0, 12)}…, revealed when it clears. `
      + "Entry at the mark, stop 1.2x H4 ATR, target 1.5R, 168h. Graded from public price. Not advice.",
  };
}
