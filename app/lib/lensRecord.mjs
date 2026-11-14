// YOUR CALLS VS THE LENSES (Stats, 2026-11-14, borst: "calls vs the lenses"). Each call published from 2026-11-15
// carries `publishLens`: what the smart-money 2× rule and the funding stretch showed at the moment it was posted,
// read and pinned by the server (lab-api publishLens.mjs). This splits the trader's GRADED calls by it: with or
// against the tracked traders' agreement, with or against the funding fade. The trader's own record, graded from
// public price; an average shows only at LENS_MIN calls a group (one call swings it). Pure, tested.

export const LENS_MIN = 5;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function group() { return { n: 0, wins: 0, sumR: 0 }; }
function add(g, t) { g.n++; if (t.gradedOutcome === "WIN") g.wins++; g.sumR += t.gradedR; }
function done(g) {
  return { n: g.n, wins: g.wins, netR: Math.round(g.sumR * 100) / 100, avgR: g.n >= LENS_MIN ? Math.round((g.sumR / g.n) * 100) / 100 : null };
}

/**
 * @returns {null | { tracked: number, smart: {with, against, none}, funding: {withFade, againstFade, calm}, lines: string[] }}
 *   null when no graded call carries a snapshot yet.
 */
export function lensRecord(theses) {
  const graded = (theses || []).filter((t) => t && !t.duplicateOf && (t.gradedOutcome === "WIN" || t.gradedOutcome === "LOSS")
    && num(t.gradedR) != null && t.publishLens && typeof t.publishLens === "object");
  if (!graded.length) return null;
  const s = { with: group(), against: group(), none: group() };
  const f = { withFade: group(), againstFade: group(), calm: group() };
  for (const t of graded) {
    const L = t.publishLens, dir = t.direction;
    if (L.smartSide === "NONE") add(s.none, t);
    else if (L.smartSide === "LONG" || L.smartSide === "SHORT") add(L.smartSide === dir ? s.with : s.against, t);
    if (L.stretched === false) add(f.calm, t);
    else if (L.stretched === true && num(L.fundAnnual) != null && L.fundAnnual !== 0) {
      const fade = L.fundAnnual > 0 ? "SHORT" : "LONG";
      add(fade === dir ? f.withFade : f.againstFade, t);
    }
  }
  const out = {
    tracked: graded.length,
    smart: { with: done(s.with), against: done(s.against), none: done(s.none) },
    funding: { withFade: done(f.withFade), againstFade: done(f.againstFade), calm: done(f.calm) },
    lines: [],
  };
  const r = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}R`;
  const pair = (a, aw, b, bw) => (a.avgR != null && b.avgR != null ? `${aw}: ${r(a.avgR)} a call over ${a.n}. ${bw}: ${r(b.avgR)} over ${b.n}.` : null);
  const sl = pair(out.smart.with, "With the tracked traders' 2× agreement", out.smart.against, "Against it");
  const fl = pair(out.funding.withFade, "With the funding fade", out.funding.againstFade, "Against it");
  if (sl) out.lines.push(sl);
  if (fl) out.lines.push(fl);
  return out;
}
