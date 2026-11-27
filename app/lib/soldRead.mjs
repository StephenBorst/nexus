// ── A registered read sold through the paid x402 feed: refused until it is CLEARED (borst 2026-11-27) ─────────────────
// pipeline-if-then.md § "Board layout and the CLEARED badge" (signed 2026-11-17): "Only a CLEARED read may be marketed or
// promoted: the headline, the landing, share cards, posts, the paid feed and the house caller." So a read's live signals
// are served to the paid feed (bankr-x402/nexus-signals.ts, via GET /signals/read/:axis) only while `isCleared` is true
// for it, read live on every request: served Tradeable/Paper, not failing, no promotion lock, and a RECORDED 30-trade
// paper PASS that beat random entries (badge bar v2). Anything unread = refused. Until then the feed keeps today's
// funding-fade read and its NOISE label.
//
// Pure: the worker hands in the stored scoreboard, the recorded judgment (pjudge:{axis}) and the promotion locks.
import { isCleared } from "./signalCard.mjs";
import { LEVEL_RECLAIM_MAIN_SYMBOLS } from "./levelReclaim.mjs";

/** The reads the paid feed may carry once cleared. A new one is its own PR. */
export const SOLD_READS = Object.freeze(["btc_lead_lag"]);
/** The coins it sells: the main card only (the holdout is graded on its own line, never sold). */
export const SOLD_COINS = Object.freeze(LEVEL_RECLAIM_MAIN_SYMBOLS.map((s) => s.replace(/^PERP_/, "").replace(/_USDC$/, "")));

/** The recorded verdict in the shape isCleared reads (unread or not final = null). */
export function judgmentFromRecord(rec) {
  return rec && rec.verdict ? { recorded: true, verdict: rec.verdict, randomCheck: rec.randomCheck || null, wallet: rec.wallet || null } : null;
}

/**
 * May the paid feed carry this read right now?
 * @returns {{ ok: true, reg } | { ok: false, status, error, stage?, line }}
 */
export function soldReadGate({ axis, scoreboard, judgment = null, locks = {} }) {
  if (!SOLD_READS.includes(axis)) return { ok: false, status: 404, error: "not_sold", line: "This read isn't sold." };
  const reads = scoreboard?.pipeline?.reads;
  if (!Array.isArray(reads)) return { ok: false, status: 503, error: "board_unread", line: "The scoreboard couldn't be read, so nothing is sold." };
  const reg = reads.find((r) => r?.axis === axis);
  if (!reg) return { ok: false, status: 503, error: "board_unread", line: "The scoreboard has no row for this read, so nothing is sold." };
  if (!isCleared(reg, judgment, locks)) {
    return { ok: false, status: 403, error: "not_cleared", stage: reg.stage ?? null,
      line: `${axis} has not cleared (stage ${reg.stage ?? "unread"}): only a CLEARED read is sold.` };
  }
  return { ok: true, reg };
}

/** The live grade every sold response carries, from the scoreboard's own row. */
export function soldGrade(axis, reg, judgment, asOf) {
  const n = reg?.numbers || {};
  return {
    axis, stage: reg?.stage ?? null, cleared: true,
    events: n.events ?? null, meanR: n.meanR ?? null, beatsRandomPct: n.beatsRandomPct ?? null,
    holdoutEvents: n.holdoutEvents ?? null, holdoutMeanR: n.holdoutMeanR ?? null, holdoutBeatsRandomPct: n.holdoutBeatsRandomPct ?? null,
    paper: judgment ? { verdict: judgment.verdict, beatRandomPct: judgment.randomCheck?.pctBeaten ?? null } : null,
    asOf: asOf ?? null,
    proof: `https://trade.nexustradinglabs.com/proof/paper/${axis}`,
  };
}

/** One row per sold coin from the brain's live read (registeredReadLive's answer), in SOLD_COINS order. */
export function soldRows(byCoin, unread = []) {
  const gone = new Set(unread);
  return SOLD_COINS.map((coin) => {
    if (gone.has(coin)) return { symbol: coin, side: null, event_at: null, reason: "history read failed" };
    const v = byCoin?.[coin];
    if (!v) return { symbol: coin, side: null, event_at: null, reason: "not computed" };
    return { symbol: coin, side: v.side === "LONG" || v.side === "SHORT" ? v.side : null,
      event_at: Number.isFinite(v.t) ? new Date(v.t).toISOString() : null, reason: v.reason ?? null };
  });
}
