// pipelineWatch: the watcher reports a stage change once, never a count change, never acts.
// Run: node --test app/lib/pipelineWatch.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  gradedExitStatus, stateFromScorecard, diffPipeline, changeReport,
  STAGE_TRIGGERS, GRADED_EXIT_TRIGGERS, IF_THEN_PAGE, GRADED_EXIT_PAGE, SNAPSHOT_PATH,
} from "./pipelineWatch.mjs";
import { STAGES } from "./readPipeline.mjs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

const axis = ({ verdict = "PREDICTIVE", trades = 4, net = 44.9, longPct = 96, longVerdict = "BEATS_RANDOM" } = {}) => ({
  name: "basis_x_cvd", verdict,
  exitGraded: { oos: { samples: trades, netBps: net } },
  random: { bySide: { LONG: { pctBeaten: longPct, verdict: longVerdict } } },
});
const sc = (stages, ax = axis()) => ({
  asOf: "2026-10-26T00:00:00Z",
  pipeline: { reads: Object.entries(stages).map(([a, s]) => ({ axis: a, stage: s, next: "x", numbers: { events: 10 } })) },
  axes: [ax],
});

test("graded-exit bar = the prereg's words", () => {
  assert.equal(gradedExitStatus(axis()).status, "NOT_YET");
  assert.equal(gradedExitStatus(axis({ verdict: "PROMISING" })).status, "FAILS");
  assert.equal(gradedExitStatus(axis({ trades: 30, net: 0 })).status, "FAILS");
  assert.equal(gradedExitStatus(axis({ trades: 30, net: -5 })).status, "FAILS");
  assert.equal(gradedExitStatus(axis({ trades: 30, net: 12 })).status, "CLEARS");
  assert.equal(gradedExitStatus(axis({ trades: 30, net: 12, longPct: 90, longVerdict: "LEANS_ABOVE" })).status, "NOT_YET");
  assert.equal(gradedExitStatus(axis({ trades: 29, net: -50 })).status, "NOT_YET"); // under 30 a loss decides nothing
  assert.equal(gradedExitStatus(null), null);
  const page = read(GRADED_EXIT_PAGE);
  assert.match(page, /at least 30 trades/);
  assert.match(page, /falls below PREDICTIVE/);
  assert.match(page, /BEATS_RANDOM \(95%\+\)/);
});

test("an unreadable scoreboard is not a state (never a change)", () => {
  assert.equal(stateFromScorecard(null), null);
  assert.equal(stateFromScorecard({ axes: [] }), null);
});

test("same stages, different counts → no change", () => {
  const a = stateFromScorecard(sc({ r1: "REGISTERED" }));
  const b = stateFromScorecard(sc({ r1: "REGISTERED" }, axis({ trades: 9 })));
  b.reads.r1.next = "3 more"; b.reads.r1.events = 27;
  assert.deepEqual(diffPipeline(a, b).changes, []);
});

test("a stage change is reported with the page's trigger, then recorded", () => {
  const prev = stateFromScorecard(sc({ r1: "REGISTERED", r2: "REGISTERED" }));
  const cur = stateFromScorecard(sc({ r1: "LEAD", r2: "REGISTERED" }));
  const { changes, next } = diffPipeline(prev, cur);
  assert.equal(changes.length, 1);
  assert.deepEqual([changes[0].key, changes[0].from, changes[0].to], ["read:r1", "REGISTERED", "LEAD"]);
  assert.equal(changes[0].trigger, STAGE_TRIGGERS.LEAD);
  assert.deepEqual(diffPipeline(next, cur).changes, [], "once recorded, the same change isn't reported again");
});

test("a stage going back down is reported too (the served stage stands)", () => {
  const { changes } = diffPipeline(stateFromScorecard(sc({ r1: "LEAD" })), stateFromScorecard(sc({ r1: "REGISTERED" })));
  assert.equal(changes[0].to, "REGISTERED");
});

test("RETIRED and a FAILED graded exit are final: kept, disagreement reported as an issue", () => {
  const prev = stateFromScorecard(sc({ r1: "RETIRED" }, axis({ verdict: "PROMISING" })));
  const cur = stateFromScorecard(sc({ r1: "LEAD" }, axis()));
  const { changes, issues, next } = diffPipeline(prev, cur);
  assert.deepEqual(changes, []);
  assert.equal(issues.length, 2);
  assert.equal(next.reads.r1.stage, "RETIRED");
  assert.equal(next.gradedExit.basis_x_cvd.status, "FAILS");
});

test("a read missing from the board is kept and named; a new one is a change", () => {
  const { changes, issues, next } = diffPipeline(stateFromScorecard(sc({ r1: "REGISTERED" })), stateFromScorecard(sc({ r2: "REGISTERED" })));
  assert.equal(next.reads.r1.stage, "REGISTERED");
  assert.match(issues[0], /r1: recorded but not served/);
  assert.equal(changes[0].kind, "new_read");
});

test("graded exit change carries the prereg's trigger", () => {
  const { changes } = diffPipeline(stateFromScorecard(sc({})), stateFromScorecard(sc({}, axis({ verdict: "PROMISING" }))));
  assert.equal(changes[0].to, "FAILS");
  assert.equal(changes[0].page, GRADED_EXIT_PAGE);
});

test("every stage has a trigger, and every trigger's section is on the signed page", () => {
  const ifThen = read(IF_THEN_PAGE), prereg = read(GRADED_EXIT_PAGE);
  for (const s of STAGES) {
    assert.ok(STAGE_TRIGGERS[s], s);
    assert.ok(ifThen.includes(STAGE_TRIGGERS[s].section), `${s}: ${STAGE_TRIGGERS[s].section}`);
  }
  for (const [k, t] of Object.entries(GRADED_EXIT_TRIGGERS)) assert.ok(prereg.includes(t.section), k);
});

test("no trigger line arms anything: live money stays borst's, in person", () => {
  const all = [...Object.values(STAGE_TRIGGERS), ...Object.values(GRADED_EXIT_TRIGGERS)].flatMap((t) => t.does).join("\n");
  assert.doesNotMatch(all, /\b(arm it|turn on|set CARRY_LIVE|go live)\b/i);
  assert.match(STAGE_TRIGGERS.TRADEABLE.does.join(" "), /Live money: none/);
});

test("the PR text names the change, the page and that it doesn't merge", () => {
  const prev = stateFromScorecard(sc({ r1: "REGISTERED" }));
  const { changes } = diffPipeline(prev, stateFromScorecard(sc({ r1: "LEAD" })));
  const { title, body } = changeReport(changes, [], "2026-10-26T00:00:00Z");
  assert.equal(title, "Pipeline watch: r1 REGISTERED → LEAD");
  assert.match(body, /pipeline-if-then\.md/);
  assert.match(body, /does not merge/);
});

test("the committed snapshot reads and covers every registered read", async () => {
  const snap = JSON.parse(read(SNAPSHOT_PATH));
  const { REGISTERED_READS } = await import("./readPipeline.mjs");
  for (const r of REGISTERED_READS) assert.ok(STAGES.includes(snap.reads[r.axis]?.stage), r.axis);
  assert.ok(["NOT_YET", "CLEARS", "FAILS"].includes(snap.gradedExit.basis_x_cvd.status));
});

import { REGIME_TRIGGERS, REGIME_TEST_KEY, REGIME_PAGE } from "./pipelineWatch.mjs";
import { regimeFromMs, regimeLimitMs } from "./regimeWindow.mjs";

const rwBlock = (trades, net) => ({ exitGraded: { samples: trades, netBps: net }, r: { samples: 40, meanR: 0.2, stable: true }, random: { bySide: { LONG: { pctBeaten: 96 } } } });
const rwSc = ({ trades = 5, net = 10, verdict = "PROMISING", regime = { counts: { UP: 3, DOWN: 0, FLAT: 2 }, missing: 0 } } = {}) => ({
  asOf: "x", pipeline: { reads: [] },
  axes: [{ ...axis({ verdict }), regimeWindow: rwBlock(trades, net) }],
  holdout: { axes: [{ name: "basis_x_cvd", regimeWindow: { r: { samples: 30, meanR: 0.1 }, random: { bySide: { LONG: { pctBeaten: 85 } } } } }] },
  regimeWindow: { regime },
});
const IN = regimeFromMs() + 10 * 86_400_000;
// Only the regime-window entries (the fixture also carries the retired graded-exit line).
const rw = (d) => ({ ...d, changes: d.changes.filter((c) => /^(test|note):/.test(c.key)), issues: d.issues.filter((x) => x.startsWith(REGIME_TEST_KEY)) });

test("regime window: counting is recorded quietly; a judgment is a change carrying the page's trigger; it stays final", () => {
  const counting = stateFromScorecard(rwSc(), IN);
  assert.equal(counting.tests[REGIME_TEST_KEY].status, "COUNTING");
  const seeded = { reads: {}, gradedExit: {}, tests: { [REGIME_TEST_KEY]: { status: "COUNTING", belowPredictive: true } } };
  assert.deepEqual(rw(diffPipeline(seeded, counting)).changes, []);
  const failed = stateFromScorecard(rwSc({ trades: 31, net: -4 }), regimeLimitMs());
  const d = rw(diffPipeline(seeded, failed));
  assert.equal(d.changes[0].to, "FAILS");
  assert.equal(d.changes[0].page, REGIME_PAGE);
  assert.equal(d.changes[0].trigger, REGIME_TRIGGERS.FAILS);
  assert.match(changeReport(d.changes).title, /basis_x_cvd regime window COUNTING → FAILS/);
  // once recorded, a later recovery is an issue, never a change
  const later = rw(diffPipeline(d.next, stateFromScorecard(rwSc({ trades: 40, net: 50 }), regimeLimitMs())));
  assert.deepEqual(later.changes, []);
  assert.match(later.issues[0], /recorded FAILS, which is final/);
  assert.equal(later.next.tests[REGIME_TEST_KEY].status, "FAILS");
});

test("regime window: a grade note only inside the window, both ways; an unread board is an issue", () => {
  const seeded = { reads: {}, gradedExit: {}, tests: { [REGIME_TEST_KEY]: { status: "COUNTING", belowPredictive: true } } };
  const before = rw(diffPipeline(seeded, stateFromScorecard(rwSc({ verdict: "PREDICTIVE" }), regimeFromMs() - 1000)));
  assert.deepEqual(before.changes, [], "no note before the window opens");
  assert.equal(before.next.tests[REGIME_TEST_KEY].belowPredictive, true, "the record keeps its value before the window");
  const up = rw(diffPipeline(seeded, stateFromScorecard(rwSc({ verdict: "PREDICTIVE" }), IN)));
  assert.equal(up.changes.length, 1);
  assert.equal(up.changes[0].kind, "regime_note");
  assert.equal(up.changes[0].trigger, REGIME_TRIGGERS.NOTE);
  const down = rw(diffPipeline(up.next, stateFromScorecard(rwSc({ verdict: "NOISE" }), IN)));
  assert.equal(down.changes[0].to, "below PREDICTIVE (NOISE)");
  const unread = stateFromScorecard({ ...rwSc(), regimeWindow: { regime: { error: "rate_limited 429" } } }, IN);
  const u = rw(diffPipeline(seeded, unread));
  assert.deepEqual(u.changes, []);
  assert.match(u.issues[0], /not served/);
  assert.equal(u.next.tests[REGIME_TEST_KEY].status, "COUNTING");
});

test("every regime trigger's section is on the signed page", () => {
  const p = read(REGIME_PAGE);
  for (const [k, t] of Object.entries(REGIME_TRIGGERS)) assert.ok(p.includes(t.section), `${k}: ${t.section}`);
});
