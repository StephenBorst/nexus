// ── The Lab's FADE, labelled with what the scoreboard says ──────────────────────────────────
// THE BOARD and the Briefing print "FADE SHORT/LONG" when funding pierces its own p25–p75 range
// AND clears FADE_FUNDING_FLOOR_PCT_YR (logic.mjs readVerdict). The scoreboard
// (/intel/axis-backtest) does not grade that exact rule. Its closest graded relative is the plain
// funding fade (axis `funding_fade`: |funding| ≥ 0.01% per 8h, about 11%/yr, every hour it holds).
// So the honest label is "not graded yet" plus that relative's LIVE grade, read from the scorecard
// as served, so the words can't go stale when the grade moves. Display only: nothing here grades.

export const FADE_FAMILY_AXIS = "funding_fade";

const TIER = { PREDICTIVE: "PREDICTIVE", PROMISING: "PROMISING", NOISE: "NOISE", INSUFFICIENT: "ACCRUING" };
const VS_RANDOM = {
  BEATS_RANDOM: "beats random entries",
  LEANS_ABOVE: "leans above random entries",
  NOT_DISTINGUISHABLE: "no better than random entries",
  BELOW_RANDOM: "worse than random entries",
};

/**
 * @typedef {{ tier: string, vsRandom: string | null, samples: number | null }} FadeFamilyGrade
 */

/**
 * The plain funding fade's grade from a scorecard as served, or null when it isn't there.
 * @param {{ axes?: Array<{ name?: string, verdict?: string, r?: { samples?: number }, random?: { pooled?: { verdict?: string } } }> } | null | undefined} scorecard
 * @returns {FadeFamilyGrade | null}
 */
export function fadeFamilyGrade(scorecard) {
  const axes = Array.isArray(scorecard?.axes) ? scorecard.axes : [];
  const axis = axes.find((a) => a && a.name === FADE_FAMILY_AXIS);
  const tier = axis ? TIER[/** @type {keyof typeof TIER} */ (axis.verdict)] : undefined;
  if (!axis || !tier) return null;
  const n = Number(axis.r?.samples);
  return {
    tier,
    vsRandom: VS_RANDOM[/** @type {keyof typeof VS_RANDOM} */ (axis.random?.pooled?.verdict)] || null,
    samples: Number.isFinite(n) && n > 0 ? Math.round(n) : null,
  };
}

/**
 * One line naming the relative's grade, e.g. "The plain funding fade grades NOISE, worse than
 * random entries (3,444 samples)." Null when the grade isn't known: say nothing rather than guess.
 * @param {FadeFamilyGrade | null | undefined} g
 * @returns {string | null}
 */
export function fadeFamilyLine(g) {
  if (!g) return null;
  const vs = g.vsRandom ? `, ${g.vsRandom}` : "";
  const n = g.samples ? ` (${g.samples.toLocaleString("en-US")} samples)` : "";
  return `The plain funding fade grades ${g.tier}${vs}${n}.`;
}

// ── Every lens, labelled with its nearest graded relative (the market drawer, 2026-11-14) ─────
// Same honesty as the FADE label: the drawer's lenses are not graded rules themselves. Where the scoreboard grades a
// close relative, the drawer prints that relative's LIVE grade under the lens, naming exactly what was graded, and
// says plainly what wasn't. A lens with no graded relative says "not graded". Display only.

/** The grade of any axis on a scorecard as served, or null when it isn't there. */
export function axisGrade(scorecard, name) {
  const axes = Array.isArray(scorecard?.axes) ? scorecard.axes : [];
  const axis = axes.find((a) => a && a.name === name);
  const tier = axis ? TIER[/** @type {keyof typeof TIER} */ (axis.verdict)] : undefined;
  if (!axis || !tier) return null;
  const n = Number(axis.r?.samples);
  return {
    tier,
    vsRandom: VS_RANDOM[/** @type {keyof typeof VS_RANDOM} */ (axis.random?.pooled?.verdict)] || null,
    samples: Number.isFinite(n) && n > 0 ? Math.round(n) : null,
  };
}

const gradeText = (g) => `${g.tier}${g.vsRandom ? `, ${g.vsRandom}` : ""}${g.samples ? ` (${g.samples.toLocaleString("en-US")} samples)` : ""}`;

/** lens id → { axis, what it graded, what the lens adds that isn't graded }. */
export const LENS_RELATIVES = Object.freeze({
  funding: { axis: FADE_FAMILY_AXIS, graded: "The plain funding fade", gap: "The stretch rule shown here isn't graded on its own." },
  smart: { axis: "smart_follow", graded: "Following the recorded smart-money lean (any margin)", gap: "The 2× agreement shown here isn't graded on its own." },
});
export const UNGRADED_LENSES = Object.freeze(["forecast", "catalysts"]);

/** The line under a lens: its relative's live grade, "not graded", or null (nothing to say / grade unread). */
export function lensGradeLine(lensId, scorecard) {
  const rel = LENS_RELATIVES[lensId];
  if (rel) {
    const g = axisGrade(scorecard, rel.axis);
    return g ? `Nearest graded rule: ${rel.graded.charAt(0).toLowerCase()}${rel.graded.slice(1)} grades ${gradeText(g)}. ${rel.gap}` : null;
  }
  if (UNGRADED_LENSES.includes(lensId)) return "Not graded: no read on this lens is registered yet.";
  return null;
}
