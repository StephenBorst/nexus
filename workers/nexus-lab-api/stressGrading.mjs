// ── The stress-hour study's judge (docs/research/stress-hours-prereg.md) ───────────────────────────
// Pure. Takes the stress hours, the judged hours and each read's events WITH their R already graded by
// the scoreboard (axisbt gradeEventR: one R, never a second one here), and returns per-read status,
// statistic, p-value, Holm and verdict. It imports the rule and the labels unchanged from
// stressHours.mjs. Wiring it into the scoreboard and recording a verdict on the page are their own PRs.
// Brain and exec never import it (stressGrading.test.mjs fails if one does).
//
// Where the page leaves a choice to the code, this file makes it once, here, before any outcome exists:
//   1. Holm across reads judged at different times: each read's p is frozen on its 30/30 population.
//      p ≤ alpha/7 is significant whatever the other reads do; p > alpha is not; in between the read
//      waits (PENDING_HOLM) until the family is complete (every read judged or out at the limit).
//   2. "At least 7 days" holds both ways round the circle: every shift k has k ≥ 7d and span − k ≥ 7d.
//      A span under 14 days has no valid shift: refused, never guessed.
//   3. The PRNG is mulberry32 (seed 20261031), pinned by a golden vector. One set of 1,000 shifts per
//      judging span, drawn in order: every read judged at the limit shares one set; a read judged early
//      gets the set for its own span (same seed, same draws, scaled to that span).
//   4. p = share of shifts with |d| at least the real |d|, exactly as the page says (no +1). A shift
//      that leaves one side empty has no difference, so it isn't one of "the shifts with a difference":
//      it's left out of the share, and `validShifts` reports how many counted. None valid = REFUSED.
//      (Counting empty shifts as extreme looked conservative but inflates p wherever stress is rare in
//      part of the span; a test caught a true effect read as NO_DIFFERENCE that way.)
//   5. R is an input. An event with r === null hasn't resolved yet; a read waits while any event before
//      its 30/30 cutoff is unresolved, so a verdict is never frozen on a partial population.
//   7. "The judging time" is fixed by the data, not by when this runs: the 30/30 cutoff event + 168h
//      (the R contract's longest hold, so every R in the population has resolved), or the limit. The
//      span, the shifts and the labels all stop there, so anyone re-running this later gets the same p.
//      Until then a read that reached 30/30 is RIPENING.
//   6. The holdout line is labelled with the main-card stress hours and gets d and p, display only:
//      never in the Holm family, never a verdict.
// Two cases the page doesn't name return verdict null with a `gap` for borst to rule on before any
// read can reach them: significantly lower in stress but STRESS mean R ≥ 0, and ≥20 STRESS but <30
// CALM at the limit.
import { STRESS_RULE, STRESS_STUDY, inStress, stressLabel } from "./stressHours.mjs";

const H = 3600000;
const EPS = 1e-12;
export const R_HOLD_H = 168; // the R contract's longest hold (axisbt R_CONTRACT): every R is resolved by then

/** mulberry32: a small, well-known 32-bit PRNG. Returns a function giving floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The shifts for one judging span, in whole hours: `shifts` draws, each in [minShiftH, spanH − minShiftH].
 * @returns {{ ok: true, spanH: number, shiftsH: number[] } | { ok: false, error: string }}
 */
export function drawShifts(spanH, study = STRESS_STUDY) {
  const minH = study.minShiftDays * 24;
  if (!Number.isInteger(spanH) || spanH < 2 * minH) return { ok: false, error: "span_too_short" };
  const rnd = mulberry32(study.seed);
  const width = spanH - 2 * minH + 1;
  const shiftsH = Array.from({ length: study.shifts }, () => minH + Math.floor(rnd() * width));
  return { ok: true, spanH, shiftsH };
}

/**
 * The label an event would get if the stress-hour series were shifted forward by k hours around the
 * circle [start, start + span). Equivalent to reading the real series at the event's time moved back
 * by k (wrapped), which is how it's computed. Judged status is fixed by the caller: this only says
 * STRESS or CALM.
 */
export function shiftedIsStress(t, kH, startMs, spanH, hoursMs, p = STRESS_RULE) {
  const span = spanH * H;
  const back = ((((t - startMs - kH * H) % span) + span) % span) + startMs;
  return inStress(back, hoursMs, p);
}

/** Holm step-down at alpha over [{ name, p }]. Returns name → { rank, threshold, significant }. */
export function holm(rows, alpha = STRESS_STUDY.alpha) {
  const sorted = [...rows].sort((a, b) => a.p - b.p || (a.name < b.name ? -1 : 1));
  const m = sorted.length;
  const out = {};
  let stillRejecting = true;
  sorted.forEach((r, i) => {
    const threshold = alpha / (m - i);
    stillRejecting = stillRejecting && r.p <= threshold + EPS;
    out[r.name] = { rank: i + 1, threshold, significant: stillRejecting };
  });
  return out;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** d = mean R STRESS − mean R CALM, or null if a side is empty. */
function diff(stress, calm) {
  return stress.length && calm.length ? mean(stress) - mean(calm) : null;
}

/** d and the time-shift p for one population of labelled events (each { t, r, label }). */
export function shiftTest(pop, { startMs, spanH, shiftsH, hoursMs, p = STRESS_RULE }) {
  const s = pop.filter((e) => e.label === "STRESS").map((e) => e.r);
  const c = pop.filter((e) => e.label === "CALM").map((e) => e.r);
  const d = diff(s, c);
  if (d == null) return { d: null, p: null, meanStress: null, meanCalm: null };
  let extreme = 0, valid = 0;
  for (const k of shiftsH) {
    const ss = [], cc = [];
    for (const e of pop) (shiftedIsStress(e.t, k, startMs, spanH, hoursMs, p) ? ss : cc).push(e.r);
    const dk = diff(ss, cc);
    if (dk == null) continue;
    valid++;
    if (Math.abs(dk) >= Math.abs(d) - EPS) extreme++;
  }
  return { d, p: valid ? extreme / valid : null, validShifts: valid, meanStress: mean(s), meanCalm: mean(c) };
}

/**
 * One read's population at `at`: out-of-sample events labelled, and the first time-ordered prefix
 * reaching minEach STRESS and minEach CALM (resolved events only).
 */
export function readPopulation(events, { hoursMs, judged, startMs, endMs, study = STRESS_STUDY, p = STRESS_RULE }) {
  const evs = (events || [])
    .filter((e) => Number.isFinite(e?.t) && e.t >= startMs && e.t < endMs)
    .sort((a, b) => a.t - b.t)
    .map((e) => ({ t: e.t, r: e.r == null ? null : Number(e.r), label: stressLabel(e.t, hoursMs, judged, p) }))
    .filter((e) => e.r === null || Number.isFinite(e.r));
  const counts = { STRESS: 0, CALM: 0, UNJUDGED: 0, pending: 0 };
  let cutoff = -1, nS = 0, nC = 0, pendingBeforeCutoff = false;
  evs.forEach((e, i) => {
    if (e.r === null) { counts.pending++; return; }
    counts[e.label]++;
    if (cutoff < 0) {
      if (e.label === "STRESS") nS++;
      if (e.label === "CALM") nC++;
      if (nS >= study.minEach && nC >= study.minEach) cutoff = i;
    }
  });
  if (cutoff >= 0) pendingBeforeCutoff = evs.slice(0, cutoff).some((e) => e.r === null);
  const resolved = evs.filter((e) => e.r !== null && e.label !== "UNJUDGED");
  return {
    counts,
    reached: cutoff >= 0,
    cutoffT: cutoff >= 0 ? evs[cutoff].t : null,
    pendingBeforeCutoff,
    prefix: cutoff >= 0 ? evs.slice(0, cutoff + 1).filter((e) => e.r !== null && e.label !== "UNJUDGED") : null,
    all: resolved,
    anyPending: counts.pending > 0,
  };
}

/**
 * Judge the study at `at`.
 * @param {object} a
 * @param {number[]} a.hoursMs stress hours (stressHours on the main-card panel), ascending
 * @param {Set<number>} a.judged judged hour buckets (judgedHourSet)
 * @param {Record<string, {main: {t:number, r:number|null}[], holdout?: {t:number, r:number|null}[]}>} a.events
 * @param {number} a.at judging time (ms)
 */
export function judgeStressStudy({ hoursMs, judged, events, at, study = STRESS_STUDY, p = STRESS_RULE }) {
  const startMs = Date.parse(study.registeredAt);
  const limitMs = Date.parse(study.limit);
  const endMs = Math.min(at, limitMs); // events counted up to here
  const alpha = study.alpha;
  const sure = alpha / study.reads.length; // passes Holm whatever the rest of the family does

  const reads = {};
  for (const name of study.reads) {
    const ev = events?.[name] || {};
    const pop = readPopulation(ev.main, { hoursMs, judged, startMs, endMs, study, p });
    const row = { status: "ACCRUING", counts: pop.counts, cutoffT: pop.cutoffT, judgedAt: null, spanH: null, d: null, p: null, meanStress: null, meanCalm: null, verdict: null, final: false };
    let judgedPop = null, judgeEnd = null;
    if (pop.reached && pop.cutoffT + R_HOLD_H * H < limitMs) {
      judgeEnd = pop.cutoffT + R_HOLD_H * H;
      if (at < judgeEnd) row.status = "RIPENING";
      else if (pop.pendingBeforeCutoff) row.status = "WAITING_ON_PENDING";
      else judgedPop = pop.prefix;
    } else if (at >= limitMs) {
      judgeEnd = limitMs;
      if (pop.reached && !pop.pendingBeforeCutoff) judgedPop = pop.prefix; // reached 30/30 inside the last week
      else if (pop.anyPending) row.status = "WAITING_ON_PENDING";
      else if (pop.counts.STRESS < study.minAtLimit) { row.status = "NOT_ENOUGH_STRESS"; row.verdict = "NOT_ENOUGH_STRESS"; row.final = true; }
      else if (pop.counts.CALM < study.minEach) { row.status = "INCOMPLETE"; row.gap = "stress_enough_calm_short_at_limit"; row.final = true; }
      else judgedPop = pop.all;
    } else if (pop.reached) row.status = "RIPENING";
    if (judgedPop) {
      const spanH = Math.floor((judgeEnd - startMs) / H);
      const draws = drawShifts(spanH, study);
      row.judgedAt = judgeEnd;
      row.spanH = spanH;
      if (!draws.ok) { row.status = "REFUSED"; row.error = draws.error; }
      else {
        const t = shiftTest(judgedPop, { startMs, spanH, shiftsH: draws.shiftsH, hoursMs, p });
        if (t.p == null) Object.assign(row, { status: "REFUSED", error: "no_valid_shift" }, t);
        else Object.assign(row, { status: "JUDGED" }, t);
      }
    }
    // holdout: display only, on the same span as the main line once judged (else up to now)
    const hEnd = judgeEnd && at >= judgeEnd ? judgeEnd : endMs;
    const hp = readPopulation(ev.holdout, { hoursMs, judged, startMs, endMs: hEnd, study, p });
    const hSpan = Math.floor((hEnd - startMs) / H);
    const hDraws = drawShifts(hSpan, study);
    row.holdout = { counts: hp.counts, ...(hDraws.ok && hp.all.length ? shiftTest(hp.all, { startMs, spanH: hSpan, shiftsH: hDraws.shiftsH, hoursMs, p }) : { d: null, p: null }), informational: true };
    reads[name] = row;
  }

  const judgedRows = Object.entries(reads).filter(([, r]) => r.status === "JUDGED" && r.p != null).map(([name, r]) => ({ name, p: r.p }));
  const complete = Object.values(reads).every((r) => r.status === "JUDGED" || r.final);
  const h = holm(judgedRows, alpha);
  for (const { name } of judgedRows) {
    const r = reads[name];
    let significant;
    if (complete) significant = h[name].significant;
    else if (r.p <= sure + EPS) significant = true;
    else if (r.p > alpha + EPS) significant = false;
    else significant = null;
    r.holm = { ...h[name], significant, familyComplete: complete };
    if (significant === null) { r.verdict = null; r.final = false; r.pending = "PENDING_HOLM"; continue; }
    r.final = true;
    if (!significant) r.verdict = "NO_DIFFERENCE";
    else if (r.d > 0) r.verdict = "BETTER_IN_STRESS";
    else if (r.meanStress < 0) r.verdict = "WORSE_IN_STRESS";
    else { r.verdict = null; r.gap = "lower_in_stress_but_stress_mean_nonnegative"; }
  }
  return { at, startMs, endMs, atLimit: at >= limitMs, shifts: study.shifts, familyComplete: complete, reads };
}
