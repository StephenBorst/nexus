// The Feed, "your coins first" (2026-11-14, borst): each call shows its caller's graded record from the feed itself,
// losses included (the Ranks board lists only callers who qualify, so leaning on it would show only winners), and a
// "Your coins" view filters the feed to the coins this device watches (app/lib/watchlist.mjs). Pure, tested.
import { marketCoin } from "./marketRead.mjs";

const graded = (t) => (t?.gradedOutcome === "WIN" || t?.gradedOutcome === "LOSS") && Number.isFinite(Number(t?.gradedR));

/** wallet (lowercase) → { graded, wins, netR } over every graded call of that wallet in the feed (no copies). */
export function feedRecords(feed) {
  const m = new Map();
  for (const t of feed || []) {
    if (!t || !t.wallet || t.duplicateOf || t.resolution || !graded(t)) continue;
    const k = String(t.wallet).toLowerCase();
    const r = m.get(k) ?? { graded: 0, wins: 0, netR: 0 };
    r.graded++;
    if (t.gradedOutcome === "WIN") r.wins++;
    r.netR = Math.round((r.netR + Number(t.gradedR)) * 100) / 100;
    m.set(k, r);
  }
  return m;
}

/** "7 graded · 4 won · +2.10R net" — or "no graded calls yet". */
export function recordLine(rec) {
  if (!rec || !rec.graded) return "no graded calls yet";
  const r = rec.netR;
  return `${rec.graded} graded · ${rec.wins} won · ${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R net`;
}

/** The feed narrowed to the watched coins. */
export function watchedFeed(feed, coins) {
  const set = new Set((coins || []).map((c) => marketCoin(c)).filter(Boolean));
  if (!set.size) return [];
  return (feed || []).filter((t) => set.has(marketCoin(t?.symbol)));
}
