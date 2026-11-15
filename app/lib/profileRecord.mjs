// What a trader profile (/trader/:wallet) counts and shows (pure rules, tested).
//
// The profile read the whole /feed and kept the rows for this wallet. /feed also carries the
// wallet's AGENT trades (agent:feed:{addr}, tagged agent:true, displayName "Nexus Agent") and
// resolution rows. The agent rows were counted as the trader's calls, and since the profile
// takes its name from the first row that has one, a wallet whose agent traded could be shown
// as "Nexus Agent". The win-rate tiles were computed from those rows while the share card and
// the rank read the grader's own record (/theses/process), so the two could disagree.

/** This wallet's own published calls from a /feed reply: no agent trades, no resolution rows. */
export function profileCalls(feed, wallet) {
  const w = String(wallet || "").toLowerCase();
  if (!w) return [];
  return (feed || []).filter((t) => t && !t.resolution && !t.agent && String(t.wallet || "").toLowerCase() === w);
}

/**
 * The record tiles. The grader's record (normRecord of /theses/process) when it answered, so
 * the tiles, the share card and the rank read one record; else the calls on screen, labelled.
 * local = { wins, losses, avgR } from the calls' own gradedOutcome / gradedR.
 */
export function recordTiles(graded, local) {
  if (graded && graded.calls > 0 && graded.hitRate != null && graded.avgR != null) {
    return { source: "grader", calls: graded.calls, winRate: graded.hitRate, avgR: graded.avgR,
      sub: `${graded.calls} graded call${graded.calls === 1 ? "" : "s"}` };
  }
  const closed = (local?.wins || 0) + (local?.losses || 0);
  if (graded && graded.calls === 0 && closed === 0) {
    return { source: "grader", calls: 0, winRate: null, avgR: null, sub: "no graded calls yet" };
  }
  if (!closed) return { source: "calls", calls: 0, winRate: null, avgR: null, sub: "no graded calls yet" };
  return {
    source: "calls", calls: closed, winRate: (local.wins / closed) * 100,
    avgR: Number.isFinite(local.avgR) ? local.avgR : null,
    sub: `${local.wins}W / ${local.losses}L on the calls shown`,
  };
}

/** "+$12.50" / "−$3.20": the sign before the dollar, never "$-3.2". */
export function signedUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;
}
