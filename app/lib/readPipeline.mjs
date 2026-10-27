// ── The read pipeline: how a hypothesis earns its way from the scoreboard to a paper wallet ───
// borst, 2026-10-16: "scoreboard first, wallets only for reads that pass; the 5-stage pipeline with
// kill rules and the backfill marked in-sample; holdout replication as the bar for testing 10 at
// once." Rules + registrations live HERE, once; docs/research/read-pipeline.md says the same in
// words and readPipeline.test.mjs pins the two together. The scoreboard (axisbt.mjs) computes
// each registered read's OUT-OF-SAMPLE grade (events after its registration) and this module
// turns that into a stage. Display + bookkeeping only: nothing here trades.
//
// The stages (every bar is out-of-sample, i.e. events after `registeredAt`):
//   REGISTERED  rule frozen, accruing. The scoreboard's back-graded history is IN-SAMPLE and never
//               counts toward a stage.
//   LEAD        ≥ minEvents R-graded events, mean R > 0, first half and second half agree in sign.
//   EDGE        LEAD + beats ≥ edgePct of random entries on its own side (main card; a two-sided read,
//               side "BOTH", on the pooled result)
//               + REPLICATES on the holdout coins: ≥ holdoutMinEvents, mean R > 0, beats ≥
//               holdoutPct of random entries on the same side. Replication is the multiple-testing
//               guard (borst's pick): a read that only works on the coins it was found on stops here.
//   TRADEABLE   EDGE + the graded exit, as the agent trades it (fees, market close at 168h, one
//               position per market), nets > 0 over ≥ exitMinTrades out-of-sample trades.
//   PAPER       TRADEABLE + a paper wallet set up for it (its own record + parity). Live money is a
//               separate review, always.
//   RETIRED     at ≥ killEvents out-of-sample events on the main card OR the holdout: mean R ≤ 0,
//               or worse than random (BELOW_RANDOM) on its side. Shown publicly; never re-tuned.
//               A changed rule = a NEW registration with a new date and a new name.

export const PIPELINE_RULES = Object.freeze({
  minEvents: 30,
  edgePct: 95,
  holdoutMinEvents: 30,
  holdoutPct: 80,
  exitMinTrades: 30,
  killEvents: 100,
});

export const STAGES = Object.freeze(["REGISTERED", "LEAD", "EDGE", "TRADEABLE", "PAPER", "RETIRED"]);

// Each registration: the scoreboard axis that IS the rule (frozen in code), the side it trades,
// the moment from which its events count (always in the future when written, so nothing counted
// was seen first), the doc that registered it, whether it gets a holdout line and a graded-exit
// line, and a paper wallet once it has earned one.
export const REGISTERED_READS = Object.freeze([
  Object.freeze({
    axis: "rsi_reset_deep",
    side: "LONG",
    registeredAt: "2026-10-17T00:00:00Z",
    doc: "docs/research/rsi-reset-deep-prereg.md",
    holdout: true,
    gradedExit: true,
    paperWallet: null,
  }),
  // The four explorer reads borst froze and signed off 2026-10-16 (docs/research/explorers-prereg.md).
  // Two-sided reads: judged on the pooled random result. vol_breakout was dropped (power check: 33/60d).
  ...["level_reclaim", "oi_div_reversal", "session_momentum", "confluence_follow"].map((axis) => Object.freeze({
    axis,
    side: "BOTH",
    registeredAt: "2026-10-17T00:00:00Z",
    doc: "docs/research/explorers-prereg.md",
    holdout: true,
    gradedExit: true,
    paperWallet: null,
  })),
  // Batch 2, signed by borst 2026-10-27 (docs/research/oi-div-reversal-4h-prereg.md): the 24h
  // oi_div_reversal rule on a 4h window, OI −2%, 12h cooldown. Out-of-sample from 2026-10-28T00:00Z.
  Object.freeze({
    axis: "oi_div_reversal_4h",
    side: "BOTH",
    registeredAt: "2026-10-28T00:00:00Z",
    doc: "docs/research/oi-div-reversal-4h-prereg.md",
    holdout: true,
    gradedExit: true,
    paperWallet: null,
  }),
  // Batch 2, signed by borst 2026-10-27 (docs/research/oi-coil-break-prereg.md): OI builds into a flat
  // tape, the range break is followed; OI +3%. Out-of-sample from 2026-10-28T00:00Z.
  Object.freeze({
    axis: "oi_coil_break",
    side: "BOTH",
    registeredAt: "2026-10-28T00:00:00Z",
    doc: "docs/research/oi-coil-break-prereg.md",
    holdout: true,
    gradedExit: true,
    paperWallet: null,
  }),
]);

export const registeredMs = (reg) => Date.parse(reg.registeredAt);
export const registrationFor = (axis) => REGISTERED_READS.find((r) => r.axis === axis) || null;

// A one-sided read is judged on its side; a two-sided read ("BOTH") on the pooled result (longs and
// shorts together, each still re-drawn on its own side), with the per-side split shown beside it.
const sideOf = (random, side) => (side === "BOTH" ? random?.pooled : random?.bySide?.[side]) || null;
const sideWord = (side) => (side === "BOTH" ? "entries" : `${side.toLowerCase()}s`);
const pct = (b) => (b && Number.isFinite(b.pctBeaten) ? b.pctBeaten : null);

/**
 * @param reg      a REGISTERED_READS entry
 * @param oos      the scoreboard row for this axis graded on out-of-sample events only (main card)
 * @param holdout  the holdout line's row for this axis, out-of-sample events only (or null)
 * @returns {{ stage, reasons: string[], next: string|null, numbers }}
 */
export function pipelineStage(reg, oos, holdout, rules = PIPELINE_RULES) {
  const side = reg.side;
  const r = oos?.r || { samples: 0, meanR: 0, stable: false };
  const rnd = sideOf(oos?.random, side);
  const hr = holdout?.r || { samples: 0, meanR: 0 };
  const hRnd = sideOf(holdout?.random, side);
  const ex = oos?.exitGraded || null;
  const numbers = {
    events: r.samples, meanR: r.meanR, stable: !!r.stable, beatsRandomPct: pct(rnd),
    holdoutEvents: hr.samples, holdoutMeanR: hr.meanR, holdoutBeatsRandomPct: pct(hRnd),
    exitTrades: ex ? ex.samples : 0, exitNetBps: ex ? ex.netBps : null,
  };
  const reasons = [];

  // RETIRED first: a dead read stays dead however the other line looks.
  const dead = (n, meanR, b) => n >= rules.killEvents && (meanR <= 0 || (b && b.verdict === "BELOW_RANDOM"));
  if (dead(r.samples, r.meanR, rnd)) reasons.push(`main card: ${r.samples} events, mean R ${r.meanR}${rnd?.verdict === "BELOW_RANDOM" ? ", worse than random" : ""}`);
  if (reg.holdout && dead(hr.samples, hr.meanR, hRnd)) reasons.push(`holdout: ${hr.samples} events, mean R ${hr.meanR}${hRnd?.verdict === "BELOW_RANDOM" ? ", worse than random" : ""}`);
  if (reasons.length) return { stage: "RETIRED", reasons, next: null, numbers };

  if (r.samples < rules.minEvents) return { stage: "REGISTERED", reasons, next: `${rules.minEvents - r.samples} more out-of-sample events`, numbers };
  if (!(r.meanR > 0 && r.stable)) return { stage: "REGISTERED", reasons: [`mean R ${r.meanR}${r.stable ? "" : ", halves disagree"}`], next: "mean R > 0 with both halves agreeing", numbers };

  // LEAD reached. EDGE needs both the main-card random test and the holdout replication.
  const mainOk = pct(rnd) != null && pct(rnd) >= rules.edgePct;
  const holdOk = reg.holdout && hr.samples >= rules.holdoutMinEvents && hr.meanR > 0 && pct(hRnd) != null && pct(hRnd) >= rules.holdoutPct;
  if (!mainOk || !holdOk) {
    const need = [];
    if (!mainOk) need.push(`beat ${rules.edgePct}% of random ${sideWord(side)} (now ${pct(rnd) ?? "—"}%)`);
    if (!reg.holdout) need.push("a holdout line");
    else if (hr.samples < rules.holdoutMinEvents) need.push(`${rules.holdoutMinEvents - hr.samples} more holdout events`);
    else if (!holdOk) need.push(`holdout mean R > 0 and ≥ ${rules.holdoutPct}% vs random (now ${hr.meanR}R, ${pct(hRnd) ?? "—"}%)`);
    return { stage: "LEAD", reasons, next: need.join(" · "), numbers };
  }

  const exitOk = reg.gradedExit && ex && ex.samples >= rules.exitMinTrades && ex.netBps > 0;
  if (!exitOk) {
    const next = !reg.gradedExit ? "a graded-exit line" : !ex || ex.samples < rules.exitMinTrades ? `${rules.exitMinTrades - (ex?.samples || 0)} more graded-exit trades` : `graded exit net > 0 (now ${ex.netBps} bps)`;
    return { stage: "EDGE", reasons, next, numbers };
  }
  if (!reg.paperWallet) return { stage: "TRADEABLE", reasons, next: "a paper wallet (borst sets it up)", numbers };
  return { stage: "PAPER", reasons, next: "its own paper record + parity CLEAN; live money is a separate review", numbers };
}
