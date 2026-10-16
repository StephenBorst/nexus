// The words on a trader's shared identity: the PNG card, the /share/identity link preview, and the
// profile's "Post on X" text. One module so the three can't say different things.
//
// Rules (borst, 2026-10-16): nothing graded is claimed without the grade behind it, and no badge is
// better than a made-up one.
//   - The rank chip appears only when the grader gave a merit rank. No placeholder chip.
//   - A hit rate never appears without the average R beside it.
//   - "To qualify" counts graded calls to the caller board (5). It never promises a rank: Signal
//     also needs net-positive R.
//   - The card is read by strangers, so reads are re-pointed to the third person.
import { toThirdPerson } from "./operatorProfile.mjs";

export const BOARD_MIN_CALLS = 5; // the caller board's sample floor (lab-api MIN_CALLS)

const signedR = (r) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`;

/** The graded record from /theses/process (or the card route's copy of it), normalised. */
export function normRecord(p) {
  const calls = Number(p?.calls);
  if (!Number.isFinite(calls) || calls <= 0) return { calls: 0, hitRate: null, avgR: null };
  const hit = Number(p.hitRate), avg = Number(p.avgR);
  return { calls, hitRate: Number.isFinite(hit) ? hit : null, avgR: Number.isFinite(avg) ? avg : null };
}

/** "28 graded calls · 36% hit · +0.05R avg", or null with no graded call. Hit rate only beside R. */
export function recordLine(rec) {
  const r = normRecord(rec);
  if (!r.calls) return null;
  const n = `${r.calls} graded call${r.calls === 1 ? "" : "s"}`;
  if (r.hitRate == null || r.avgR == null) return n;
  return `${n} · ${Math.round(r.hitRate)}% hit · ${signedR(r.avgR)} avg`;
}

/** "▪ SIGNAL" when the grader gave a rank, else null. */
export function rankText(meritRank) {
  if (!meritRank?.title) return null;
  return `${meritRank.glyph ? `${meritRank.glyph} ` : ""}${String(meritRank.title).toUpperCase()}`;
}

/** The share text: link-preview description and the X post body. */
export function identityShareText(rec, meritRank) {
  const line = recordLine(rec);
  if (!line) return "No graded calls yet. Every public call is graded from public price.";
  const rank = meritRank?.title ? `${meritRank.title}. ` : "";
  return `${rank}${line}. Graded from public price.`;
}

/**
 * Everything the card prints. `profile` = buildOperatorProfile(...), `record` = {calls, hitRate, avgR}.
 * Stats carry a `tone` of "pos" | "neg" | null; only money (R) gets one.
 */
export function identityCardModel({ profile, record } = {}) {
  const rec = normRecord(record ?? { calls: profile?.gradedCalls });
  // Past the board's sample floor the profile's own headline stats are graded (buildHeadline gates
  // them at the same 5). Below it, the card counts calls instead of showing a number it can't back.
  const sampled = rec.calls >= BOARD_MIN_CALLS;
  const headline = profile?.archetype?.label
    ? String(profile.archetype.label).toUpperCase()
    : sampled ? "GRADED CALLER RECORD"
    : rec.calls ? "BUILDING A GRADED RECORD" : "NO GRADED CALLS YET";

  const re = profile?.reads?.find((r) => r.kind === "REGIME") || null;
  const readLine = re ? (() => { const t = toThirdPerson(re.text); return t.charAt(0).toUpperCase() + t.slice(1); })() : null;

  let stats;
  if (sampled && (profile?.headline || []).length) {
    stats = (profile.headline || []).filter((h) => h.key !== "leak").map((h) => ({
      label: String(h.label).toUpperCase(), value: h.value ?? "—", tone: h.tone ?? null, sub: toThirdPerson(h.sub || ""),
    }));
  } else {
    const plan = (profile?.headline || []).find((h) => h.key === "plan");
    stats = [
      { label: "GRADED CALLS", value: String(rec.calls), tone: null, sub: "resolved vs public price" },
      rec.avgR == null
        ? { label: "AVG R", value: "—", tone: null, sub: "no graded call yet" }
        : { label: "AVG R", value: signedR(rec.avgR), tone: rec.avgR > 0 ? "pos" : rec.avgR < 0 ? "neg" : null, sub: "per graded call" },
      rec.calls < BOARD_MIN_CALLS
        ? { label: "TO QUALIFY", value: String(BOARD_MIN_CALLS - rec.calls), tone: null, sub: `graded calls to the caller board` }
        : { label: "PLAN QUALITY", value: plan?.value ?? "—", tone: null, sub: "how well-formed the calls are" },
    ];
  }

  return {
    rank: rankText(profile?.meritRank),
    headline,
    recordLine: recordLine(rec) ?? "Every public call is graded from public price.",
    readLine,
    stats,
  };
}
