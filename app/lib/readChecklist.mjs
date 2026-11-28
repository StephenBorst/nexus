// ── What a read still needs, in numbers (borst 2026-11-28, pipeline item #2) ─────────────────────────────────────────
// One checklist per registered read, on its Shelf card and its /proof/paper page. No new source of truth:
//   - the next stage's bars = the served `pipeline.reads[].gates` (/intel/axis-backtest, the same rows the daily watcher
//     reads), each with its number now and its bar;
//   - the stages after it = their bars from PIPELINE_RULES (readPipeline.mjs, the code that computes the stage), marked
//     "checked at that stage" because they can't be measured yet;
//   - the CLEARED stretch = the paper count (/signals/paper-counts) and the recorded 30-trade judgment
//     (/signals/paper-judge/:axis): 30 closed paper trades, an after-fees average > 0 (paperJudge.mjs), then ≥ 90% of 300
//     matched random entries finishing under it (badge bar v2, BADGE_BAR in badgeBar.mjs);
//   - the failing label and a promotion lock, when present (both hold the badge back: isCleared).
// CLEARED (isCleared, signalCard.mjs) is the only passed state. Every other row says what is left, in numbers; a row that
// can't be measured yet says why ("needs N more closed trades"). Numbers only: no comparative words. Pure; tested.

import { PIPELINE_RULES, PAPER_MIN_TRADES, STAGES } from "./readPipeline.mjs";
import { BADGE_BAR } from "./badgeBar.mjs";
import { isCleared } from "./signalCard.mjs";

const STAGE_NAME = { REGISTERED: "Still testing", LEAD: "Lead", EDGE: "Edge", TRADEABLE: "Tradeable", PAPER: "Paper" };
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const signed = (v, unit) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}${unit}`;

// The bars each stage adds, from PIPELINE_RULES (the same numbers pipelineStage applies). Words, numbers, no verdicts.
const R = PIPELINE_RULES;
export const STAGE_BARS = Object.freeze({
  LEAD: [`${R.minEvents} out-of-sample events`, "mean R above 0", "both halves of the events agreeing"],
  EDGE: [`≥ ${R.edgePct}% of random entries finishing under its mean R`, `each side with ${R.sideMinEvents}+ events: ≥ ${R.sidePct}% of its own random entries under it`,
    `fresh coins: ${R.holdoutMinEvents} events, mean R above 0, ≥ ${R.holdoutPct}% of random entries under it`],
  TRADEABLE: [`${R.exitMinTrades} trades on the graded exit, net above 0 bps after fees`],
  PAPER: ["its own paper wallet"],
});

// The checklist's own titles for the served gate keys (number words; the served labels can say "beats").
const GATE_TITLE = {
  events: "out-of-sample events", mean_r: "mean R above 0", halves: "both halves agreeing",
  random: "random entries finishing under its mean R", random_long: "longs: random longs finishing under them",
  random_short: "shorts: random shorts finishing under them", holdout_line: "a fresh-coin line", holdout_events: "fresh-coin events",
  holdout_r: "fresh coins: mean R above 0", holdout_random: "fresh coins: random entries finishing under it",
  exit_line: "a graded-exit line", exit_trades: "graded-exit trades", exit_net: "graded exit: net after fees",
  paper_wallet: "its own paper wallet", paper_record: "its own paper record + parity clean",
};

// One served gate as a row: its number now against its bar (readPipeline.mjs `gate`).
function gateRow(g) {
  const now = num(g.now), bar = num(g.bar);
  const met = !!g.met;
  const line = (() => {
    switch (g.key) {
      case "events": case "holdout_events": case "exit_trades":
        return now != null && bar != null ? `${now} of ${bar}${met ? "" : ` · needs ${Math.max(0, bar - now)} more`}` : "unread";
      case "mean_r": case "holdout_r":
        return now != null ? `now ${signed(now, "R")} · needs above 0R` : "unread";
      case "exit_net":
        return now != null ? `now ${signed(now, " bps")} · needs above 0 bps` : "unread";
      case "halves":
        return met ? "the two halves agree" : "the two halves of the events disagree today";
      case "random": case "holdout_random": case "random_long": case "random_short":
        return now != null && bar != null ? `${now}% of random entries under it · needs ≥ ${bar}%` : "unread: no random replays yet";
      case "holdout_line": return "no fresh-coin line yet";
      case "exit_line": return "no graded-exit line yet";
      case "paper_wallet": return "no paper wallet yet (borst sets it up)";
      case "paper_record": return "its own paper record + parity clean: see the paper rows below";
      default: return now != null && bar != null ? `${now} of ${bar}` : "—";
    }
  })();
  return { key: `gate:${g.key}`, title: GATE_TITLE[g.key] || String(g.key).replace(/_/g, " "), state: met ? "met" : "open", line };
}

/** The judged run's closed-trade count: the judgment's own count, else the paper count, else null (unread). */
function judgedCount(judgment, paper) {
  if (judgment && judgment.ok !== false && num(judgment.count) != null) return judgment.count;
  if (judgment?.recorded && Array.isArray(judgment.trades)) return judgment.trades.length;
  if (paper && !paper.unread && num(paper.count) != null) return paper.count;
  return null;
}

/**
 * @param {{ reg: object|null, judgment?: object|null, paper?: {count?:number, target?:number, unread?:boolean}|null,
 *           locks?: Record<string, object> }} o
 *   `judgment` = the /signals/paper-judge/:axis reply ({ok:false, error:"no_judgment"} = no judgment page; null = unread;
 *   undefined = not fetched, which is fine while the run is under 30 trades: the count says what is left).
 * @returns {{ cleared: boolean, unread?: boolean, stage?: string, stageName?: string, head?: string,
 *             rows: {key:string, title:string, state:"met"|"open"|"later"|"unread", line:string, group:string}[] }}
 */
export function readChecklist({ reg, judgment = undefined, paper = null, locks = {} } = {}) {
  if (!reg || !reg.axis || !STAGES.includes(reg.stage)) return { cleared: false, unread: true, rows: [] };
  const slim = judgment && judgment.ok !== false ? {
    recorded: judgment.recorded === true, verdict: judgment.verdict,
    random: judgment.randomCheck?.verdict ?? judgment.random, randomPct: judgment.randomCheck?.pctBeaten ?? judgment.randomPct ?? null,
  } : null;
  const cleared = isCleared(reg, slim, locks);
  const rows = [];
  const at = STAGES.indexOf(reg.stage);

  // 1. The next stage: its served bars, numbers now vs bar.
  if (reg.stage !== "PAPER") {
    const next = STAGES[at + 1];
    for (const g of Array.isArray(reg.gates) ? reg.gates : []) rows.push({ ...gateRow(g), group: `To reach ${STAGE_NAME[next]}` });
  }
  // 2. The stages after the next one: their bars, checked when the read gets there.
  for (const st of STAGES.slice(at + 2)) {
    for (const bar of STAGE_BARS[st]) rows.push({ key: `later:${st}:${bar}`, title: bar, state: "later", line: "checked at that stage", group: `Then ${STAGE_NAME[st]}` });
  }

  // 3. The CLEARED stretch: 30 paper trades → after-fees average > 0 → ≥ 90% of random entries under it.
  const group = "Then CLEARED";
  const n = judgedCount(judgment, paper);
  const target = num(judgment?.target) ?? num(paper?.target) ?? PAPER_MIN_TRADES;
  rows.push(n == null
    ? { key: "paper:count", title: `${target} closed paper trades`, state: "unread", line: "paper record unread right now", group }
    : { key: "paper:count", title: `${target} closed paper trades`, state: n >= target ? "met" : "open", line: n >= target ? `${n} of ${target}` : `${n} of ${target} · needs ${target - n} more closed trades`, group });

  const v = judgment && judgment.ok !== false ? judgment.verdict : null;
  const bps = num(judgment?.meanNetBps);
  const after = (() => {
    if (judgment === undefined && n != null && n < target) return { state: "later", line: `checked at ${target} trades · needs ${target - n} more closed trades` };
    if (judgment == null) return { state: "unread", line: "the judgment couldn’t be read right now" };
    if (judgment.ok === false) return { state: "later", line: n != null && n < target ? `checked at ${target} trades · needs ${target - n} more closed trades` : "no signed judgment page for this run yet" };
    if (v === "PASS") return { state: "met", line: `${signed(bps ?? 0, " bps")} a trade after fees and funding` };
    if (v === "FAIL") return { state: "open", line: `${signed(bps ?? 0, " bps")} a trade after fees and funding · needs above 0 · final for this run` };
    if (v === "RESET") return { state: "open", line: "the run was reset after its page was signed · a new dated page is needed" };
    if (v === "HELD") return { state: "open", line: `held: parity ${judgment.parity || "not clean"} over the 30 trades` };
    if (v === "PENDING") return { state: "later", line: judgment.reason || "the 30th trade is in; waiting on the tape and parity checks" };
    if (v === "LOST") return { state: "open", line: judgment.reason || "the first trades fell out of the record before a verdict" };
    return { state: "later", line: n != null && n < target ? `checked at ${target} trades · needs ${target - n} more closed trades` : `checked at ${target} trades` };
  })();
  rows.push({ key: "paper:afterfees", title: "after-fees average above 0 bps", ...after, group });

  const rc = judgment?.randomCheck || null;
  const rnd = (() => {
    if (v !== "PASS") return { state: "later", line: "checked once the after-fees average is recorded above 0" };
    if (!rc || rc.verdict === "UNREAD") return { state: "unread", line: `random replays unread (needs ${BADGE_BAR.minUsable} of ${BADGE_BAR.runs} usable)` };
    return { state: rc.verdict === "BEAT" ? "met" : "open", line: `${num(rc.pctBeaten) ?? "—"}% of ${BADGE_BAR.runs} under it · needs ≥ ${BADGE_BAR.beatPct}%` };
  })();
  rows.push({ key: "paper:random", title: `≥ ${BADGE_BAR.beatPct}% of ${BADGE_BAR.runs} random entries finishing under it`, ...rnd, group });

  // What else holds the badge back today.
  if (Array.isArray(reg.failing) && reg.failing.length) {
    rows.push({ key: "hold:failing", title: "the failing label lifted (the 100-event check)", state: "open", line: reg.failing.map(String).join(" · "), group: "Also" });
  }
  const lock = locks && Object.prototype.hasOwnProperty.call(locks, reg.axis) ? locks[reg.axis] : null;
  if (lock) {
    rows.push({ key: "hold:lock", title: "promotion lock cleared", state: "open",
      line: `${num(lock.cleanPasses) ?? 0} of 2 clean daily reads ≥ 7 days apart + 15 new events since it fell back`, group: "Also" });
  }

  if (cleared) return { cleared: true, stage: reg.stage, stageName: STAGE_NAME[reg.stage], head: "CLEARED", rows: rows.map((r) => ({ ...r, state: "met" })) };
  const left = rows.filter((r) => r.state !== "met").length;
  return { cleared: false, stage: reg.stage, stageName: STAGE_NAME[reg.stage], head: `${STAGE_NAME[reg.stage]} · ${left} requirement${left === 1 ? "" : "s"} left`, rows };
}

/** The mark beside a row: ✓ met · ○ open · … later · ? unread. Shapes, never colour. */
export const ROW_MARK = Object.freeze({ met: "✓", open: "○", later: "…", unread: "?" });
