// Copy Trades, grouped by the caller you copied (2026-11-14, borst: "Copy Trades tab"). For each leader: their whole
// graded record from the public feed (feedRecord.mjs, losses included, copies out), whether they're on the ranked board
// (≥5 graded, net-positive R: /theses/leaderboard's own bar) or why not, and how YOUR copies of them stand. Never a
// "copy this" nudge: the record says it. Pure, tested.

export const RANK_MIN_GRADED = 5;

const statusOf = (t) => {
  if (t?.gradedOutcome === "WIN" || t?.status === "HIT_TP") return "WON";
  if (t?.gradedOutcome === "LOSS" || t?.status === "STOPPED_OUT") return "STOPPED";
  if (t?.status === "INVALIDATED") return "INVALID";
  return "OPEN";
};

/**
 * @param {object[]} copies  the trader's copied calls (copiedFromWallet set)
 * @param {Map<string,{graded,wins,netR}>} records  feedRecords(feed)
 * @param {Set<string>} ranked  lowercase wallets on /theses/leaderboard
 * @param {Map<string,string>} names  lowercase wallet → display name from the feed
 */
export function copyLeaders(copies, records, ranked = new Set(), names = new Map()) {
  const by = new Map();
  for (const t of copies || []) {
    const w = String(t?.copiedFromWallet || "").toLowerCase();
    if (!w) continue;
    const g = by.get(w) ?? { wallet: w, copies: [], mine: { open: 0, won: 0, stopped: 0, invalid: 0 } };
    g.copies.push(t);
    const s = statusOf(t);
    if (s === "OPEN") g.mine.open++; else if (s === "WON") g.mine.won++; else if (s === "STOPPED") g.mine.stopped++; else g.mine.invalid++;
    by.set(w, g);
  }
  const out = [];
  for (const g of by.values()) {
    const rec = records?.get?.(g.wallet) ?? { graded: 0, wins: 0, netR: 0 };
    const isRanked = ranked.has(g.wallet);
    const why = isRanked ? null
      : rec.graded < RANK_MIN_GRADED ? `Not ranked: ${rec.graded} of ${RANK_MIN_GRADED} graded calls so far.`
      : rec.netR <= 0 ? "Not ranked: net R is not positive."
      : "Not on the ranked board right now.";
    out.push({ ...g, name: names.get(g.wallet) ?? null, record: rec, ranked: isRanked, why });
  }
  return out.sort((a, b) => b.copies.length - a.copies.length || b.record.graded - a.record.graded);
}

/** "Your copies: 3 · 1 open · 1 won · 1 stopped" */
export function mineLine(m, n) {
  const parts = [`Your copies: ${n}`];
  if (m.open) parts.push(`${m.open} open`);
  if (m.won) parts.push(`${m.won} won`);
  if (m.stopped) parts.push(`${m.stopped} stopped`);
  if (m.invalid) parts.push(`${m.invalid} invalid`);
  return parts.join(" · ");
}
