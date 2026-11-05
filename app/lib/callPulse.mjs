// The Lab pulse: how many public calls are live right now and how many the grader scored this week.
// One rule for the server (`GET /calls/pulse`, lab-api routes-pulse.mjs) and the line the app's chip
// prints (LabPulseChip.tsx). The landing page mirrors `pulseLine` by hand (nexus-landing index.html).
// Display only: nothing here grades a call or changes a stamp.
//
// What counts (borst, 2026-11-05: "human calls only"):
//   - a PUBLIC call: isPublic, not holders-only, not a marked copy (`duplicateOf`), same as isPublicCall;
//   - from a person: the house caller's wallet is left out (passed in as `exclude`), and agent trades
//     never get here (they live in agent:feed:, not lab:);
//   - OPEN = the entry traded and the call isn't graded (callLifecycle "OPEN"). A resting order that never
//     filled isn't a position, so it isn't counted: it could sit unfilled forever and pad the number.
//   - GRADED THIS WEEK = a current grader stamp (WIN or LOSS) whose resolution (`exitedAt`, else
//     `gradedAt`) falls in the last 7 days.
// `last` = the most recent graded call of all time, so a quiet week still reads true ("last graded 4d ago").

import { callLifecycle } from "./callLifecycle.mjs";

export const PULSE_WINDOW_MS = 7 * 86400000;

const bare = (s) => {
  const m = /^PERP_([^_]+)_USDC(?:_.*)?$/.exec(String(s || ""));
  return (m ? m[1] : String(s || "").replace("PERP_", "").replace("_USDC", "")).toUpperCase();
};
const isPublic = (t) => !!t && t.isPublic === true && !t.holdersOnly && !t.duplicateOf;
const isGraded = (t) => t?.gradedOutcome === "WIN" || t?.gradedOutcome === "LOSS";

/**
 * @param {Array<{wallet:string, theses:object[]}>} records one entry per lab:{wallet}
 * @param {number} now ms
 * @param {{ exclude?: string[], isCurrent?: (t:object)=>boolean }} [opts]
 *   exclude   wallets left out (the house caller), any case
 *   isCurrent the grader's "stamp is current" check (grading.mjs isCurrentStamp); a stale stamp counts nowhere
 * @returns {{ open:number, gradedWeek:number, last: null | { symbol:string, direction:string, outcome:"WIN"|"LOSS", r:number|null, at:number, path:string } }}
 */
export function callPulse(records, now, opts = {}) {
  const exclude = new Set((opts.exclude || []).filter(Boolean).map((a) => String(a).toLowerCase()));
  const isCurrent = typeof opts.isCurrent === "function" ? opts.isCurrent : isGraded;
  let open = 0, gradedWeek = 0, last = null;
  for (const rec of records || []) {
    const wallet = String(rec?.wallet || "");
    if (!wallet || exclude.has(wallet.toLowerCase())) continue;
    for (const t of rec.theses || []) {
      if (!isPublic(t)) continue;
      if (isGraded(t)) {
        if (!isCurrent(t)) continue;
        const at = Number(t.exitedAt) || Number(t.gradedAt) || 0;
        if (!(at > 0) || at > now + 10 * 60000) continue;
        if (now - at <= PULSE_WINDOW_MS) gradedWeek += 1;
        if (!last || at > last.at) {
          const r = Number(t.gradedR);
          last = {
            symbol: bare(t.symbol), direction: String(t.direction || "").toUpperCase(), outcome: t.gradedOutcome,
            r: Number.isFinite(r) ? Math.round(r * 100) / 100 : null, at,
            path: `/feed/thesis/${wallet}/${encodeURIComponent(String(t.id))}`,
          };
        }
        continue;
      }
      if (callLifecycle(t) === "OPEN") open += 1;
    }
  }
  return { open, gradedWeek, last };
}

/** "45m" · "6h" · "3d" — how long ago, coarse on purpose. */
export function agoShort(at, now) {
  const ms = Math.max(0, Number(now) - Number(at));
  if (ms < 3600000) return `${Math.max(1, Math.floor(ms / 60000))}m`;
  if (ms < 48 * 3600000) return `${Math.floor(ms / 3600000)}h`;
  return `${Math.floor(ms / 86400000)}d`;
}

/**
 * The chip's words. Real numbers always; a quiet week names the last graded call's age instead of a bare 0.
 * Unread pulse = no numbers, no claim.
 * @returns {{ parts: string[], title: string }}
 */
export function pulseLine(p, now = Date.now()) {
  const fallback = { parts: ["Lab", "every call scored from public price"], title: "How calls are graded" };
  if (!p || !Number.isFinite(p.open) || !Number.isFinite(p.gradedWeek)) return fallback;
  const open = `${p.open} open ${p.open === 1 ? "call" : "calls"}`;
  let graded = `${p.gradedWeek} graded this week`;
  if (p.gradedWeek === 0 && p.last && Number(p.last.at) > 0) graded = `last graded ${agoShort(p.last.at, now)} ago`;
  return { parts: ["Lab", open, graded], title: "Every call is scored from public price. See the record." };
}
