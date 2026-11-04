// ── The stress-hour study, wired to the scoreboard (docs/research/stress-hours-prereg.md) ────────────
// Pure. Builds the study's inputs from the same coin sets /intel/axis-backtest grades, runs the judge
// (stressGrading.mjs, approved 2026-11-04 with borst's two rulings) and returns what the scoreboard
// serves as `stressStudy`. Measurement only: it fires nothing, pauses nothing and writes nothing.
// Recording a verdict under the page's Results is its own PR. Brain and exec never import it.
//
// Inputs, as the page says:
//   - stress hours + judged hours: the nine main-card coins (RECORDED_COINS), oi:hist (stressHours.mjs);
//   - each read's events: the scoreboard's own generator (axisbt AXES) on the main card (holdout coins
//     left out, as `oos` does) and, separately, on the holdout line, labelled with the main-card hours;
//   - each event's outcome: the R the scoreboard grades it with (axisbt eventsWithR, one builder shared
//     with scoreEvents). An event whose 168h window isn't recorded yet is pending, never a 0.
import { AXES, eventsWithR } from "./axisbt.mjs";
import { STRESS_STUDY, stressHours, judgedHourSet, stressEpisodes } from "./stressHours.mjs";
import { judgeStressStudy } from "./stressGrading.mjs";

export const STRESS_DOC = "docs/research/stress-hours-prereg.md";

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** Each study read's events with R, from the scoreboard's own generator. Unknown read = an error, never []. */
export function studyEvents(sets) {
  const out = {};
  for (const name of STRESS_STUDY.reads) {
    const gen = AXES.find((a) => a.name === name)?.gen;
    if (!gen) throw new Error(`stress study read ${name} is not on the scoreboard`);
    out[name] = eventsWithR(sets, gen).map(({ t, r }) => ({ t, r }));
  }
  return out;
}

/**
 * The study as of `now`.
 * @param {object} a
 * @param {object[]} a.panelSets the nine RECORDED_COINS sets (oi:hist), for the stress hours
 * @param {object[]} a.mainSets the main card without holdout coins (the `oos` population)
 * @param {object[]} a.holdoutSets the holdout line's sets
 */
export function runStressStudy({ panelSets, mainSets, holdoutSets, now = Date.now() }) {
  const hoursMs = stressHours(panelSets).filter((t) => t <= now);
  const judged = judgedHourSet(panelSets);
  const main = studyEvents(mainSets);
  const hold = studyEvents(holdoutSets);
  const events = Object.fromEntries(STRESS_STUDY.reads.map((n) => [n, { main: main[n], holdout: hold[n] }]));
  const j = judgeStressStudy({ hoursMs, judged, events, at: now });
  const startMs = Date.parse(STRESS_STUDY.registeredAt);
  const inStudy = hoursMs.filter((t) => t >= startMs);
  const reads = Object.fromEntries(Object.entries(j.reads).map(([name, r]) => [name, {
    ...r, cutoffT: iso(r.cutoffT), judgedAt: iso(r.judgedAt),
  }]));
  return {
    name: STRESS_STUDY.name, doc: STRESS_DOC,
    registeredAt: STRESS_STUDY.registeredAt, limit: STRESS_STUDY.limit,
    panel: panelSets.map((s) => s.coin), mainCoins: mainSets.map((s) => s.coin), holdoutCoins: holdoutSets.map((s) => s.coin),
    stressHours: inStudy.length,
    episodes: stressEpisodes(inStudy).map((e) => ({ start: iso(e.start), end: iso(e.end), hours: e.hours })),
    atLimit: j.atLimit, familyComplete: j.familyComplete,
    reads,
    note: "Does a registered read grade differently in the 24h after the whole market delevers at once? Measurement only: a verdict licenses at most one reviewed per-read pause PR (WORSE_IN_STRESS), never anything automatic. Counts are out-of-sample from registeredAt; R is the scoreboard's own per-event R, pending until its 168h window is recorded. Holdout counts are shown beside the main line, never pooled or judged. Verdicts are recorded under the page's Results.",
  };
}
