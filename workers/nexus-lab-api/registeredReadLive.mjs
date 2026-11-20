// ── Any registered read, run by the brain for a PAPER wallet (house paper runs, step 2, borst 2026-11-17) ───────────
// One rule, two users: the brain runs the scoreboard's OWN generator for a read (explorerReads.mjs EXPLORER_GENS, the
// bodies axisbt grades), on the hourly series the brain itself records, called the way the scoreboard calls it
// (axisbt buildEvents: a coin needs an OI price spine, the generator gets (coinSet, priceByHour(oiHist), ctx) with
// BTC's candles as context). Nothing here re-derives a rule. Parity: registeredReadLive.test.mjs, read by read.
//
// Live timing, as level_reclaim / oi_div_reversal_4h: an event fires for READ_LIVE.maxAgeMs (1h) after its stamp (the
// grader enters at that hour's price), and exec takes each event once (its `t` is the signal's `sourceT`). Only rows
// the brain has by `now` count (a candle once closed, any other row once written). Inputs that stopped growing sit out
// with the reason: never a guess.
//
// PAPER ONLY, by construction: there is no live lift for this mode. Going live with a read is its own review, after
// its paper run has been judged (live-money-review.md).
//
// rsi_reset_deep (2026-11-19): its rule moved unchanged to app/lib/rsiReset.mjs; the brain runs it through
// rsiResetDeepAtStamp, which emits each event at its own row instead of one row later (the generator's loop bound),
// exactly the events the generator emits once the next row lands (rsiReset.test.mjs).
import { EXPLORER_GENS, EXPLORER_READS } from "./explorerReads.mjs";
import { rsiResetDeepAtStamp } from "../../app/lib/rsiReset.mjs";
import { hourBucket, priceByHour } from "../../app/lib/basisStack.mjs";

const H = 3600000;
export const REGISTERED_READ_MODE = "REGISTERED_READ";
export const READ_LIVE = Object.freeze({ maxAgeMs: H, staleMs: 3 * H });
/** What the brain runs for each read: the shared bodies the scoreboard grades (explorerReads.mjs), and rsi_reset_deep's. */
export const BRAIN_GENS = Object.freeze({ ...EXPLORER_GENS, rsi_reset_deep: rsiResetDeepAtStamp });
/** The reads this mode can run: every registered read. */
export const BRAIN_READS = Object.freeze(Object.keys(BRAIN_GENS));
const LABEL = { ...Object.fromEntries(EXPLORER_READS.map((r) => [r.name, r.label])), rsi_reset_deep: "RSI reset below 45 in an uptrend" };
/** The hourly series a coin set carries, as the scoreboard loads them (lab-api buildAxisScorecard) and the KV key of each. */
export const READ_SERIES = Object.freeze({
  oiHist: (c) => `oi:hist:PERP_${c}_USDC`,
  candleHist: (c) => `candle:hist:PERP_${c}_USDC`,
  cvdHist: (c) => `cvd:hist:${c}`,
  smHist: (c) => `sm:hist:${c}`,
  basisHist: (c) => `basis:hist:${c}`,
  liqHist: (c) => `liq:hist:${c}`,
  spotCvdHist: (c) => `spotcvd:hist:${c}`,
});

export const usesRegisteredRead = (config) => config?.signalMode === REGISTERED_READ_MODE;
/** null = the brain may run it for this config; else why it sits out. */
export function registeredReadRefusal(config) {
  if (!usesRegisteredRead(config)) return null;
  if (config.mode !== "PAPER") return "registered reads run on paper only: no live trading without the read's own review";
  if (config.invertSignal) return "an inverted read is a new read: register it first";
  if (!BRAIN_READS.includes(config.read)) return `${config.read ? String(config.read).slice(0, 40) : "no read"} is not a registered read the brain runs`;
  return null;
}

// axisbt candlesByHour, the same map (BTC's candles as the context btc_lead_lag reads). Pinned equal by test.
function candlesByHour(candleHist) {
  const m = new Map();
  for (const c of candleHist || []) {
    if (!c || !Number.isFinite(c.c) || !(c.c > 0)) continue;
    m.set(hourBucket(c.t), c);
  }
  return m;
}

/** A coin set as the brain has it at `now`: candles once closed (t + 1h ≤ now), any other row once written (t ≤ now). */
export function seenAt(cs, now) {
  const out = { coin: cs.coin };
  for (const k of Object.keys(READ_SERIES)) {
    const rows = Array.isArray(cs[k]) ? cs[k] : [];
    out[k] = rows.filter((r) => r && Number.isFinite(Number(r.t)) && (k === "candleHist" ? Number(r.t) + H <= now : Number(r.t) <= now));
  }
  return out;
}

/**
 * The read's live verdict per coin at `now`.
 * @param {string} read a BRAIN_READS name
 * @param {object[]} coinSets [{coin, oiHist, candleHist, cvdHist, smHist, basisHist, liqHist, spotCvdHist}] (BTC among them for its context)
 * @returns {Record<string, {side: "LONG"|"SHORT"|null, t: number|null, reason: string}>} keyed by coin
 */
export function registeredReadLive(read, coinSets, now = Date.now(), p = READ_LIVE) {
  const gen = BRAIN_GENS[read];
  if (typeof gen !== "function") throw new Error(`${read} is not a registered read the brain runs`);
  const sets = (coinSets || []).filter((cs) => cs && cs.coin).map((cs) => seenAt(cs, now));
  const btc = sets.find((cs) => String(cs.coin).toUpperCase() === "BTC");
  const ctx = btc ? { btcCandles: candlesByHour(btc.candleHist) } : {};
  const out = {};
  for (const cs of sets) {
    const pmap = priceByHour(cs.oiHist);
    // the scoreboard skips a coin with no OI price spine (buildEvents), so the brain does too
    if (pmap.size < 2) { out[cs.coin] = { side: null, t: null, reason: "no OI history recorded" }; continue; }
    const lastCandle = cs.candleHist.length ? Math.max(...cs.candleHist.map((c) => Number(c.t))) + H : -Infinity;
    const lastOi = Math.max(...cs.oiHist.map((r) => Number(r.t)));
    const newest = Math.max(lastCandle, lastOi);
    if (now - newest > p.staleMs) { out[cs.coin] = { side: null, t: null, reason: `history stale (${Math.round((now - newest) / H)}h)` }; continue; }
    const fresh = (gen(cs, pmap, ctx) || []).filter((e) => e && (e.side === "LONG" || e.side === "SHORT") && e.t <= now && now - e.t < p.maxAgeMs);
    if (!fresh.length) { out[cs.coin] = { side: null, t: null, reason: `no ${read} event this hour` }; continue; }
    const e = fresh.reduce((a, b) => (b.t >= a.t ? b : a)); // the newest
    out[cs.coin] = { side: e.side, t: e.t, reason: `${read} · ${LABEL[read] || read}` };
  }
  return out;
}
