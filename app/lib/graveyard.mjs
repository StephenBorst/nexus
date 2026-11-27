// ── The graveyard: every read that failed, fell back or was dropped, beside what cleared (borst 2026-11-21) ───────────
// "Nothing proves credibility faster than showing the dead next to the few that cleared." One public page
// (/proof/graveyard) built only from records that already exist, each row with the date it broke and the number that
// broke it:
//   - failing   the served 100-event `failing` label on a registered read (a label, not a verdict: reads no longer
//               retire since 2026-11-20, so a failing read keeps running and can recover), dated by the daily watcher's
//               own snapshot (app/lib/failingReads.mjs, generated) or, before that existed, the watcher's git history
//               (FAILING_SEEDS in pipelineWatch.mjs);
//   - fell back a promotion lock: a read whose served stage dropped below the recorded one (PROMOTION_LOCKS, dated);
//   - paper     a recorded 30-trade paper verdict that failed, was reset, or passed without beating random entries;
//   - history   an axis graded on recorded history only (in-sample, never registered) whose mean R is at or below 0;
//   - retired   a final retirement (the Basis × CVD graded exit, RETIRED_GRADED_EXITS);
//   - dropped   a draft read dropped before it was ever registered (the power check), from the drafts' own pages.
// Facts only: no score, no ranking of the dead, no green/red. Unread board = say so, never an empty graveyard.
// Pure; tested in graveyard.test.mjs.

import { isCleared } from "./signalCard.mjs";
import { RETIRED_GRADED_EXITS } from "./proofCopy.mjs";
import { HOUSE_PAPER_IDS } from "./housePaper.mjs";
import { STAGE_RANK } from "./promotionLock.mjs";

/** Drafts dropped before registration, from their own pages (never graded; dropped on the event-count check). */
export const DROPPED_DRAFTS = Object.freeze([
  Object.freeze({ name: "vol_breakout", on: "2026-10-16", doc: "docs/research/explorer-drafts.md", why: "Would have fired about 33 times in 60 days, a third of the event bar. Dropped for v1, never graded." }),
  Object.freeze({ name: "funding_reset", on: "2026-10-27", doc: "docs/research/explorer-drafts-b.md", why: "Failed the event bar at every setting that still meant \"an extreme cleared\". Dropped, never graded." }),
  Object.freeze({ name: "funding_settle_snap", on: "2026-11-07", doc: "docs/research/explorer-drafts-4.md", why: "Its only passing setting wasn't an extreme, and the settlement hours were unconfirmed. Dropped, never graded." }),
  Object.freeze({ name: "level_reclaim_weekly", on: "2026-11-07", doc: "docs/research/explorer-drafts-4.md", why: "Too rare at every setting to reach the event bar. Dropped, never graded." }),
]);

export const GRAVEYARD_LINE =
  "Every read that failed, fell back or was dropped, with the date and the number. Nothing here is hidden or deleted; a failing read keeps running and can recover.";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const labelOf = (axes, name) => (Array.isArray(axes) ? axes.find((a) => a?.name === name)?.label : null) || name;

/**
 * @typedef {{ axis: string, label: string, stage: string, reasons: string[], since: string|null, sinceSource: "watcher"|"git"|null, paperRun: boolean }} FailingRow
 * @typedef {{ axis: string, label: string, verdict: string, trades: number|null, meanR: number|null, randomPct: number|null, randomVerdict: string|null }} HistoryRow
 */

/**
 * @param {{ scorecard?: any, failingReads?: Record<string, {since?: string|null, reasons?: string[]}>,
 *           seeds?: Record<string,string>, locks?: Record<string, any>, judgments?: Record<string, any> }} o
 */
export function graveyard({ scorecard = null, failingReads = {}, seeds = {}, locks = {}, judgments = {} } = {}) {
  const axes = Array.isArray(scorecard?.axes) ? scorecard.axes : null;
  const reads = Array.isArray(scorecard?.pipeline?.reads) ? scorecard.pipeline.reads : null;
  const unread = !axes || !reads;
  const readBy = new Map((reads || []).map((r) => [r.axis, r]));

  /** @type {FailingRow[]} */
  const failing = (reads || [])
    .filter((r) => Array.isArray(r.failing) && r.failing.length)
    .map((r) => {
      const rec = failingReads?.[r.axis];
      const since = rec?.since ?? seeds?.[r.axis] ?? null;
      return { axis: r.axis, label: labelOf(axes, r.axis), stage: r.stage, reasons: r.failing.map(String), since, sinceSource: rec?.since ? "watcher" : seeds?.[r.axis] ? "git" : null, paperRun: !!(r.paperWallet || Object.prototype.hasOwnProperty.call(HOUSE_PAPER_IDS, r.axis)) };
    })
    .sort((a, b) => String(a.since ?? "9").localeCompare(String(b.since ?? "9")) || a.axis.localeCompare(b.axis));

  const fellBack = Object.entries(locks || {})
    .map(([axis, l]) => ({ axis, label: labelOf(axes, axis), lostStage: l.lostStage, on: l.demotedAt ?? null, eventsAtDemotion: num(l.eventsAtDemotion), cleanPasses: num(l.cleanPasses) ?? 0, nowStage: readBy.get(axis)?.stage ?? null, backAtStage: (STAGE_RANK[readBy.get(axis)?.stage] ?? -1) >= (STAGE_RANK[l.lostStage] ?? 99) }))
    .sort((a, b) => String(a.on).localeCompare(String(b.on)) || a.axis.localeCompare(b.axis));

  const paper = Object.entries(judgments || {})
    .filter(([, j]) => j && j.recorded && (j.verdict === "FAIL" || j.verdict === "RESET" || (j.verdict === "PASS" && j.random === "DIDNT_BEAT")))
    .map(([axis, j]) => ({ axis, label: labelOf(axes, axis), verdict: j.verdict, random: j.random ?? null, randomPct: num(j.randomPct) }))
    .sort((a, b) => a.axis.localeCompare(b.axis));

  const registered = new Set((reads || []).map((r) => r.axis));
  /** @type {HistoryRow[]} */
  const history = (axes || [])
    .filter((a) => a && !registered.has(a.name) && num(a.r?.meanR) != null && a.r.meanR <= 0)
    .map((a) => ({ axis: a.name, label: a.label || a.name, verdict: a.verdict, trades: num(a.r?.samples), meanR: num(a.r?.meanR), randomPct: num(a.random?.pooled?.pctBeaten), randomVerdict: a.random?.pooled?.verdict ?? null }))
    .sort((a, b) => a.meanR - b.meanR || a.axis.localeCompare(b.axis));

  const retired = Object.entries(RETIRED_GRADED_EXITS).map(([axis, r]) => ({ axis, label: `${labelOf(axes, axis)} · graded exit`, on: r.on, why: r.why }));
  const dropped = DROPPED_DRAFTS.map((d) => ({ ...d }));

  const cleared = (reads || []).filter((r) => isCleared(r, judgments?.[r.axis], locks)).map((r) => r.axis);
  return {
    unread, cleared,
    counts: { cleared: cleared.length, failing: failing.length, fellBack: fellBack.length, paper: paper.length, history: history.length, retired: retired.length, dropped: dropped.length },
    failing, fellBack, paper, history, retired, dropped,
  };
}

/** "Nov 20, 2026" from an ISO time or a YYYY-MM-DD; null = "not dated yet". */
export function graveDate(iso) {
  if (!iso) return "not dated yet";
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "not dated yet";
}

/** The one-line headline: cleared beside everything that didn't make it. */
export function graveyardHeadline(g) {
  if (!g || g.unread) return "The board is unread right now: the graveyard is built from it, so nothing is listed rather than a partial list.";
  const dead = g.counts.failing + g.counts.fellBack + g.counts.paper + g.counts.history + g.counts.retired + g.counts.dropped;
  return `${g.counts.cleared} cleared. ${dead} on this page: ${g.counts.failing} failing, ${g.counts.fellBack} fell back, ${g.counts.history} lost on recorded history, ${g.counts.retired} retired, ${g.counts.dropped} dropped before testing${g.counts.paper ? `, ${g.counts.paper} failed on paper` : ""}.`;
}
