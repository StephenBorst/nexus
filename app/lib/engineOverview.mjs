// The engine overview on /proof (borst 2026-11-17, pipeline-if-then.md "Engine overview"): the market the reads ran in,
// each registered read's NEW-DATA sides against a random entry on that side, and the paper runs as counts. One copy of
// the rules for /proof and the weekly review (tools/review/engineReview.mjs). Pure; display only. Every sentence follows
// a fixed rule from the numbers beside it: a side is judged against its random entry, never zero; paper runs are
// counts and per-trade outcomes, never a sum or average of R before their 30-trade judgment, never dollars.

import { PIPELINE_RULES } from "./readPipeline.mjs";

const SIDES = ["LONG", "SHORT"];
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const r2 = (v) => (num(v) == null ? null : Math.round(v * 100) / 100);
export const fmtR = (v) => (num(v) == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}R`);
const pctTxt = (p) => (num(p) == null ? "—" : `${Math.round(p)}%`);
const lower = (s) => s.toLowerCase();

/** The chart's fixed R scale, so every row is drawn on one ruler. */
export const CHART = Object.freeze({ min: -1, max: 1.6, ticks: Object.freeze([-1, -0.5, 0, 0.5, 1, 1.5]) });
export const chartPct = (v) => ((Math.max(CHART.min, Math.min(CHART.max, v)) - CHART.min) / (CHART.max - CHART.min)) * 100;

/** One side of a read's out-of-sample block: events, its mean R, the random entry's median R, % of replays beaten. */
export function sideStat(o, side) {
  const s = o?.sides?.[side], rb = o?.random?.bySide?.[side];
  const n = s?.events ?? 0;
  if (!n) return null;
  return { n, meanR: r2(s?.r?.meanR), randomR: r2(rb?.randomMedianR), pct: num(rb?.pctBeaten) };
}

/** One plain sentence per side, by rule. Never a grade the board doesn't give. */
export function sideWords(side, s) {
  if (!s) return null;
  const S = side === "LONG" ? "Longs" : "Shorts", w = lower(side);
  if (s.n < 10 || s.pct == null) return `${S}: ${s.n} event${s.n === 1 ? "" : "s"}, too few to compare.`;
  if (s.pct >= 95) return `${S} beat random ${w}s (${pctTxt(s.pct)} of replays)${s.meanR != null && s.meanR < 0 ? ", and still lost money" : ""}.`;
  if (s.meanR != null && s.meanR > 0 && s.pct < 50) return `${S} made money but trailed random ${w}s (${pctTxt(s.pct)}): the market did the work.`;
  if (s.meanR != null && s.meanR < 0 && s.pct >= 50) return `${S} lost less than random ${w}s (${pctTxt(s.pct)}), but lost.`;
  if (s.pct <= 5) return `${S} did worse than random ${w}s (${pctTxt(s.pct)}).`;
  return `${S} look like random ${w}s (${pctTxt(s.pct)}).`;
}

/** What a random long / short earned on the board's whole window. Null when unread (never a 0). */
export function tideOf(board) {
  const L = board?.tide?.LONG?.meanR, S = board?.tide?.SHORT?.meanR;
  if (num(L) == null || num(S) == null) return null;
  return { long: r2(L), short: r2(S), from: board.tide.from ?? null, to: board.tide.to ?? null, markets: board.tide.markets ?? null };
}

/** BTC's own 30-day return and the regime window's day counts (the scoreboard's `regimeWindow.regime`). */
export function btcRegime(board) {
  const rg = board?.regimeWindow?.regime;
  const days = Array.isArray(rg?.days) ? rg.days : [];
  const last = days[days.length - 1];
  if (!last || num(last.retPct) == null) return null;
  return { day: last.day, ret30: r2(last.retPct), state: last.state ?? null, counts: rg.counts ?? null, since: days[0]?.day ?? null };
}

const holdoutAxes = (board) => new Map((Array.isArray(board?.holdout?.axes) ? board.holdout.axes : Object.values(board?.holdout?.axes || {})).map((a) => [a.name, a]));

/**
 * One row per registered read. `line` = "main" (the 9 main coins + the board's own stage) or "holdout" (the 8 coins it
 * was never picked on). Events / mean R / sides are NEW DATA only (since the read's registration).
 */
export function overviewReads(board, { line = "main", minEvents = 30 } = {}) {
  if (!board || !Array.isArray(board.axes) || !board.pipeline) return [];
  const axes = new Map(board.axes.map((a) => [a.name, a]));
  const hold = holdoutAxes(board);
  return (board.pipeline.reads || []).map((r) => {
    const o = (line === "holdout" ? hold.get(r.axis) : axes.get(r.axis))?.oos;
    const n = r.numbers || {};
    const events = line === "holdout" ? (n.holdoutEvents ?? o?.r?.samples ?? 0) : (n.events ?? 0);
    const meanR = events ? r2(line === "holdout" ? (n.holdoutMeanR ?? o?.r?.meanR) : n.meanR) : null;
    const sides = Object.fromEntries(SIDES.map((s) => [s, sideStat(o, s)]));
    const words = [];
    if (line === "main" && Array.isArray(r.failing) && r.failing.length) words.push("Failing the 100-event check. Still running.");
    else if (line === "main" && events < minEvents) words.push(`${minEvents - events} more new events before it is graded.`);
    for (const s of SIDES) { const w = sideWords(s, sides[s]); if (w && events >= 10) words.push(w); }
    return { axis: r.axis, label: axes.get(r.axis)?.label ?? r.axis, stage: r.stage, side: r.side ?? "BOTH", next: r.next ?? null,
      registeredAt: r.registeredAt ?? null, events, meanR, sides, words };
  });
}

/**
 * Sides that beat their own random entry on BOTH coin sets (new data). The bars are the served pipeline's (a side
 * needs `sideMinEvents` on each set and `edgePct` on each), the same numbers the stage uses: never a second copy.
 */
export function strongSides(board) {
  const rules = board?.pipeline?.rules || {};
  const minN = num(rules.sideMinEvents) ?? PIPELINE_RULES.sideMinEvents, bar = num(rules.edgePct) ?? PIPELINE_RULES.edgePct;
  const main = new Map(overviewReads(board, { line: "main" }).map((r) => [r.axis, r]));
  const out = [];
  for (const h of overviewReads(board, { line: "holdout" })) {
    const m = main.get(h.axis);
    for (const s of SIDES) {
      const a = m?.sides[s], b = h.sides[s];
      if (a?.n >= minN && b?.n >= minN && a.pct >= bar && b.pct >= bar) out.push({ axis: h.axis, side: s });
    }
  }
  return out;
}

/** Rows a chart can draw for one side: 5+ new events with both the read's and the random entry's R. */
export function chartRows(rows, side) {
  return rows.filter((r) => r.sides[side]?.n >= 5 && r.sides[side].meanR != null && r.sides[side].randomR != null)
    .map((r) => ({ axis: r.axis, ...r.sides[side] }));
}

/**
 * A paper run as a card: n of 30, each closed trade's outcome (coin, side, how it closed), the open trade, the tape line
 * and the judgment status. No R sums, no averages, no dollars: those wait for the 30-trade judgment.
 */
export function paperCard(axis, run, judge) {
  if (!run || !Array.isArray(run.trades)) return { axis, unread: true };
  const tally = run.tally || {};
  return {
    axis, count: run.count ?? run.trades.length, target: run.target ?? 30, startedAt: run.startedAt ?? null,
    trades: run.trades.map((t) => ({ coin: t.coin, side: t.side, outcome: t.outcome, reason: t.reason })),
    open: run.open ? { coin: run.open.coin, side: run.open.side, entry: run.open.entry, openedAt: run.open.openedAt ?? null } : null,
    targets: tally.win ?? 0, stops: tally.loss ?? 0, timeStops: tally.time ?? 0,
    tape: run.tape?.line ?? null, verdict: judge?.verdict ?? null,
  };
}
