// The data behind a trader's shared identity (/og/identity + /share/identity): the same graded record
// /theses/process serves, so the card and the profile page read one source.
import { computeCallerStats as defaultStats } from "./grading.mjs";
import { rankCaller } from "./logic.mjs";
import { buildOperatorProfile } from "../../app/lib/operatorProfile.mjs";
import { normRecord } from "../../app/lib/identityCard.mjs";

/**
 * @returns {Promise<{profile, record: {calls, hitRate, avgR}, displayName: string|null}>}
 * A failed stats read yields the zero record ("No graded calls yet"), never invented numbers.
 */
export async function loadIdentity(env, wallet, { computeCallerStats = defaultStats } = {}) {
  let profile, record;
  try {
    const byWallet = await computeCallerStats(env, 30 * 86400, { onlyWallet: wallet });
    const a = Object.values(byWallet || {})[0];
    const process = (a && a.calls) ? {
      calls: a.calls,
      hitRate: Math.round((a.wins / a.calls) * 1000) / 10,
      avgR: Math.round((a.rSum / a.calls) * 100) / 100,
      expectancy: a.expectancy,
      regimeEdges: a.regimeEdges,
      discipline: a.plan,
      calibration: a.calibration,
      meritRank: rankCaller(a),
    } : { calls: 0 };
    profile = buildOperatorProfile({ process });
    record = normRecord(process);
  } catch (e) {
    console.error("[identity] stats read failed:", String(e));
    profile = buildOperatorProfile({});
    record = normRecord(null);
  }
  let displayName = null;
  try {
    const raw = await env.LAB_STORE.get(`profile:${wallet}`);
    displayName = raw ? (JSON.parse(raw).displayName || null) : null;
  } catch { /* no name: the card shows the short address */ }
  return { profile, record, displayName };
}

/** Image-URL version: changes whenever the record or rank does, so X fetches a fresh card. */
export function identityCardVersion(record, meritRank) {
  const r = normRecord(record);
  return [r.calls, r.hitRate ?? "", r.avgR ?? "", meritRank?.tier || meritRank?.title || ""].join("-").replace(/[^0-9A-Za-z.-]/g, "");
}
