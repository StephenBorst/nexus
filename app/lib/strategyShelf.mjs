// ── The strategy shelf: every strategy on the way to the agent, and how far it has to go ──────
// borst, 2026-10-26: "strategy shelf in the Agent tab. Load enabled only at PAPER, everything else
// greyed with the reason."
//
// Display only. Stages come from GET /intel/axis-backtest as served (`pipeline.reads[].stage`, rules
// in readPipeline.mjs) and the Basis × CVD graded-exit line is judged by the same bar the pipeline
// watcher uses (pipelineWatch.mjs `gradedExitStatus`, from graded-exit-prereg.md). Nothing here
// grades, and a row can only Load when its stage is PAPER AND an agent preset trades its exact rule
// (`SHELF_PRESETS`, empty today: no read has an agent rule yet). The dates are rough: today's event
// pace carried forward, labelled as such, for a count only (never for a stage).

import { gradedExitStatus, GRADED_EXIT_AXIS } from "./pipelineWatch.mjs";
import { GRADED_EXIT_OOS_CUTOFF_MS } from "./gradedExit.mjs";
import { retiredGradedExit, retiredLine } from "./proofCopy.mjs";
import { REGIME_WINDOW, REGIME_RESULT, judgeRegimeWindow, regimeFromMs } from "./regimeWindow.mjs";

// Registered read (scoreboard axis) → the preset id that trades its exact rule. A read joins this map
// in its own reviewed PR, after the parity test the pipeline page asks for at Edge. Empty until then.
export const SHELF_PRESETS = Object.freeze({});

const LADDER = ["REGISTERED", "LEAD", "EDGE", "TRADEABLE", "PAPER"];
const DAY = 86400000;
const WORD = { REGISTERED: "Testing", LEAD: "Lead", EDGE: "Edge", TRADEABLE: "Tradeable", PAPER: "Paper", RETIRED: "Retired" };

const fmtDay = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// When `have` reaches `have + more`, at the pace `have` was reached since `sinceMs`. Null when the
// pace can't be read (under a day of data, or nothing yet).
export function etaAtPace(have, more, sinceMs, now) {
  const days = (now - sinceMs) / DAY;
  if (!(have > 0) || !(more > 0) || !(days >= 1)) return null;
  return now + (more / (have / days)) * DAY;
}

// The count a `next` line asks for, and which counter it is: "20 more out-of-sample events",
// "12 more holdout events", "26 more graded-exit trades" (the grader's own words, readPipeline.mjs).
export function countNeeded(next) {
  const s = String(next || "");
  const m = s.match(/(\d+) more (out-of-sample events|holdout events|graded-exit trades)/);
  if (!m) return null;
  const counter = m[2] === "holdout events" ? "holdoutEvents" : m[2] === "graded-exit trades" ? "exitTrades" : "events";
  return { more: Number(m[1]), counter };
}

function readRow(reg, labels, now, killEvents) {
  const n = reg.numbers || {};
  const since = Date.parse(reg.registeredAt);
  const stage = reg.stage;
  const failing = stage === "REGISTERED" && (n.events || 0) >= 30 && !countNeeded(reg.next);
  let need = reg.next || "";
  let eta = null;
  const c = countNeeded(reg.next);
  if (c) {
    const at = etaAtPace(n[c.counter] || 0, c.more, since, now);
    if (at) eta = `~${fmtDay(at)} at today's pace`;
  } else if (failing && (n.events || 0) < killEvents) {
    const at = etaAtPace(n.events || 0, killEvents - n.events, since, now);
    need = `${need}. Retired at ${killEvents} events unless it recovers`;
    if (at) eta = `${killEvents} events ~${fmtDay(at)}`;
  }
  const presetId = SHELF_PRESETS[reg.axis] || null;
  const canLoad = stage === "PAPER" && !!presetId;
  const reason = canLoad ? ""
    : stage === "RETIRED" ? "Retired. It stays on the record and never loads."
    : stage === "PAPER" ? "At Paper, but no agent preset trades this rule yet."
    : failing ? "Failing its test. Loads only at Paper."
    : `${WORD[stage] || stage}. Loads only at Paper.`;
  return {
    id: reg.axis, kind: "read", name: labels[reg.axis] || reg.axis, stage,
    stageWord: failing ? "Failing" : (WORD[stage] || stage), need, note: "", eta, canLoad, presetId, reason,
  };
}

function exitRow(axis, now) {
  // Retired under its own bar: final, whatever the read grades today.
  const retired = retiredGradedExit(GRADED_EXIT_AXIS);
  if (retired) {
    return {
      id: `${GRADED_EXIT_AXIS}:graded-exit`, kind: "exit", name: "Basis × CVD, graded exit",
      stage: "RETIRED", stageWord: "Retired", need: "", note: retiredLine(retired), eta: null,
      canLoad: false, presetId: null, reason: "Retired. It stays on the record and never loads.",
    };
  }
  const ge = gradedExitStatus(axis);
  if (!ge) return null;
  const word = { NOT_YET: "Testing the exit", CLEARS: "Cleared", FAILS: "Failed its bar" }[ge.status];
  let eta = null;
  if (ge.status === "NOT_YET" && ge.numbers.trades < 30) {
    const at = etaAtPace(ge.numbers.trades, 30 - ge.numbers.trades, GRADED_EXIT_OOS_CUTOFF_MS, now);
    if (at) eta = `~${fmtDay(at)} at today's pace`;
  }
  return {
    id: `${GRADED_EXIT_AXIS}:graded-exit`, kind: "exit", name: "Basis × CVD, graded exit",
    stage: ge.status === "CLEARS" ? "TRADEABLE" : ge.status === "FAILS" ? "RETIRED" : "REGISTERED",
    stageWord: word,
    // "Needs …" only while it is counting; a verdict is a plain note.
    need: ge.status === "NOT_YET" ? ge.reason : "",
    note: ge.status === "FAILS" ? `Fails its bar: ${ge.reason}.` : ge.status === "CLEARS" ? `Clears its bar: ${ge.reason}.` : "",
    eta, canLoad: false, presetId: null,
    reason: ge.status === "FAILS"
      ? "Failed the bar it was registered with. Its paper wallet stays as a record."
      : ge.status === "CLEARS" ? "Cleared. A paper-only preset gets proposed in its own PR. Loads only at Paper."
      : "Its exit is still being tested. Loads only at Paper.",
  };
}

/** Every shelf row from a served scorecard, closest to Paper first, retired last. [] when unreadable. */
// The Basis × CVD regime window (docs/research/graded-exit-regime-prereg.md, signed 2026-10-26): judged
// by the same rule the watcher uses (judgeRegimeWindow). A recorded result (REGIME_RESULT) is final and
// wins over the live numbers. It never loads: a clear only lets a paper-only preset be proposed.
const REGIME_WORD = { COUNTING: "Testing", CLEARS: "Cleared", FAILS: "Failed its bar", NOT_CLEARED: "Not cleared", INCONCLUSIVE: "Inconclusive" };
function regimeRow(sc, now) {
  const base = { id: `${REGIME_WINDOW.axis}:regime-window`, kind: "test", name: "Basis × CVD, graded exit · regime window", canLoad: false, presetId: null, eta: null };
  const days = (c) => (c ? `BTC regime so far: UP ${c.UP || 0} · DOWN ${c.DOWN || 0} · FLAT ${c.FLAT || 0} days (needs 14+ in two, one DOWN).` : "");
  const counts = sc?.regimeWindow?.regime?.counts || null;
  if (REGIME_RESULT) {
    return { ...base, stage: REGIME_RESULT === "CLEARS" ? "TRADEABLE" : "RETIRED", stageWord: REGIME_WORD[REGIME_RESULT], need: "",
      note: `Judged: ${REGIME_WORD[REGIME_RESULT]}. Final.`,
      reason: REGIME_RESULT === "CLEARS" ? "Cleared. A paper-only preset gets proposed in its own PR. Loads only at Paper." : "Judged and final. It never loads." };
  }
  const main = (sc?.axes || []).find((a) => a?.name === REGIME_WINDOW.axis)?.regimeWindow;
  const hold = (sc?.holdout?.axes || []).find((a) => a?.name === REGIME_WINDOW.axis)?.regimeWindow;
  const j = judgeRegimeWindow({ main, holdout: hold, regime: sc?.regimeWindow?.regime }, now);
  const start = new Date(regimeFromMs()).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (!j) return { ...base, stage: "REGISTERED", stageWord: "Testing", need: "", note: "Its numbers couldn't be read right now.", reason: "Being tested. Loads only at Paper." };
  if (j.status !== "COUNTING") {
    // The live numbers reach a judgment; it becomes final when the watcher records it.
    return { ...base, stage: j.status === "CLEARS" ? "TRADEABLE" : "RETIRED", stageWord: REGIME_WORD[j.status], need: "",
      note: `Reads ${REGIME_WORD[j.status].toLowerCase()} on today's numbers: ${j.reason}. Final once recorded.`, reason: "Being judged. Loads only at Paper." };
  }
  const trades = j.numbers.trades;
  const elapsed = (now - regimeFromMs()) / 86_400_000;
  let eta = null;
  if (trades > 0 && elapsed >= 1 && trades < REGIME_WINDOW.minTrades) {
    const at = now + ((REGIME_WINDOW.minTrades - trades) / (trades / elapsed)) * 86_400_000;
    eta = `30 trades ~${new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} at today's pace`;
  }
  return { ...base, stage: "REGISTERED", stageWord: "Testing",
    need: now < regimeFromMs() ? "" : `${Math.max(0, REGIME_WINDOW.minTrades - trades)} more counted trades and the regime condition, or the limit (Apr 27, 2027)`,
    note: now < regimeFromMs() ? `Counts from ${start}.` : days(counts), eta, reason: "Being tested. Loads only at Paper." };
}

export function shelfRows(sc, now = Date.now()) {
  const reads = sc?.pipeline?.reads;
  if (!Array.isArray(reads)) return [];
  const labels = Object.fromEntries((Array.isArray(sc.axes) ? sc.axes : []).map((a) => [a?.name, a?.label]));
  const kill = Number(sc?.pipeline?.rules?.killEvents) || 100;
  const rows = reads.filter((r) => r && r.axis && r.stage).map((r) => readRow(r, labels, now, kill));
  const ex = exitRow(Array.isArray(sc.axes) ? sc.axes.find((a) => a?.name === GRADED_EXIT_AXIS) : null, now);
  if (ex) rows.push(ex);
  rows.push(regimeRow(sc, now));
  const rank = (r) => (r.stage === "RETIRED" ? -1 : r.stageWord === "Failing" ? -0.5 : LADDER.indexOf(r.stage));
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(b.r) - rank(a.r) || a.i - b.i).map(({ r }) => r);
}
