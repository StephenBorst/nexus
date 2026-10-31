// The stress-hour study's judge (stressGrading.mjs, docs/research/stress-hours-prereg.md): the shift
// null, determinism under seed 20261031, Holm step-down and its interim calls, the 30/30 and limit
// rules, the verdict map, and that nothing which trades imports it. Hand-built inputs only.
// Run: node --test workers/nexus-lab-api/stressGrading.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mulberry32, drawShifts, shiftedIsStress, holm, judgeStressStudy, readPopulation, R_HOLD_H } from "./stressGrading.mjs";
import { STRESS_RULE, STRESS_STUDY, inStress, stressLabel } from "./stressHours.mjs";
import { hourBucket } from "../../app/lib/basisStack.mjs";

const H = 3600000, D = 24 * H;
const START = Date.parse(STRESS_STUDY.registeredAt);
const LIMIT = Date.parse(STRESS_STUDY.limit);
// every hour judged from two days before the start to well past the limit
const JUDGED = new Set(Array.from({ length: 200 * 24 }, (_, i) => hourBucket(START - 2 * D) + i));
// stress episodes at irregular days (two hours each), stamped 2 minutes past the hour like real rows
const EPISODE_DAYS = [3, 11.5, 19, 31, 44.5, 52];
const HOURS = EPISODE_DAYS.flatMap((d) => [START + d * D + 120000, START + d * D + H + 120000]);

// 30+ STRESS events (5 per episode) and calm events every 7h where the label says CALM.
function tape({ rStress, rCalm, nCalm = 40, perEp = 5 }) {
  const ev = [];
  for (const d of EPISODE_DAYS) for (const o of [1, 4, 8, 12, 16].slice(0, perEp)) ev.push({ t: START + d * D + o * H + 600000, label: "STRESS" });
  let calm = 0;
  for (let t = START + 5 * H; calm < nCalm && t < START + 120 * D; t += 7 * H) {
    if (stressLabel(t, HOURS, JUDGED) === "CALM") { ev.push({ t, label: "CALM" }); calm++; }
  }
  return ev.sort((a, b) => a.t - b.t).map((e, i) => ({ t: e.t, r: typeof (e.label === "STRESS" ? rStress : rCalm) === "function" ? (e.label === "STRESS" ? rStress : rCalm)(i) : (e.label === "STRESS" ? rStress : rCalm) }));
}
const judge = (events, at) => judgeStressStudy({ hoursMs: HOURS, judged: JUDGED, events, at });

test("nothing that trades imports the judge, and it takes the rule unchanged from stressHours.mjs", () => {
  for (const f of ["../nexus-agent-brain/index.js", "../nexus-agent-brain/logic.mjs", "../nexus-agent-exec/index.js", "../nexus-agent-exec/logic.mjs"]) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /stressGrading/, `${f} must not import the judge`);
  }
  const src = readFileSync(new URL("./stressGrading.mjs", import.meta.url), "utf8");
  assert.match(src, /import \{ STRESS_RULE, STRESS_STUDY, inStress, stressLabel \} from "\.\/stressHours\.mjs";/);
  assert.doesNotMatch(src, /windowH:|oiDrop:|breadth:|minShiftDays:\s*\d|seed:\s*\d/, "the judge must not restate the registered numbers");
});

test("mulberry32 under seed 20261031: pinned golden values", () => {
  const r = mulberry32(STRESS_STUDY.seed);
  assert.deepEqual([r(), r(), r()].map((x) => x.toFixed(12)), ["0.448612687876", "0.407898010220", "0.195983190089"]);
});

test("shifts: 1,000, at least 7 days from both ends of the circle, deterministic; too short a span is refused", () => {
  const a = drawShifts(1000), b = drawShifts(1000);
  assert.ok(a.ok);
  assert.equal(a.shiftsH.length, 1000);
  assert.deepEqual(a.shiftsH, b.shiftsH);
  assert.deepEqual(a.shiftsH.slice(0, 5), [466, 439, 298, 740, 612]);
  for (const k of a.shiftsH) { assert.ok(k >= 168 && 1000 - k >= 168, `shift ${k}h is within 7 days of no shift`); assert.ok(Number.isInteger(k)); }
  assert.deepEqual(drawShifts(335), { ok: false, error: "span_too_short" });
  assert.ok(drawShifts(336).ok);
  assert.ok(drawShifts(336).shiftsH.every((k) => k === 168));
});

test("reading the series back by k is the same as shifting the series forward by k round the circle", () => {
  const spanH = 60 * 24, span = spanH * H;
  const inside = HOURS.filter((t) => t >= START && t < START + span);
  for (const k of [168, 500, 1100]) {
    const shifted = inside.map((t) => START + ((t - START + k * H) % span)).sort((x, y) => x - y);
    for (let t = START + 30 * H; t < START + span; t += 13 * H) {
      // compare away from the wrap seam, where a window would straddle the circle's end
      const seam = (START + span - t) < 26 * H;
      if (seam) continue;
      assert.equal(shiftedIsStress(t, k, START, spanH, inside), inStress(t, shifted), `t=${(t - START) / H}h k=${k}`);
    }
  }
});

test("Holm: step-down in p order, stops at the first failure", () => {
  const h = holm([{ name: "a", p: 0.01 }, { name: "b", p: 0.04 }, { name: "c", p: 0.03 }, { name: "d", p: 0.005 }]);
  assert.deepEqual(Object.fromEntries(Object.entries(h).map(([k, v]) => [k, [v.rank, v.significant]])), { d: [1, true], a: [2, true], c: [3, false], b: [4, false] });
  assert.equal(h.d.threshold, 0.05 / 4);
  // a later p under its own threshold is still not rejected once an earlier one failed
  const g = holm([{ name: "x", p: 0.02 }, { name: "y", p: 0.026 }, { name: "z", p: 0.049 }]);
  assert.deepEqual([g.x.significant, g.y.significant, g.z.significant], [false, false, false]);
});

test("interim calls never disagree with the final Holm (p ≤ α/7 is in, p > α is out, whatever the family)", () => {
  const rnd = mulberry32(7);
  for (let trial = 0; trial < 2000; trial++) {
    const m = 1 + Math.floor(rnd() * 7);
    const rows = Array.from({ length: m }, (_, i) => ({ name: `r${i}`, p: rnd() < 0.3 ? rnd() * 0.01 : rnd() * 0.2 }));
    const final = holm(rows);
    for (const r of rows) {
      if (r.p <= 0.05 / 7) assert.equal(final[r.name].significant, true, `p=${r.p} m=${m}`);
      if (r.p > 0.05) assert.equal(final[r.name].significant, false, `p=${r.p} m=${m}`);
    }
  }
});

test("worse in stress: judged at cutoff + 168h on the 30/30 population, final at once (p ≤ α/7)", () => {
  const ev = tape({ rStress: -1, rCalm: 1 });
  const pop = readPopulation(ev, { hoursMs: HOURS, judged: JUDGED, startMs: START, endMs: LIMIT });
  assert.ok(pop.reached);
  const judgeAt = pop.cutoffT + R_HOLD_H * H;
  assert.equal(judge({ level_reclaim: { main: ev } }, judgeAt - 1).reads.level_reclaim.status, "RIPENING");
  const r = judge({ level_reclaim: { main: ev } }, judgeAt).reads.level_reclaim;
  assert.equal(r.status, "JUDGED");
  assert.equal(r.judgedAt, judgeAt);
  assert.equal(r.d, -2);
  assert.ok(r.p <= 0.05 / 7, `p=${r.p}`);
  assert.equal(r.verdict, "WORSE_IN_STRESS");
  assert.equal(r.final, true);
  assert.equal(r.holm.familyComplete, false, "the other six are still accruing");
});

test("the same answer whenever it runs: later events, later stress hours and a later clock change nothing", () => {
  const ev = tape({ rStress: (i) => ((i * 37) % 11) / 5 - 1.2, rCalm: (i) => ((i * 53) % 13) / 6 - 0.9 });
  const pop = readPopulation(ev, { hoursMs: HOURS, judged: JUDGED, startMs: START, endMs: LIMIT });
  const judgeAt = pop.cutoffT + R_HOLD_H * H;
  const a = judge({ oi_div_reversal: { main: ev } }, judgeAt).reads.oi_div_reversal;
  const more = [...ev, ...Array.from({ length: 20 }, (_, i) => ({ t: judgeAt + i * 5 * H, r: 3 }))];
  const laterHours = [...HOURS, judgeAt + 2 * D, judgeAt + 9 * D].sort((x, y) => x - y);
  const b = judgeStressStudy({ hoursMs: laterHours, judged: JUDGED, events: { oi_div_reversal: { main: more } }, at: judgeAt + 40 * D }).reads.oi_div_reversal;
  for (const k of ["d", "p", "meanStress", "meanCalm", "cutoffT", "judgedAt", "spanH", "verdict"]) assert.deepEqual(b[k], a[k], k);
  assert.deepEqual(judge({ oi_div_reversal: { main: ev } }, judgeAt), judge({ oi_div_reversal: { main: ev } }, judgeAt), "deterministic");
});

test("p is the share of valid shifts at least as extreme, no +1: a perfect split can reach 0", () => {
  const ev = tape({ rStress: -1, rCalm: 1 });
  const pop = readPopulation(ev, { hoursMs: HOURS, judged: JUDGED, startMs: START, endMs: LIMIT });
  const r = judge({ level_reclaim: { main: ev } }, pop.cutoffT + R_HOLD_H * H).reads.level_reclaim;
  assert.ok(r.validShifts > 0 && r.validShifts <= 1000);
  assert.ok(Number.isInteger(Math.round(r.p * r.validShifts * 1e9) / 1e9), "p is a count over the valid shifts");
  assert.equal(r.p, 0);
});

test("a shift with an empty side is left out of the share, never counted as extreme", () => {
  // all stress hours inside one short stretch; over a long span most shifts find no stress at all
  const ev = tape({ rStress: -1, rCalm: 1, perEp: 4 });
  const out = judge({ level_reclaim: { main: ev } }, LIMIT + 2 * D).reads.level_reclaim;
  assert.ok(out.validShifts < 1000, "some shifts had no STRESS side");
  assert.equal(out.p, 0, "the empty shifts don't inflate p");
  const none = judgeStressStudy({ hoursMs: [], judged: JUDGED, events: { level_reclaim: { main: ev } }, at: LIMIT + 2 * D }).reads.level_reclaim;
  assert.equal(none.counts.STRESS, 0, "no stress hours: nothing is STRESS");
  assert.equal(none.verdict, "NOT_ENOUGH_STRESS");
});

test("no difference: R unrelated to the label is NO_DIFFERENCE, final once p > α", () => {
  const ev = tape({ rStress: (i) => ((i * 7919) % 17) / 8 - 1, rCalm: (i) => ((i * 7919) % 17) / 8 - 1 });
  const pop = readPopulation(ev, { hoursMs: HOURS, judged: JUDGED, startMs: START, endMs: LIMIT });
  const r = judge({ session_momentum: { main: ev } }, pop.cutoffT + R_HOLD_H * H).reads.session_momentum;
  assert.equal(r.status, "JUDGED");
  assert.ok(r.p > 0.05, `p=${r.p}`);
  assert.equal(r.verdict, "NO_DIFFERENCE");
  assert.equal(r.final, true);
});

test("better in stress is named, and licenses nothing", () => {
  const ev = tape({ rStress: 1, rCalm: -1 });
  const pop = readPopulation(ev, { hoursMs: HOURS, judged: JUDGED, startMs: START, endMs: LIMIT });
  assert.equal(judge({ confluence_follow: { main: ev } }, pop.cutoffT + R_HOLD_H * H).reads.confluence_follow.verdict, "BETTER_IN_STRESS");
});

test("significantly lower but STRESS mean R ≥ 0 is a gap the page doesn't name: no verdict", () => {
  const ev = tape({ rStress: 0.5, rCalm: 1.5 });
  const pop = readPopulation(ev, { hoursMs: HOURS, judged: JUDGED, startMs: START, endMs: LIMIT });
  const r = judge({ oi_coil_break: { main: ev } }, pop.cutoffT + R_HOLD_H * H).reads.oi_coil_break;
  assert.equal(r.verdict, null);
  assert.equal(r.gap, "lower_in_stress_but_stress_mean_nonnegative");
});

test("out-of-sample only; an unresolved event before the cutoff makes the read wait", () => {
  const ev = tape({ rStress: -1, rCalm: 1 });
  const before = [{ t: START - 3 * H, r: -50 }];
  const pop = readPopulation(ev, { hoursMs: HOURS, judged: JUDGED, startMs: START, endMs: LIMIT });
  const at = pop.cutoffT + R_HOLD_H * H;
  assert.equal(judge({ level_reclaim: { main: [...before, ...ev] } }, at).reads.level_reclaim.d, -2, "a pre-registration event is ignored");
  const pending = ev.map((e, i) => (i === 3 ? { ...e, r: null } : e));
  assert.equal(judge({ level_reclaim: { main: pending } }, at).reads.level_reclaim.status, "WAITING_ON_PENDING");
});

test("short of 30/30 before the limit = ACCRUING; at the limit: ≥20 STRESS judged as it stands, <20 NOT_ENOUGH_STRESS, CALM short = gap", () => {
  const at = LIMIT + 2 * D;
  const thin = tape({ rStress: -1, rCalm: 1, perEp: 4 }); // 24 STRESS
  assert.equal(judge({ level_reclaim: { main: thin } }, START + 100 * D).reads.level_reclaim.status, "ACCRUING");
  const out = judge({
    level_reclaim: { main: thin },
    rsi_reset_deep: { main: tape({ rStress: -1, rCalm: 1, perEp: 2 }) },   // 12 STRESS
    oi_div_reversal: { main: tape({ rStress: -1, rCalm: 1, perEp: 4, nCalm: 25 }) },
  }, at);
  assert.equal(out.reads.level_reclaim.status, "JUDGED");
  assert.equal(out.reads.level_reclaim.counts.STRESS, 24);
  assert.equal(out.reads.level_reclaim.judgedAt, LIMIT);
  assert.equal(out.reads.rsi_reset_deep.verdict, "NOT_ENOUGH_STRESS");
  assert.equal(out.reads.oi_div_reversal.status, "INCOMPLETE");
  assert.equal(out.reads.oi_div_reversal.gap, "stress_enough_calm_short_at_limit");
  assert.equal(out.reads.session_momentum.verdict, "NOT_ENOUGH_STRESS", "no events at all");
  assert.equal(out.familyComplete, true);
  assert.equal(out.reads.level_reclaim.holm.familyComplete, true);
  assert.equal(out.reads.level_reclaim.holm.threshold, 0.05, "one read judged: Holm over a family of one");
  assert.equal(out.reads.level_reclaim.verdict, "WORSE_IN_STRESS");
});

test("a p between α/7 and α waits for the family (PENDING_HOLM)", () => {
  // a weak effect: stress a little worse on average, noisy
  const ev = tape({ rStress: (i) => (i % 3 === 0 ? 0.6 : -0.9), rCalm: (i) => (i % 4 === 0 ? -0.8 : 0.4) });
  const pop = readPopulation(ev, { hoursMs: HOURS, judged: JUDGED, startMs: START, endMs: LIMIT });
  const r = judge({ level_reclaim: { main: ev } }, pop.cutoffT + R_HOLD_H * H).reads.level_reclaim;
  assert.equal(r.p, 0.019, "this tape sits inside the waiting band");
  assert.equal(r.pending, "PENDING_HOLM");
  assert.equal(r.verdict, null);
  assert.equal(r.final, false);
  // once the family is complete (at the limit, the rest out), Holm over a family of one decides it
  const done = judge({ level_reclaim: { main: ev } }, LIMIT + 2 * D).reads.level_reclaim;
  assert.equal(done.holm.familyComplete, true);
  assert.equal(done.p, 0.019, "the p frozen at its own judging time");
  assert.equal(done.verdict, "WORSE_IN_STRESS");
});

test("the holdout line is shown, never in the Holm family, never a verdict", () => {
  const ev = tape({ rStress: -1, rCalm: 1 });
  const out = judge({ level_reclaim: { main: [], holdout: ev } }, LIMIT - D);
  const r = out.reads.level_reclaim;
  assert.equal(r.status, "ACCRUING");
  assert.equal(r.verdict, null);
  assert.equal(r.holdout.informational, true);
  assert.equal(r.holdout.d, -2);
  assert.equal(r.holm, undefined);
});

test("labels in the judge are the registered labels", () => {
  const ev = tape({ rStress: -1, rCalm: 1 });
  const pop = readPopulation(ev, { hoursMs: HOURS, judged: JUDGED, startMs: START, endMs: LIMIT });
  for (const e of pop.all) assert.equal(e.label, stressLabel(e.t, HOURS, JUDGED, STRESS_RULE));
});
