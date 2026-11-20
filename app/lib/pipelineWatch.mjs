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
// One state is terminal, because the page says so: a graded exit that FAILS is retired ("its wallet stays
// as a record"). If the served value later leaves it, the watcher keeps the recorded state and reports the
// disagreement as an issue. Reads no longer retire (borst 2026-11-20, pipeline-if-then.md "Reads no longer
// retire"): the 100-event check is a label on the served row (`failing`), set by the numbers each day and
// never news, so a read's recorded stage is always a ladder stage. A served RETIRED (a board built before
// that change) is reported as an issue and the recorded stage is kept.

import { REGIME_WINDOW, REGIME_OUTCOMES, judgeRegimeWindow, regimeFromMs } from "./regimeWindow.mjs";
import { isDemotion, lockAtDemotion, stepLock, lockProgress, STAGE_RANK } from "./promotionLock.mjs";
//
// 3. The stress-hour study (docs/research/stress-hours-prereg.md), as served in `stressStudy`: a read's
//    verdict turning FINAL is the change (one PR records it under the page's Results). Counts and the
//    in-between statuses (ACCRUING, RIPENING, PENDING_HOLM, …) are recorded but never news. A recorded
//    final verdict is terminal, like a retired read.
// 4. The trend gate (docs/research/trend-gate-prereg.md, signed 2026-11-16), as served in `trendGate`: watched exactly
//    like the stress study (2026-11-17, one helper for both, `diffStudy`). Only AGAINST_WORSE licenses anything, and
//    that is borst's reviewed block PR, never the watcher's.

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
      "/proof: the headline names the read, the number of trades and the date. It is computed from the served stage (proofHeadline, app/lib/proofCopy.mjs, since 2026-11-05): nothing to edit, and it reverts by itself if the read drops back.",
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
});

// Backwards moves (pipeline-if-then.md § "Backwards moves", borst 2026-11-15; rules app/lib/promotionLock.mjs). A demoted
// read keeps its paper wallet running and is promotion-LOCKED; the lock is part of the recorded snapshot (`locks`).
export const LOCK_TRIGGERS = Object.freeze({
  LOCKED: {
    section: "**Backwards moves**",
    does: [
      "Record the snapshot and the lock. The paper wallet keeps running for data. Promotion is locked: nothing a higher stage licenses is applied, and live-plan signing is refused in code (promotion_locked).",
      "It re-qualifies after 2 clean daily watcher reads at its lost stage, at least 7 days apart, plus 15 new out-of-sample events since the demotion. A failing read resets the count.",
    ],
  },
  PASS: { section: "**Backwards moves**", does: ["Record the pass in the snapshot. Nothing else changes: the read is still locked."] },
  RESET: { section: "**Backwards moves**", does: ["A read below the lost stage resets the count to 0. Record it. Nothing else changes."] },
  UNLOCKED: {
    section: "**Backwards moves**",
    does: ["Remove the lock from the snapshot. From here the served stage's own section applies again, as a new PR per trigger."],
  },
  HELD: {
    section: "**Backwards moves**",
    does: ["The served stage moved up while the read is locked: record the stage only. Nothing in that stage's section is applied until the lock clears."],
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

// The stress-hour study: the verdicts on its page (§ Verdicts + borst's dated rulings under Results).
export const STRESS_PAGE = "docs/research/stress-hours-prereg.md";
const STRESS_RECORD = "Append one dated line under Results on docs/research/stress-hours-prereg.md: the read, the verdict, d (STRESS − CALM mean R), p, the Holm threshold, the STRESS / CALM counts and the judging time. Never an edit above Results.";
export const STRESS_TRIGGERS = Object.freeze({
  WORSE_IN_STRESS: {
    section: "**WORSE_IN_STRESS:**",
    does: [STRESS_RECORD, "borst's go: it licenses ONE reviewed PR proposing to pause that read's live entries in stress windows. The watcher doesn't open it. Nothing switches on by itself."],
  },
  NO_DIFFERENCE: { section: "**NO_DIFFERENCE:**", does: [STRESS_RECORD, "No automatic breaker for that read. Nothing else changes."] },
  BETTER_IN_STRESS: {
    section: "**BETTER_IN_STRESS:**",
    does: [STRESS_RECORD, "Nothing changes. Never a licence to trade only in stress: that would be a new read, registered and graded first."],
  },
  LOWER_STILL_POSITIVE: {
    section: "**\"lower in stress, still positive\"**",
    does: [STRESS_RECORD, "It licenses nothing (borst's ruling, 2026-11-04). Nothing else changes."],
  },
  NOT_ENOUGH_STRESS: { section: "**NOT_ENOUGH_STRESS:**", does: [STRESS_RECORD, "No verdict: fewer than 20 STRESS events at the limit. Nothing changes."] },
});
// The trend gate: the verdicts on its page (§ Verdicts + borst's dated ruling under Results, 2026-11-17).
export const TREND_PAGE = "docs/research/trend-gate-prereg.md";
const TREND_RECORD = "Append one dated line under Results on docs/research/trend-gate-prereg.md: the read, the verdict, d (WITH − AGAINST mean R), p, the Holm threshold, the WITH / AGAINST counts and the judging time. Never an edit above Results.";
export const TREND_TRIGGERS = Object.freeze({
  AGAINST_WORSE: {
    section: "**AGAINST_WORSE:**",
    does: [TREND_RECORD, "borst's go: it licenses ONE reviewed PR proposing to block that read's live entries against BTC's 4h trend. The watcher doesn't open it. Nothing switches on by itself."],
  },
  LOWER_STILL_POSITIVE: { section: "**LOWER_STILL_POSITIVE:**", does: [TREND_RECORD, "It licenses nothing. Nothing else changes."] },
  NO_DIFFERENCE: { section: "**NO_DIFFERENCE:**", does: [TREND_RECORD, "No gate for that read. Nothing else changes."] },
  WITH_WORSE: {
    section: "**WITH_WORSE:**",
    does: [TREND_RECORD, "Nothing changes. Never a licence to trade only against the trend: that would be a new read, registered and graded first."],
  },
  NOT_ENOUGH: { section: "**NOT_ENOUGH:**", does: [TREND_RECORD, "No verdict: fewer than 20 events on a side at the limit. Nothing changes."] },
});
function trendReason(r) {
  const c = r.counts || {};
  if (r.verdict === "NOT_ENOUGH") return `${c.WITH ?? 0} WITH / ${c.AGAINST ?? 0} AGAINST at the limit (needs 20 on each side)`;
  const fmt = (v) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}R` : "—");
  return `${r.label || r.verdict}: WITH ${fmt(r.meanWith)} vs AGAINST ${fmt(r.meanAgainst)} (d ${fmt(r.d)}), p ${r.p ?? "—"}, Holm threshold ${r.holm?.threshold ?? "—"}, ${c.WITH ?? 0} WITH / ${c.AGAINST ?? 0} AGAINST, judged at ${r.judgedAt || "the limit"}`;
}

const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
function stressReason(r) {
  const c = r.counts || {};
  if (r.verdict === "NOT_ENOUGH_STRESS") return `${c.STRESS ?? 0} STRESS events at the limit (needs 20); ${c.CALM ?? 0} CALM`;
  const fmt = (v) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}R` : "—");
  return `${r.label || r.verdict}: STRESS ${fmt(r.meanStress)} vs CALM ${fmt(r.meanCalm)} (d ${fmt(r.d)}), p ${r.p ?? "—"}, Holm threshold ${r.holm?.threshold ?? "—"}, ${c.STRESS ?? 0} STRESS / ${c.CALM ?? 0} CALM, judged at ${r.judgedAt || "the limit"}`;
}

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
  // The stress-hour study. Unserved or errored ⇒ `stressError` (reported, never judged on nothing).
  const ss = sc.stressStudy;
  if (ss && ss.reads && typeof ss.reads === "object" && !ss.error) {
    out.stress = {};
    for (const [name, r] of Object.entries(ss.reads)) {
      if (!r || typeof r.status !== "string") continue;
      out.stress[name] = {
        status: r.status, verdict: r.verdict ?? null, final: r.final === true,
        stress: num(r.counts?.STRESS) ?? 0, calm: num(r.counts?.CALM) ?? 0,
        d: r4(r.d), p: r4(r.p), judgedAt: r.judgedAt ?? null,
        ...(r.final === true && r.verdict ? { reason: stressReason(r) } : {}),
      };
    }
  } else {
    out.stressError = ss?.error || "stressStudy not served";
  }
  // The trend gate, read the same way. Unserved or errored ⇒ `trendError`.
  const tg = sc.trendGate;
  if (tg && tg.reads && typeof tg.reads === "object" && !tg.error) {
    out.trend = {};
    for (const [name, r] of Object.entries(tg.reads)) {
      if (!r || typeof r.status !== "string") continue;
      out.trend[name] = {
        status: r.status, verdict: r.verdict ?? null, final: r.final === true,
        with: num(r.counts?.WITH) ?? 0, against: num(r.counts?.AGAINST) ?? 0,
        d: r4(r.d), p: r4(r.p), judgedAt: r.judgedAt ?? null,
        ...(r.final === true && r.verdict ? { reason: trendReason(r) } : {}),
      };
    }
  } else {
    out.trendError = tg?.error || "trendGate not served";
  }
  return out;
}

/**
 * A conditioner study's per-read verdicts (the stress study, the trend gate): a verdict turning FINAL is the change;
 * a recorded final verdict is terminal; counts and in-between statuses are recorded quietly. Mutates `changes` /
 * `issues` and returns the study's next snapshot map.
 */
function diffStudy({ prevMap = {}, curMap, curError, label, slug, page, triggers, kind }, changes, issues) {
  const next = {};
  if (curMap) {
    for (const [name, now] of Object.entries(curMap)) {
      const was = prevMap[name] || null;
      if (was?.final && was.verdict) {
        if (!(now.final && now.verdict === was.verdict)) issues.push(`${label} ${name}: recorded ${was.verdict}, which is final; served ${now.final ? now.verdict : `${now.status} (not final)`}. Kept as recorded.`);
        next[name] = { ...was };
        continue;
      }
      next[name] = { ...now };
      if (now.final && now.verdict) {
        changes.push({
          key: `${slug}:${name}`, name: `${label} ${name}`, kind, from: was?.status ?? null, to: now.verdict,
          reason: now.reason || "", page,
          trigger: triggers[now.verdict] || { section: "?", does: [`Unknown verdict "${now.verdict}": not on the page. Ask borst.`] },
        });
      }
    }
  } else if (curError && Object.keys(prevMap).length) {
    issues.push(`${label}: not served (${curError}). Recorded entries kept.`);
  }
  for (const name of Object.keys(prevMap)) {
    if (!(name in next)) {
      if (curMap) issues.push(`${label} ${name}: recorded but not served. Kept as recorded.`);
      next[name] = { ...prevMap[name] };
    }
  }
  return next;
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

  const prevLocks = prev?.locks || {};
  next.locks = {};
  for (const [axis, now] of Object.entries(cur.reads)) {
    const was = before[axis]?.stage ?? null;
    if (now.stage === "RETIRED") {
      // Not a stage since 2026-11-20: a board built before the change. Keep what's recorded; the next build serves the ladder.
      issues.push(`${axis}: served RETIRED, which is no longer a stage (reads no longer retire, 2026-11-20). Recorded ${was ?? "nothing"} kept; check that the scoreboard rebuilt after the deploy.`);
      if (before[axis]) next.reads[axis] = { ...before[axis] };
      if (prevLocks[axis]) next.locks[axis] = { ...prevLocks[axis] };
      continue;
    }
    next.reads[axis] = { stage: now.stage, next: now.next, events: now.events };
    // The promotion lock: set on a demotion, stepped on every other read while it holds.
    let lock = prevLocks[axis] || null;
    let lockEvent = null;
    if (isDemotion(was, now.stage)) {
      lock = lockAtDemotion(lock, { from: was, events: now.events, asOf: cur.asOf });
      lockEvent = "LOCKED";
    } else if (lock) {
      const st = stepLock(lock, now, cur.asOf);
      lock = st.lock;
      lockEvent = st.event ? st.event.toUpperCase() : null;
    }
    if (lock) next.locks[axis] = lock;
    if (was !== now.stage) {
      const up = was != null && STAGE_RANK[now.stage] != null && STAGE_RANK[was] != null && STAGE_RANK[now.stage] > STAGE_RANK[was];
      const held = up && lock;
      changes.push({
        key: `read:${axis}`, kind: was == null ? "new_read" : "stage", from: was, to: now.stage,
        reason: [now.next ? `next: ${now.next}` : "", lock ? lockProgress(lock, now.events) : ""].filter(Boolean).join(" · "),
        page: IF_THEN_PAGE,
        trigger: lockEvent === "LOCKED" ? LOCK_TRIGGERS.LOCKED : held ? LOCK_TRIGGERS.HELD
          : STAGE_TRIGGERS[now.stage] || { section: "?", does: [`Unknown stage "${now.stage}": not on the page. Ask borst.`] },
      });
    }
    if (lockEvent && lockEvent !== "LOCKED") {
      changes.push({
        key: `lock:${axis}`, name: `${axis} promotion lock`, kind: "lock", from: lockEvent === "UNLOCKED" ? "locked" : `${prevLocks[axis]?.cleanPasses ?? 0} passes`,
        to: lockEvent === "UNLOCKED" ? "unlocked" : `${lock.cleanPasses} passes`,
        reason: lock ? lockProgress(lock, now.events) : `re-qualified: ${prevLocks[axis].lostStage} on 2 daily reads 7+ days apart, 15+ new events`,
        page: IF_THEN_PAGE, trigger: LOCK_TRIGGERS[lockEvent],
      });
    }
  }
  for (const axis of Object.keys(before)) {
    if (!(axis in cur.reads)) {
      issues.push(`${axis}: recorded but not served. Kept as recorded; check the scoreboard.`);
      next.reads[axis] = { ...before[axis] };
      if (prevLocks[axis]) next.locks[axis] = { ...prevLocks[axis] };
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

  // The two conditioner studies: a verdict turning final is the change; a recorded final verdict is terminal.
  next.stress = diffStudy({ prevMap: prev?.stress, curMap: cur.stress, curError: cur.stressError, label: "stress_hours", slug: "stress",
    page: STRESS_PAGE, triggers: STRESS_TRIGGERS, kind: "stress_verdict" }, changes, issues);
  next.trend = diffStudy({ prevMap: prev?.trend, curMap: cur.trend, curError: cur.trendError, label: "trend_gate", slug: "trend",
    page: TREND_PAGE, triggers: TREND_TRIGGERS, kind: "trend_verdict" }, changes, issues);
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
  lines.push("Opened by the daily pipeline watcher. It merges only when checks are green and nothing is borst's to arm. Steps marked \"borst's go\" are borst's.");
  return { title: title.length > 120 ? `${title.slice(0, 117)}…` : title, body: lines.join("\n") };
}

// The recorded locks as a module the worker can import (live-plan signing refuses a locked read in code). Written by
// `tools/pipeline/watch.mjs --write` with the snapshot; pipelineWatch.test.mjs fails if the two disagree.
export const LOCKS_MODULE_PATH = "app/lib/promotionLocks.mjs";
export function promotionLocksModule(locks = {}) {
  const sorted = Object.fromEntries(Object.keys(locks || {}).sort().map((k) => [k, locks[k]]));
  return "// GENERATED by tools/pipeline/watch.mjs --write from docs/research/pipeline-stages.json (`locks`). Never edit by hand.\n"
    + "// Rules: app/lib/promotionLock.mjs; page: docs/research/pipeline-if-then.md § \"Backwards moves\".\n"
    + `export const PROMOTION_LOCKS = Object.freeze(${JSON.stringify(sorted, null, 2)});\n`;
}
