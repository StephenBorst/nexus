// Who's on this coin, in the coin panel (borst 2026-11-20: bring the Spot page's "N positioned / open calls / recent
// takes" density into the drawer and the desktop dock). Two public reads, shown apart:
//   - CALLERS: GET /theses/symbol/:coin, the same route as the Spot page's "Callers on X" strip: wallets with an open
//     position or an active public call on the coin, each with its GRADED record (graded from public price).
//   - TAKES: GET /takes/hot, recent takes across tokens, kept when their symbol names the coin. Takes are UNGRADED
//     discussion, firewalled from grading, and labelled so.
// A plain count, no lean or side split (the Spot strip's rule since 2026-10-12: no crowd side until the verified board
// has a net-positive caller). Pure, tested (coinCrowd.test.mjs).
import { callerRecordLine } from "./spotDiscovery.mjs";

export const CROWD_TAKES_WINDOW_MS = 7 * 24 * 3600_000;
export const CROWD_ROWS = 5;

const bare = (s) => String(s || "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "").replace(/^\$/, "");

/** Takes that name this coin (their `sym`), newest first, inside the window. */
export function takesForCoin(takes, coin, now = Date.now()) {
  const c = bare(coin);
  return (takes || [])
    .filter((t) => t && bare(t.sym) === c && Number.isFinite(Number(t.createdAt)) && now - Number(t.createdAt) <= CROWD_TAKES_WINDOW_MS)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * The header counts, in words. callers = the /theses/symbol reply (null = unread); takes = the coin's takes (null = unread).
 * @returns {string} e.g. "3 positioned · 2 open calls · 1 take this week"
 */
export function crowdLine(callers, takes) {
  const parts = [];
  if (callers == null) parts.push("callers unread");
  else {
    const n = Number(callers.participants) || 0;
    parts.push(`${n} positioned`);
    const calls = Number(callers.callCount);
    if (Number.isFinite(calls)) parts.push(`${calls} open ${calls === 1 ? "call" : "calls"}`);
  }
  if (takes == null) parts.push("takes unread");
  else parts.push(`${takes.length} ${takes.length === 1 ? "take" : "takes"} this week`);
  return parts.join(" · ");
}

/** One caller row: name, merit glyph, graded record (or "ungraded"), the side as a label. */
export function callerRow(c) {
  const who = c?.displayName || `${String(c?.wallet || "").slice(0, 6)}…${String(c?.wallet || "").slice(-4)}`;
  return {
    wallet: String(c?.wallet || "").toLowerCase(), who, glyph: c?.meritRank?.glyph || null, title: c?.meritRank?.title || null,
    record: callerRecordLine(c?.record ?? null), side: c?.direction === "SHORT" ? "SHORT" : "LONG",
  };
}
