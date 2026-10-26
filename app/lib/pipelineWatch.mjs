// ── The pipeline watcher: what changed on the scoreboard since the last recorded stage ─────────
// borst, 2026-10-26: "a daily scoreboard watcher that applies the triggers in pipeline-if-then.md
// and only pings or opens a PR on a stage change. Never acts on its own."
//
// This module only COMPARES. It reads two things from GET /intel/axis-backtest as served:
//   1. each registered read's `pipeline.reads[].stage` (the stage rules are readPipeline.mjs);
//   2. the Basis × CVD graded-exit line, judged by the bar in docs/research/graded-exit-prereg.md
//      ("Clears" / "Fails" / "Not yet"), from `axes[basis_x_cvd]` exactly as that page names it.
// and the last recorded state, docs/research/pipeline-stages.json (committed; a watcher PR updates
// it). A change is a different stage or status, never a different count: "20 more events" turning
// into "19 more" is not news. Each change carries the trigger the signed page attaches to it, so the
// PR that applies it names what to do. Nothing here writes, trades, flips a flag or opens anything.
//
// Two states are terminal, because the page says so: a read that is RETIRED stays retired ("never
// re-tuned"), and a graded exit that FAILS is retired ("its wallet stays as a record"). If the served
// value later leaves one of them, the watcher keeps the recorded state and reports the disagreement
// as an issue ("the served stage stands and the disagreement is a bug to fix in its own PR").

import { REGIME_WINDOW, REGIME_OUTCOMES, judgeRegimeWindow, regimeFromMs } from "./regimeWindow.mjs";

export const IF_THEN_PAGE = "docs/research/pipeline-if-then.md";
export const GRADED_EXIT_PAGE = "docs/research/graded-exit-prereg.md";
export const SNAPSHOT_PATH = "docs/research/pipeline-stages.json";
export const GRADED_EXIT_AXIS = "basis_x_cvd";
export const GRADED_EXIT_MIN_TRADES = 30;

// What the signed page attaches to each stage, in its own words, shortened. `section` is the page's
// heading for it (pipelineWatch.test.mjs checks each one is on the page, so a renamed section fails).
export const STAGE_TRIGGERS = Object.freeze({
  REGISTERED: {
    section: "**Registered",
    does: ["/proof lists it under \"Being tested now\" with its event count and what it still needs. Nothing else."],
  },
  LEAD: {
    section: "**Lead**",
    does: [
      "/proof moves the row to \"Leads\": \"A lead. Not an edge yet.\" with events and mean R. The headline doesn't change.",
      "If it hasn't repeated on the holdout coins, /proof adds \"Hasn't repeated on coins it was never picked on.\"",
      "Nothing else: no preset, no agent mode, no wallet.",
    ],
  },
  EDGE: {
    section: "**Edge**",
    does: [
      "/proof: \"Beats random on new data and on coins it was never picked on. Not tested as a trade yet.\" Headline unchanged.",
      "May start, as its own reviewed PR: the agent rule + a parity test (live gate == grader, hour by hour). Stays OFF: no preset, no Lab mode, no wallet.",
    ],
  },
  TRADEABLE: {
    section: "**Tradeable**",
    does: [
      "/proof: the headline changes in the same PR, to the read, the number of trades and the date.",
      "borst sets up one paper wallet for it (preset as registered, main coins only). Parity must read CLEAN.",
      "x402 nexus-signals may switch to it, own PR, on borst's go. House caller may publish it, own PR, new house wallet, on borst's go.",
      "Live money: none.",
    ],
  },
  PAPER: {
    section: "**Paper**",
    does: [
      "After 30+ paper trades, parity CLEAN, net positive after fees: a written live plan (size, daily cap, kill switch, who signs) as its own dated PR. Arming stays borst's call, in person.",
      "Net ≤ 0 at 30 paper trades: stays Tradeable on the scoreboard, nothing goes live.",
    ],
  },
  RETIRED: {
    section: "**Retired**",
    does: ["/proof moves the row to \"Retired\" with its name, numbers and the date. It stays visible. Never re-tuned."],
  },
});

export const GRADED_EXIT_TRIGGERS = Object.freeze({
  NOT_YET: { section: "**Not yet**", does: ["Nothing changes."] },
  CLEARS: {
    section: "**Clears**",
    does: [
      "Basis × CVD goes back on the /proof lead with the graded exit; the headline changes as at Tradeable.",
      "A paper-only preset trading it can be proposed. x402 + house caller follow the Tradeable rules (borst's go).",
      "Live money follows the Paper rules: wallet 0x9A30…cB28 is the one that counts. Nothing is armed.",
    ],
  },
  FAILS: { section: "**Fails**", does: ["The graded-exit variant is retired; its wallet (0x9A30…cB28) stays as a record."] },
});

// The Basis × CVD regime window (docs/research/graded-exit-regime-prereg.md, signed 2026-10-26):
// judged by `judgeRegimeWindow` (regimeWindow.mjs). Its four outcomes are final.
export const REGIME_PAGE = REGIME_WINDOW.doc;
export const REGIME_TEST_KEY = "basis_x_cvd:regime_window";
const PARITY_CHECK = "Before merging: parity on the paper wallet 0x9A30…cB28 (GET /agent/0x9A3012988d60D61b34660BE06a321F7BF7bCcB28/parity?since=2026-10-27T00:00:00Z) must read CLEAN; if it reads DRIFT, the result waits until the drift is explained.";
const RECORD = "Append the result under Results with the date, the numbers and the reason, and set REGIME_RESULT in app/lib/regimeWindow.mjs to this status (final).";
export const REGIME_TRIGGERS = Object.freeze({
  COUNTING: { section: "**Judgment**", does: ["Nothing changes. The window runs to judgment."] },
  CLEARS: {
    section: "**CLEARS**",
    does: [
      RECORD,
      "Then pipeline-if-then.md from its Tradeable rules: the /proof headline changes in the same PR (the read, the number of trades, the date).",
      "A paper-only preset trading it is proposed in its own PR. x402 and the house caller only on borst's go. Live money only through docs/research/live-money-review.md, signed by borst in person.",
      PARITY_CHECK,
    ],
  },
  FAILS: { section: "**FAILS**", does: [RECORD, "The test is retired: final, no extension. The paper wallet 0x9A30…cB28 stays as a record.", PARITY_CHECK] },
  NOT_CLEARED: { section: "**NOT CLEARED**", does: [RECORD, "Retired with the missed bar named: final, no extension. The paper wallet stays as a record.", PARITY_CHECK] },
  INCONCLUSIVE: { section: "**INCONCLUSIVE**", does: [RECORD, "Retired as inconclusive: final, no extension. The paper wallet stays as a record."] },
  NOTE: { section: "**The read's old-data grade decides nothing.**", does: ["Append one dated line under Results with the read's grade. Nothing else changes; the window runs to judgment."] },
});

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// The graded-exit bar, word for word from graded-exit-prereg.md § "Decision rule":
//   Clears: oos net bps > 0 over ≥ 30 trades AND the read still PREDICTIVE AND LONG BEATS_RANDOM.
//   Fails:  oos net bps ≤ 0 at ≥ 30 trades, OR the read itself falls below PREDICTIVE.
//   Not yet: fewer than 30 out-of-sample trades (and not failed).
export function gradedExitStatus(axis) {
  if (!axis || typeof axis !== "object") return null;
  const oos = axis.exitGraded?.oos || null;
  const trades = num(oos?.samples) ?? 0;
  const net = num(oos?.netBps);
  const verdict = axis.verdict || null;
  const long = axis.random?.bySide?.LONG || null;
  const numbers = { trades, netBps: net, verdict, longVsRandomPct: num(long?.pctBeaten) };
  if (verdict !== "PREDICTIVE") {
    return { status: "FAILS", reason: `the read is ${verdict || "ungraded"}, below PREDICTIVE`, numbers };
  }
  if (trades >= GRADED_EXIT_MIN_TRADES && !(net > 0)) {
    return { status: "FAILS", reason: `out-of-sample net ${net} bps over ${trades} trades`, numbers };
  }
  if (trades >= GRADED_EXIT_MIN_TRADES && long?.verdict === "BEATS_RANDOM") {
    return { status: "CLEARS", reason: `out-of-sample net +${net} bps over ${trades} trades, PREDICTIVE, LONG beats ${long.pctBeaten}% of random`, numbers };
  }
  if (trades >= GRADED_EXIT_MIN_TRADES) {
    return { status: "NOT_YET", reason: `net +${net} bps over ${trades} trades, but LONG beats ${long?.pctBeaten ?? "—"}% of random (needs 95%)`, numbers };
  }
  return { status: "NOT_YET", reason: `${GRADED_EXIT_MIN_TRADES - trades} more out-of-sample trades`, numbers };
}

/**
 * The state worth recording, from a served scorecard. Returns null when the scorecard can't be read
 * (no pipeline block): an unreadable board is never a change.
 */
export function stateFromScorecard(sc, now = Date.now()) {
  const reads = sc?.pipeline?.reads;
  if (!Array.isArray(reads)) return null;
  const out = { asOf: sc.asOf || null, reads: {}, gradedExit: {}, tests: {} };
  for (const r of reads) {
    if (!r || typeof r.axis !== "string" || typeof r.stage !== "string") continue;
    out.reads[r.axis] = { stage: r.stage, next: r.next ?? null, events: num(r.numbers?.events) };
  }
  const axis = Array.isArray(sc.axes) ? sc.axes.find((a) => a?.name === GRADED_EXIT_AXIS) : null;
  const ge = gradedExitStatus(axis);
  if (ge) out.gradedExit[GRADED_EXIT_AXIS] = { status: ge.status, reason: ge.reason, trades: ge.numbers.trades, netBps: ge.numbers.netBps };
  // The regime window: main-card block, holdout block, BTC day counts. Any of them unread ⇒ no entry
  // (reported as "not served" against the record, never judged on a missing number).
  const holdAxis = Array.isArray(sc.holdout?.axes) ? sc.holdout.axes.find((a) => a?.name === REGIME_WINDOW.axis) : null;
  const j = judgeRegimeWindow({ main: axis?.regimeWindow, holdout: holdAxis?.regimeWindow, regime: sc.regimeWindow?.regime, readVerdict: axis?.verdict ?? null }, now);
  if (j) {
    out.tests[REGIME_TEST_KEY] = {
      status: j.status, reason: j.reason, trades: j.numbers.trades, netBps: j.numbers.netBps, regime: j.numbers.regime,
      belowPredictive: axis?.verdict ? axis.verdict !== "PREDICTIVE" : null, readVerdict: axis?.verdict ?? null,
      inWindow: now >= regimeFromMs(),
    };
  }
  return out;
}

/**
 * Compare the recorded snapshot with the served state.
 * @returns {{ changes: object[], issues: string[], next: object }}  `next` is the snapshot to record
 *          if the changes are applied (terminal states kept, counts refreshed).
 */
export function diffPipeline(prev, cur) {
  const changes = [], issues = [];
  const next = { asOf: cur.asOf, reads: {}, gradedExit: {} };
  const before = prev?.reads || {};

  for (const [axis, now] of Object.entries(cur.reads)) {
    const was = before[axis]?.stage ?? null;
    if (was === "RETIRED" && now.stage !== "RETIRED") {
      issues.push(`${axis}: recorded RETIRED, served ${now.stage}. Retired is final; the served value is a bug to fix in its own PR.`);
      next.reads[axis] = { ...before[axis] };
      continue;
    }
    next.reads[axis] = { stage: now.stage, next: now.next, events: now.events };
    if (was !== now.stage) {
      changes.push({
        key: `read:${axis}`, kind: was == null ? "new_read" : "stage", from: was, to: now.stage,
        reason: now.next ? `next: ${now.next}` : "", page: IF_THEN_PAGE,
        trigger: STAGE_TRIGGERS[now.stage] || { section: "?", does: [`Unknown stage "${now.stage}": not on the page. Ask borst.`] },
      });
    }
  }
  for (const axis of Object.keys(before)) {
    if (!(axis in cur.reads)) {
      issues.push(`${axis}: recorded but not served. Kept as recorded; check the scoreboard.`);
      next.reads[axis] = { ...before[axis] };
    }
  }

  const prevGe = prev?.gradedExit || {};
  for (const [axis, now] of Object.entries(cur.gradedExit)) {
    const was = prevGe[axis]?.status ?? null;
    if (was === "FAILS" && now.status !== "FAILS") {
      issues.push(`${axis} graded exit: recorded FAILS, now reads ${now.status}. A failed variant stays retired.`);
      next.gradedExit[axis] = { ...prevGe[axis] };
      continue;
    }
    next.gradedExit[axis] = { ...now };
    if (was !== now.status) {
      changes.push({
        key: `gradedExit:${axis}`, kind: "graded_exit", from: was, to: now.status, reason: now.reason,
        page: GRADED_EXIT_PAGE, trigger: GRADED_EXIT_TRIGGERS[now.status],
      });
    }
  }
  if (!(GRADED_EXIT_AXIS in cur.gradedExit) && prevGe[GRADED_EXIT_AXIS]) {
    issues.push(`${GRADED_EXIT_AXIS} graded exit: not served. Kept as recorded.`);
    next.gradedExit[GRADED_EXIT_AXIS] = { ...prevGe[GRADED_EXIT_AXIS] };
  }

  // Registered tests (the regime window). A judged outcome is final; a grade note is recorded once
  // per change of side (below PREDICTIVE or back), only inside the window.
  next.tests = {};
  const prevT = prev?.tests || {};
  for (const [key, now] of Object.entries(cur.tests || {})) {
    const was = prevT[key] || null;
    if (was && REGIME_OUTCOMES.includes(was.status)) {
      if (now.status !== was.status) issues.push(`${key}: recorded ${was.status}, which is final; the served numbers now read ${now.status}. Kept as recorded.`);
      next.tests[key] = { ...was };
      continue;
    }
    const { inWindow, ...rec } = now;
    next.tests[key] = { ...rec, belowPredictive: inWindow ? now.belowPredictive : (was?.belowPredictive ?? now.belowPredictive) };
    if ((was?.status ?? null) !== now.status) {
      changes.push({
        key: `test:${key}`, name: "basis_x_cvd regime window", kind: "regime_test", from: was?.status ?? null, to: now.status,
        reason: now.reason, page: REGIME_PAGE, trigger: REGIME_TRIGGERS[now.status],
      });
    }
    if (inWindow && was && now.belowPredictive != null && was.belowPredictive != null && now.belowPredictive !== was.belowPredictive) {
      changes.push({
        key: `note:${key}`, name: "basis_x_cvd read grade (regime window)", kind: "regime_note",
        from: was.belowPredictive ? "below PREDICTIVE" : "PREDICTIVE", to: now.belowPredictive ? `below PREDICTIVE (${now.readVerdict})` : "PREDICTIVE",
        reason: "Noted only. It does not retire the test.", page: REGIME_PAGE, trigger: REGIME_TRIGGERS.NOTE,
      });
    }
  }
  for (const key of Object.keys(prevT)) {
    if (!(key in (cur.tests || {}))) {
      issues.push(`${key}: not served (scoreboard block or BTC day counts unread). Kept as recorded.`);
      next.tests[key] = { ...prevT[key] };
    }
  }
  return { changes, issues, next };
}

// The PR title + body for a set of changes (the scheduled run uses it as is).
export function changeReport(changes, issues = [], asOf = null) {
  const nameOf = (c) => c.name || c.key.split(":")[1];
  const title = `Pipeline watch: ${changes.map((c) => `${nameOf(c)} ${c.from ?? "new"} → ${c.to}`).join(", ")}`;
  const lines = [`Served by GET /intel/axis-backtest${asOf ? ` (asOf ${asOf})` : ""}.`, ""];
  for (const c of changes) {
    lines.push(`### ${nameOf(c)}${c.kind === "graded_exit" ? " (graded exit)" : ""}: ${c.from ?? "new"} → ${c.to}`);
    if (c.reason) lines.push(c.reason);
    lines.push("", `What ${c.page} says (${c.trigger.section.replace(/\*/g, "")}):`);
    for (const d of c.trigger.does) lines.push(`- ${d}`);
    lines.push("");
  }
  if (issues.length) { lines.push("### Issues", ...issues.map((i) => `- ${i}`), ""); }
  lines.push("Opened by the daily pipeline watcher. It does not merge. Steps marked \"borst's go\" are borst's.");
  return { title: title.length > 120 ? `${title.slice(0, 117)}…` : title, body: lines.join("\n") };
}
