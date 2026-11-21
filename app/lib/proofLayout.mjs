// The /proof reads half, visual-first (borst 2026-11-21): one status strip, lead cards, paper runs, one board.
// Pure; display only. Same numbers and sources as the board: no new score, no combined metric, no ranking of its own.
//   • The strip's counts come from the board's own groups (signalCard.mjs boardGroups), so they can't drift from it.
//   • A lead card never shows mean R alone: it always sits beside what a random entry made on the same coins and hours.
//     (btc_lead_lag, 2026-11-21: +0.19R, a random entry +0.50R, beat 0% of 300. On its own, +0.19R reads as a winner.)
//   • Gates are drawn as tracks (a dot where the read is now, a tick at the bar), never as a filling progress bar:
//     these numbers move both ways, and a read has several bars at once. They come from the served `gates`
//     (readPipeline.mjs), the same bars as the `next` sentence, which stays the words under them.
//   • Paper is a count of 30, and only where a paper run exists. Otherwise: "no paper run yet".
import { CHART, chartPct, fmtR } from "./engineOverview.mjs";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const r2 = (v) => (num(v) == null ? null : Math.round(v * 100) / 100);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The strip: Cleared · Leads · Still testing, counted from the board's groups (a missing group = 0). */
export function statusCounts(groups) {
  const n = (k) => (Array.isArray(groups) ? groups.find((g) => g.key === k)?.rows?.length ?? 0 : 0);
  return { cleared: n("cleared"), lead: n("lead"), testing: n("testing") };
}

/** A read's mean R beside a random entry's on the same coins and hours (new data, pooled), and the share it beat. */
export function vsRandom(axisRow) {
  const o = axisRow?.oos;
  const p = o?.random?.pooled;
  const meanR = r2(o?.r?.meanR);
  if (meanR == null || !o?.r?.samples) return null;
  return { n: o.r.samples, meanR, randomR: r2(p?.randomMedianR), pct: num(p?.pctBeaten), verdict: p?.verdict ?? null };
}

/** One side of the same: null when the side has no new events. */
export function sideVsRandom(axisRow, side) {
  const o = axisRow?.oos;
  const s = o?.sides?.[side], rb = o?.random?.bySide?.[side];
  if (!s?.events) return null;
  return { n: s.events, meanR: r2(s?.r?.meanR), randomR: r2(rb?.randomMedianR), pct: num(rb?.pctBeaten) };
}

/** "+0.19R vs +0.50R random · beat 0%": the only way a lead's mean R is printed. */
export function vsRandomText(v) {
  if (!v) return null;
  const beat = v.pct == null ? "too few to compare" : `beat ${Math.round(v.pct)}%`;
  return `${fmtR(v.meanR)} vs ${v.randomR == null ? "—" : fmtR(v.randomR)} random · ${beat}`;
}

/** Where to draw a value on the shared R ruler (the same ruler as the engine overview's chart). */
export const rPos = (v) => (num(v) == null ? null : chartPct(v));
export { CHART };

/**
 * One gate as a track: `now` and `bar` as positions (0–100) on the gate's own scale, plus the words.
 *   % → 0–100 · events → 0 to the bar (now capped) · R → the shared R ruler · bps → ±max(|now|, 50) · step → words only.
 */
export function gateTrack(g) {
  if (!g || typeof g !== "object") return null;
  const now = num(g.now), bar = num(g.bar);
  const base = { key: g.key, label: g.label, met: !!g.met };
  if (g.unit === "%" && bar != null) {
    return { ...base, kind: "track", nowPos: now == null ? null : clamp(now, 0, 100), barPos: clamp(bar, 0, 100), nowText: now == null ? "—" : `${Math.round(now * 10) / 10}%`, barText: `${bar}%` };
  }
  if (g.unit === "events" && bar != null && bar > 0) {
    return { ...base, kind: "track", nowPos: now == null ? null : clamp((now / bar) * 100, 0, 100), barPos: 100, nowText: `${now ?? 0}`, barText: `${bar}` };
  }
  if (g.unit === "R" && bar != null) {
    return { ...base, kind: "track", nowPos: rPos(now), barPos: rPos(bar), nowText: fmtR(now), barText: bar === 0 ? "> 0R" : `> ${fmtR(bar)}` };
  }
  if (g.unit === "bps" && bar != null) {
    const span = Math.max(50, Math.abs(now ?? 0), Math.abs(bar));
    const pos = (v) => ((clamp(v, -span, span) + span) / (2 * span)) * 100;
    return { ...base, kind: "track", nowPos: now == null ? null : pos(now), barPos: pos(bar), nowText: now == null ? "—" : `${now > 0 ? "+" : ""}${now} bps`, barText: `> ${bar} bps` };
  }
  return { ...base, kind: "step", nowPos: null, barPos: null, nowText: null, barText: null };
}

/** The paper line on a card: a count of 30 where a run exists, else said plainly. Never R, never dollars. */
export function paperRun(count) {
  if (!count) return { state: "none", text: "No paper run yet" };
  if (count.unread) return { state: "unread", text: "Paper run: unread right now" };
  const n = num(Number(count.count));
  if (n == null) return { state: "none", text: "No paper run yet" };
  const target = num(Number(count.target)) ?? 30;
  return { state: "running", count: n, target, open: !!count.open, text: `Paper run: ${n} of ${target} trades${count.open ? " · 1 open" : ""}` };
}

/**
 * The lead cards, in the board's own order (boardGroups' "lead" rows: furthest stage, then the share beaten, then
 * events). `paperCounts` = GET /signals/paper-counts `runs`, keyed by axis.
 */
export function leadCards(groups, paperCounts = {}) {
  const rows = (Array.isArray(groups) ? groups.find((g) => g.key === "lead")?.rows : null) || [];
  return rows.map(({ a, reg }) => ({
    axis: a.name,
    label: a.label || a.name,
    stage: reg?.stage ?? null,
    events: reg?.numbers?.events ?? a?.oos?.r?.samples ?? 0,
    pooled: vsRandom(a),
    sides: { LONG: sideVsRandom(a, "LONG"), SHORT: sideVsRandom(a, "SHORT") },
    gates: (Array.isArray(reg?.gates) ? reg.gates : []).map(gateTrack).filter(Boolean),
    next: typeof reg?.next === "string" && reg.next.trim() ? reg.next.trim() : null,
    paper: paperRun(paperCounts?.[a.name] ?? null),
  }));
}
