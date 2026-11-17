// ── The trend gate's judge (docs/research/trend-gate-prereg.md, signed by borst 2026-11-16) ─────────────
// Pure. Takes BTC's 4h trend by hour (trendGate.mjs btcTrendByHour, imported unchanged) and each study read's events
// WITH their side and their R already graded by the scoreboard (axisbt eventsWithR: one R, never a second one here),
// and returns per-read status, statistic, p-value, Holm and verdict. Measurement only: it fires nothing, blocks nothing,
// writes nothing. Recording a verdict under the page's Results is its own PR; a block is borst's reviewed PR.
// Brain and exec never import it (trendGrading.test.mjs fails if one does).
//
// Built the way the stress judge is built (stressGrading.mjs, approved 2026-11-04), and for the same reasons. Where the
// page leaves a choice to the code, this file makes it once, here, before any outcome exists (built 2026-11-17, the
// study's first day, before any out-of-sample event has an R):
//   1. The statistic is d = mean R WITH − mean R AGAINST. "AGAINST below WITH" = d > 0.
//   2. A shift k moves BTC's whole trend series forward k hours around the circle [study start, judging time): an event
//      reads the trend at its own label hour moved back by k (wrapped). Each event's side and R stay fixed. An event
//      whose moved-back hour has no trend (an exact tie, or BTC's tape missing there) is left out of THAT shift only.
//   3. "At least 7 days" holds both ways round the circle (k ≥ 7d and span − k ≥ 7d); a span under 14 days is refused.
//   4. The PRNG is mulberry32 with its own seed, TREND_GATE_SEED (20261116, the signing date), pinned by a golden
//      vector. One set of 1,000 shifts per judging span, drawn in order.
//   5. p = the share of shifts with |d| at least the real |d| (two-sided, no +1). A shift that leaves a side empty has
//      no difference and is left out of the share (`validShifts`); none valid = REFUSED.
//   6. The judging time is fixed by the data: the 30/30 cutoff event + 168h (the R contract's longest hold), or the
//      limit. Span, shifts and labels stop there, so a later re-run gives the same p. Until then: RIPENING.
//   7. A read waits while any event before its 30/30 cutoff has no R yet (WAITING_ON_PENDING): never a verdict on a
//      partial population.
//   8. Holm across reads judged at different times, as the stress judge: each read's p is frozen on its own
//      population; p ≤ alpha/13 is significant whatever the rest of the family does, p > alpha is not, in between it
//      waits (PENDING_HOLM) until every read is judged or out at the limit.
//   9. Out-of-sample = after BOTH the study start and the read's own registeredAt (readPipeline.mjs).
//  10. The holdout line is labelled with the same BTC trend and gets d and p, display only: never in the Holm family,
//      never a verdict.
// One case the page does not name, ruled by borst on 2026-11-17 (dated under the page's Results) before any read had
// an out-of-sample event:
//   G1. At the limit, 20 or more events on BOTH sides = judged as it stands, whether or not the larger side reached 30
//       (as the stress study's ruling R2). Fewer than 20 on either side stays NOT_ENOUGH.
import { TREND_GATE_STUDY } from "./trendGate.mjs";
import { mulberry32, holm, R_HOLD_H } from "./stressGrading.mjs";

export const TREND_GATE_SEED = 20261116;

// Verdict words. Only AGAINST_WORSE licenses anything (one reviewed PR proposing that read's live block, never automatic).
export const TREND_VERDICT_LABELS = Object.freeze({
  AGAINST_WORSE: "worse against BTC's trend",
  LOWER_STILL_POSITIVE: "lower against BTC's trend, still positive",
  NO_DIFFERENCE: "no difference",
  WITH_WORSE: "worse with BTC's trend",
  NOT_ENOUGH: "not enough events",
});

const H = 3600000;
const EPS = 1e-12;
const mod = (a, n) => ((a % n) + n) % n;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** The shifts for one judging span, in whole hours, each in [minShiftH, spanH − minShiftH]. */
export function drawTrendShifts(spanH, study = TREND_GATE_STUDY, seed = TREND_GATE_SEED) {
  const minH = study.minShiftDays * 24;
  if (!Number.isInteger(spanH) || spanH < 2 * minH) return { ok: false, error: "span_too_short" };
  const rnd = mulberry32(seed);
  const width = spanH - 2 * minH + 1;
  return { ok: true, spanH, shiftsH: Array.from({ length: study.shifts }, () => minH + Math.floor(rnd() * width)) };
}

/** The hour whose trend an event reads: the hour that closed at or before its decision close (trendGate.trendLabel). */
export const labelHour = (t) => Math.floor(Number(t) / H) - 1;

/** WITH / AGAINST / null for a side against a trend. */
function sideVsTrend(side, trend) {
  if (trend !== "UP" && trend !== "DOWN") return null;
  if (side !== "LONG" && side !== "SHORT") return null;
  return (side === "LONG") === (trend === "UP") ? "WITH" : "AGAINST";
}

/** The label an event gets with BTC's trend series shifted forward k hours round [startH, startH + spanH). */
export function shiftedTrendLabel(e, kH, startH, spanH, trendByHour) {
  const back = startH + mod(labelHour(e.t) - startH - kH, spanH);
  return sideVsTrend(e.side, trendByHour.get(back) ?? null);
}

/** d = mean R WITH − mean R AGAINST, or null if a side is empty. */
function diff(withR, againstR) {
  return withR.length && againstR.length ? mean(withR) - mean(againstR) : null;
}

/** d and the time-shift p for one population of labelled, resolved events ({ t, side, r, label }). */
export function trendShiftTest(pop, { startH, spanH, shiftsH, trendByHour }) {
  const w = pop.filter((e) => e.label === "WITH").map((e) => e.r);
  const a = pop.filter((e) => e.label === "AGAINST").map((e) => e.r);
  const d = diff(w, a);
  if (d == null) return { d: null, p: null, meanWith: null, meanAgainst: null, validShifts: 0 };
  let extreme = 0, valid = 0;
  for (const k of shiftsH) {
    const ww = [], aa = [];
    for (const e of pop) {
      const l = shiftedTrendLabel(e, k, startH, spanH, trendByHour);
      if (l === "WITH") ww.push(e.r); else if (l === "AGAINST") aa.push(e.r);
    }
    const dk = diff(ww, aa);
    if (dk == null) continue;
    valid++;
    if (Math.abs(dk) >= Math.abs(d) - EPS) extreme++;
  }
  return { d, p: valid ? extreme / valid : null, validShifts: valid, meanWith: mean(w), meanAgainst: mean(a) };
}

/**
 * One read's population: its out-of-sample events labelled, and the first time-ordered prefix reaching minEach WITH and
 * minEach AGAINST (resolved, labelled events only).
 */
export function trendPopulation(events, { trendByHour, startMs, endMs, study = TREND_GATE_STUDY }) {
  const evs = (events || [])
    .filter((e) => Number.isFinite(e?.t) && e.t >= startMs && e.t < endMs)
    .sort((x, y) => x.t - y.t)
    .map((e) => ({ t: e.t, side: String(e.side || "").toUpperCase(), r: e.r == null ? null : Number(e.r) }))
    .filter((e) => e.r === null || Number.isFinite(e.r))
    .map((e) => ({ ...e, label: sideVsTrend(e.side, trendByHour.get(labelHour(e.t)) ?? null) ?? "UNLABELLED" }));
  const counts = { WITH: 0, AGAINST: 0, UNLABELLED: 0, pending: 0 };
  let cutoff = -1, nW = 0, nA = 0;
  evs.forEach((e, i) => {
    if (e.r === null) { counts.pending++; return; }
    counts[e.label]++;
    if (cutoff < 0) {
      if (e.label === "WITH") nW++;
      if (e.label === "AGAINST") nA++;
      if (nW >= study.minEach && nA >= study.minEach) cutoff = i;
    }
  });
  const keep = (e) => e.r !== null && e.label !== "UNLABELLED";
  return {
    counts,
    reached: cutoff >= 0,
    cutoffT: cutoff >= 0 ? evs[cutoff].t : null,
    pendingBeforeCutoff: cutoff >= 0 && evs.slice(0, cutoff).some((e) => e.r === null),
    prefix: cutoff >= 0 ? evs.slice(0, cutoff + 1).filter(keep) : null,
    all: evs.filter(keep),
    anyPending: counts.pending > 0,
  };
}

/**
 * Judge the study at `at`.
 * @param {object} a
 * @param {Map<number, "UP"|"DOWN"|null>} a.trendByHour BTC's 4h trend by hour index (btcTrendByHour)
 * @param {Record<string, {main: {t:number, side:string, r:number|null}[], holdout?: {t:number, side:string, r:number|null}[]}>} a.events
 * @param {Record<string, string>} a.registeredAt read → its registration time (ISO); missing = an error, never a guess
 * @param {number} a.at judging time (ms)
 */
export function judgeTrendGate({ trendByHour, events, registeredAt, at, study = TREND_GATE_STUDY }) {
  const studyStart = Date.parse(study.from);
  const limitMs = Date.parse(study.limit);
  const endMs = Math.min(at, limitMs);
  const startH = Math.floor(studyStart / H);
  const alpha = study.alpha;
  const sure = alpha / study.reads.length;

  const reads = {};
  for (const name of study.reads) {
    const regMs = Date.parse(registeredAt?.[name] ?? "");
    if (!Number.isFinite(regMs)) { reads[name] = { status: "REFUSED", error: "no_registration", final: false, verdict: null }; continue; }
    const startMs = Math.max(studyStart, regMs);
    const ev = events?.[name] || {};
    const pop = trendPopulation(ev.main, { trendByHour, startMs, endMs, study });
    const row = { status: "ACCRUING", counts: pop.counts, from: startMs, cutoffT: pop.cutoffT, judgedAt: null, spanH: null, d: null, p: null, meanWith: null, meanAgainst: null, verdict: null, final: false };
    let judgedPop = null, judgeEnd = null;
    if (pop.reached && pop.cutoffT + R_HOLD_H * H < limitMs) {
      judgeEnd = pop.cutoffT + R_HOLD_H * H;
      if (at < judgeEnd) row.status = "RIPENING";
      else if (pop.pendingBeforeCutoff) row.status = "WAITING_ON_PENDING";
      else judgedPop = pop.prefix;
    } else if (at >= limitMs) {
      judgeEnd = limitMs;
      const small = Math.min(pop.counts.WITH, pop.counts.AGAINST);
      if (pop.reached && !pop.pendingBeforeCutoff) judgedPop = pop.prefix;          // reached 30/30 in the last week
      else if (pop.anyPending) row.status = "WAITING_ON_PENDING";
      else if (small < study.minSmallAtLimit) Object.assign(row, { status: "NOT_ENOUGH", verdict: "NOT_ENOUGH", label: TREND_VERDICT_LABELS.NOT_ENOUGH, licensesBlock: false, final: true });
      else judgedPop = pop.all;                                                        // ≥ 20 on both sides: as it stands (G1)
    } else if (pop.reached) row.status = "RIPENING";
    if (judgedPop) {
      const spanH = Math.floor((judgeEnd - studyStart) / H);
      const draws = drawTrendShifts(spanH, study);
      row.judgedAt = judgeEnd;
      row.spanH = spanH;
      if (!draws.ok) Object.assign(row, { status: "REFUSED", error: draws.error });
      else {
        const t = trendShiftTest(judgedPop, { startH, spanH, shiftsH: draws.shiftsH, trendByHour });
        if (t.p == null) Object.assign(row, { status: "REFUSED", error: "no_valid_shift" }, t);
        else Object.assign(row, { status: "JUDGED" }, t);
      }
    }
    // holdout: display only, on the main line's span once judged (else up to now)
    const hEnd = judgeEnd && at >= judgeEnd ? judgeEnd : endMs;
    const hp = trendPopulation(ev.holdout, { trendByHour, startMs, endMs: hEnd, study });
    const hSpan = Math.floor((hEnd - studyStart) / H);
    const hDraws = drawTrendShifts(hSpan, study);
    row.holdout = { counts: hp.counts, ...(hDraws.ok && hp.all.length ? trendShiftTest(hp.all, { startH, spanH: hSpan, shiftsH: hDraws.shiftsH, trendByHour }) : { d: null, p: null }), informational: true };
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
    if (significant === null) { r.pending = "PENDING_HOLM"; continue; }
    r.final = true;
    if (!significant) r.verdict = "NO_DIFFERENCE";
    else if (r.d < 0) r.verdict = "WITH_WORSE";
    else if (r.meanAgainst < 0) r.verdict = "AGAINST_WORSE";
    else r.verdict = "LOWER_STILL_POSITIVE";
    r.label = TREND_VERDICT_LABELS[r.verdict];
    r.licensesBlock = r.verdict === "AGAINST_WORSE";
  }
  return { at, from: studyStart, endMs, atLimit: at >= limitMs, shifts: study.shifts, familyComplete: complete, reads };
}
