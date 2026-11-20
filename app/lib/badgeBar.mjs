// ── The CLEARED bar, v2 (docs/research/badge-bar-v2.md, SIGNED by borst in session 2026-11-20 at 90%) ─────────────
// A recorded 30-trade paper PASS earns the badge only if those same 30 trades beat matched random entries: 300 seeded
// replays, each trade redrawn on the same coin and side at an hour inside the run's window, walked on the same graded
// exit with the same fees (funding left out of both sides). The replays run ONCE, when the judgment is recorded
// (workers/nexus-lab-api/badgeReplays.mjs), and are stored with the verdict, never redrawn. Rules here, pure and tested
// (badgeBarRules.test.mjs); the page itself is pinned by badgeBar.test.mjs.

/** The signed numbers (rules 1, 2, 4, 6). A change is a new dated page, never an edit here. */
export const BADGE_BAR = Object.freeze({
  doc: "docs/research/badge-bar-v2.md",
  signedAt: "2026-11-20",
  seed: 20261120,      // mulberry32
  runs: 300,
  minUsable: 250,      // fewer usable replays = UNREAD, the badge waits
  maxRedraws: 10,      // a replay trade whose window isn't recorded is drawn again at most this many times
  beatPct: 90,         // the judged mean must beat at least this share of the replay means
  feeBps: 2.5,         // taker, each side, as the judged trades
});

export const RANDOM_VERDICTS = Object.freeze(["BEAT", "DIDNT_BEAT", "UNREAD"]);

/** The share of replay means the judged mean beats (ties count half), one decimal. */
export function pctBeaten(judgedMean, means) {
  const xs = (means || []).filter((m) => Number.isFinite(m));
  if (!xs.length || !Number.isFinite(judgedMean)) return null;
  const below = xs.filter((m) => m < judgedMean).length;
  const ties = xs.filter((m) => m === judgedMean).length;
  return Math.round(((below + ties / 2) / xs.length) * 1000) / 10;
}

/**
 * The check's verdict from the judged mean and the usable replay means (rules 4 + 6).
 * @returns {{ verdict: "BEAT"|"DIDNT_BEAT"|"UNREAD", pctBeaten: number|null, usable: number }}
 */
export function randomVerdict(judgedMeanBps, means, bar = BADGE_BAR) {
  const usable = (means || []).filter((m) => Number.isFinite(m)).length;
  if (usable < bar.minUsable) return { verdict: "UNREAD", pctBeaten: null, usable };
  const pct = pctBeaten(judgedMeanBps, means);
  const beat = judgedMeanBps > 0 && pct >= bar.beatPct;
  return { verdict: beat ? "BEAT" : "DIDNT_BEAT", pctBeaten: pct, usable };
}

/**
 * Did this recorded judgment clear the v2 bar? Takes the full record (`randomCheck`) or the slim shape the /proof
 * hook keeps (`random`). A PASS recorded with no check (none exist; rule 9) is not cleared.
 */
export function beatsRandom(judgment) {
  const v = judgment?.randomCheck?.verdict ?? judgment?.random ?? null;
  return judgment?.verdict === "PASS" && v === "BEAT";
}

/** One plain line for a PASS under the v2 bar (rule 7), or null for anything else. Never a dollar figure. */
export function badgeLine(judgment) {
  if (judgment?.verdict !== "PASS") return null;
  const c = judgment.randomCheck || (judgment.random ? { verdict: judgment.random, pctBeaten: judgment.randomPct ?? null, usable: judgment.randomUsable ?? null } : null);
  const n = judgment.target ?? 30;
  const pct = c?.pctBeaten != null ? `${Math.round(c.pctBeaten)}%` : null;
  if (!c) return `Passed ${n} paper trades after fees. The random-entry check hasn't run: not cleared.`;
  if (c.verdict === "BEAT") return `Passed ${n} paper trades after fees and beat ${pct} of ${BADGE_BAR.runs} random entries on the same coins and side.`;
  if (c.verdict === "DIDNT_BEAT") return `Passed ${n} paper trades after fees. Didn't beat random entries on the same coins and side (${pct} of ${BADGE_BAR.runs}).`;
  return `Passed ${n} paper trades after fees. The random-entry check is unread (${c.usable ?? 0} of ${BADGE_BAR.runs} replays usable): the badge waits.`;
}
