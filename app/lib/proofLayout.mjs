// The /proof reads half, visual-first (borst 2026-11-21): one status strip, lead cards, paper runs, one board.
// Pure; display only. Same numbers and sources as the board: no new score, no combined metric, no ranking of its own.
//   • The strip's counts come from the board's own groups (signalCard.mjs boardGroups), so they can't drift from it.
//   • A lead card never shows mean R alone: it always sits beside what a random entry made on the same coins and hours.
//     (btc_lead_lag, 2026-11-21: +0.19R, a random entry +0.50R, beat 0% of 300. On its own, +0.19R reads as a winner.)
//   • Gates are drawn as tracks (a dot where the read is now, a tick at the bar), never as a filling progress bar:
//     these numbers move both ways, and a read has several bars at once. They come from the served `gates`
//     (readPipeline.mjs), the same bars as the `next` sentence, which stays the words under them.
//   • Paper is a count of 30, and only where a paper run exists. Otherwise: "no paper run yet".
//   • Plain words (borst 2026-11-21, "way too complicated for a normie"): a read vs random is said in words
//     (`randomWord`, the backtest's own baselineVerdict cutoffs), each remaining bar is one plain sentence with its number
//     now (`gateLine`), and "Every read vs random trades" is cards of word chips (`vsRandomCards`), not a ruler.
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
 * A read (or one side) against 300 random trades on the same coins, side and hours, in words. The cutoffs are the
 * backtest's own `baselineVerdict` (95 / 80 / 5, pinned by test); under 5 trades is "too few".
 */
export const RANDOM_WORDS = Object.freeze({
  BEATS: "Beats random", LEANS: "Leaning better", SAME: "No better than random", WORSE: "Worse than random", FEW: "Too few trades yet",
});
export function randomWord(pct, n) {
  const p = num(pct);
  if (p == null || !(num(n) >= 5)) return { key: "FEW", text: RANDOM_WORDS.FEW };
  const key = p >= 95 ? "BEATS" : p >= 80 ? "LEANS" : p <= 5 ? "WORSE" : "SAME";
  return { key, text: RANDOM_WORDS[key] };
}

/** "Beat random trades 61% of the time." — the one sentence a card leads with. */
export function beatSentence(pct) {
  const p = num(pct);
  return p == null ? "Too few trades to compare with random yet." : `Beat random trades ${Math.round(p)}% of the time.`;
}

const pctText = (v) => (num(v) == null ? "—" : `${Math.round(v * 10) / 10}%`);
/**
 * One bar still in the way, as one plain sentence + where the read is now. From the served `gates` (readPipeline.mjs),
 * the same bars as the `next` sentence. "Fresh coins" = the holdout: coins it was never picked on.
 */
export function gateLine(g) {
  if (!g || typeof g !== "object") return null;
  const now = num(g.now), bar = num(g.bar);
  const side = /^random_(long|short)$/.exec(g.key || "")?.[1];
  let text, nowText = null;
  switch (side ? "random_side" : g.key) {
    case "events": text = `${bar ?? 30} new trades to judge it on`; nowText = `${now ?? 0} so far`; break;
    case "mean_r": text = "Makes money on average (above 0R)"; nowText = fmtR(now); break;
    case "halves": text = "Holds up in both halves of the data"; break;
    case "random": text = `Beats random trades ${bar ?? 95}% of the time`; nowText = pctText(now); break;
    case "random_side": text = `Its ${side}s beat random ${side}s ${bar ?? 50}% of the time`; nowText = pctText(now); break;
    case "holdout_line": text = "Tested on fresh coins"; break;
    case "holdout_events": text = `${bar ?? 30} trades on fresh coins`; nowText = `${now ?? 0} so far`; break;
    case "holdout_r": text = "Makes money on fresh coins too"; nowText = fmtR(now); break;
    case "holdout_random": text = `Beats random ${bar ?? 80}% of the time on fresh coins`; nowText = pctText(now); break;
    case "exit_line": text = "Tested with real exits"; break;
    case "exit_trades": text = `${bar ?? 30} trades with real exits`; nowText = `${now ?? 0} so far`; break;
    case "exit_net": text = "Makes money after fees"; nowText = now == null ? "—" : `${now > 0 ? "+" : ""}${now} bps`; break;
    case "paper_wallet": text = "A paper wallet running it"; break;
    case "paper_record": text = "30 paper trades, judged after fees"; break;
    default: text = String(g.label || g.key || "");
  }
  return { key: g.key, text, nowText, met: !!g.met };
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
    gates: (Array.isArray(reg?.gates) ? reg.gates : []).map(gateLine).filter(Boolean),
    next: typeof reg?.next === "string" && reg.next.trim() ? reg.next.trim() : null,
    paper: paperRun(paperCounts?.[a.name] ?? null),
  }));
}

/**
 * "Every read vs random trades" as cards: each read's two sides as word chips, from engineOverview's `overviewReads`
 * rows (new data only, main coins or the fresh ones). Best first: by the best side's share beaten (sides with 5+
 * trades), then trades; a read with no side at 5+ trades sits last. No ruler, no combined score.
 */
export function vsRandomCards(rows) {
  const SIDES = ["LONG", "SHORT"];
  const cards = (Array.isArray(rows) ? rows : []).map((r) => {
    const sides = Object.fromEntries(SIDES.map((s) => {
      const v = r?.sides?.[s] || null;
      const n = num(v?.n) ?? 0;
      return [s, { n, pct: num(v?.pct), meanR: num(v?.meanR), randomR: num(v?.randomR), word: randomWord(v?.pct, n) }];
    }));
    const counted = SIDES.map((s) => sides[s]).filter((x) => x.word.key !== "FEW");
    const best = counted.length ? Math.max(...counted.map((x) => x.pct)) : null;
    const trades = SIDES.reduce((t, s) => t + sides[s].n, 0);
    return { axis: r.axis, label: r.label || r.axis, sides, best, trades };
  });
  return cards.sort((a, b) => (b.best ?? -1) - (a.best ?? -1) || b.trades - a.trades);
}
