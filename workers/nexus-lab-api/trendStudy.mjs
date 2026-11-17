// ── The trend gate, wired to the scoreboard (docs/research/trend-gate-prereg.md, signed 2026-11-16) ─────────────────
// Pure. Builds the judge's inputs from the same coin sets /intel/axis-backtest grades, runs the judge (trendGrading.mjs)
// and returns what the scoreboard serves as `trendGate`. Measurement only: it fires nothing, blocks nothing and writes
// nothing. Recording a verdict under the page's Results is its own PR; a block is borst's reviewed PR. Brain and exec
// never import it.
//
// Inputs, as the page says:
//   - BTC's 4h trend: BTC's recorded hourly tape (candle:hist) on the main card, through trendGate.btcTrendByHour;
//   - each read's events + R: the scoreboard's own generator (axisbt AXES) through eventsWithR, on the main card (holdout
//     coins out, as `oos`) and on the holdout line (BTC as context only, as the holdout scorecard), labelled with the
//     same BTC trend. An event whose 168h window isn't recorded yet is pending, never a 0.
// Cost (timed 2026-11-17 on the public series, 19 coins, local node): the events are built ONCE for the stress study and
// this one together (`studyEventsFor`, the union of both read lists), which adds ~90–110 ms a rebuild over the stress
// study alone (its six extra reads); the BTC trend + the judge ~3 ms.
import { AXES, eventsWithR } from "./axisbt.mjs";
import { TREND_GATE_STUDY, btcTrendByHour } from "./trendGate.mjs";
import { judgeTrendGate } from "./trendGrading.mjs";

export const TREND_DOC = "docs/research/trend-gate-prereg.md";

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/**
 * Each listed read's events with side + R from the scoreboard's own generator, built once and shared by both studies.
 * Unknown read = an error, never [].
 * @returns {Record<string, { main: {t:number, coin:string, side:string, r:number|null}[], holdout: object[] }>}
 */
export function studyEventsFor(reads, { mainSets, holdoutSets, ctxSets = null }) {
  const out = {};
  for (const name of reads) {
    const gen = AXES.find((a) => a.name === name)?.gen;
    if (!gen) throw new Error(`study read ${name} is not on the scoreboard`);
    out[name] = { main: eventsWithR(mainSets, gen), holdout: eventsWithR(holdoutSets, gen, ctxSets) };
  }
  return out;
}

/**
 * The study as of `now`.
 * @param {object} a
 * @param {object[]} a.btcCandles BTC's candle:hist (main card)
 * @param {Record<string, {main: object[], holdout: object[]}>} a.events from studyEventsFor (must hold every study read)
 * @param {Record<string, string>} a.registeredAt read → registeredAt (REGISTERED_READS)
 */
export function runTrendStudy({ btcCandles, events, registeredAt, now = Date.now() }) {
  if (!Array.isArray(btcCandles) || !btcCandles.length) throw new Error("BTC tape unread");
  for (const name of TREND_GATE_STUDY.reads) if (!events?.[name]) throw new Error(`events missing for ${name}`);
  const j = judgeTrendGate({ trendByHour: btcTrendByHour(btcCandles), events, registeredAt, at: now });
  const reads = Object.fromEntries(Object.entries(j.reads).map(([name, r]) => [name, {
    ...r, from: iso(r.from), cutoffT: iso(r.cutoffT), judgedAt: iso(r.judgedAt),
  }]));
  return {
    name: "trend_gate", doc: TREND_DOC,
    from: TREND_GATE_STUDY.from, limit: TREND_GATE_STUDY.limit,
    atLimit: j.atLimit, familyComplete: j.familyComplete,
    reads,
    note: "Does a registered read grade worse when it trades against BTC's 4h trend (its close vs the EMA-20 of 4h closes) than with it? Measurement only: a verdict licenses at most one reviewed PR proposing that read's live entries be blocked against the trend (AGAINST_WORSE), never anything automatic, and never trading against the trend. Counts are out-of-sample from the study start and each read's own registration; R is the scoreboard's own per-event R, pending until its 168h window is recorded. Holdout counts are shown beside the main line, never pooled or judged. Verdicts are recorded under the page's Results.",
  };
}
