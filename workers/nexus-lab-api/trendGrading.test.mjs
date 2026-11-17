// trendGrading.mjs: the trend gate's judge (docs/research/trend-gate-prereg.md). Run: node --test workers/nexus-lab-api/trendGrading.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { btcTrendByHour, TREND_GATE_STUDY } from "./trendGate.mjs";
import { mulberry32 } from "./stressGrading.mjs";
import { judgeTrendGate, drawTrendShifts, trendPopulation, shiftedTrendLabel, labelHour, TREND_GATE_SEED, TREND_VERDICT_LABELS } from "./trendGrading.mjs";

const H = 3600000, D = 86400000;
const START = Date.parse(TREND_GATE_STUDY.from), LIMIT = Date.parse(TREND_GATE_STUDY.limit);

// A BTC tape with trends of random length (2 to 10 days), not a periodic wave: a periodic one would let a
// half-period shift invert every label, which no real tape does.
function makeTape(seed = 7) {
  const rnd = mulberry32(seed), tape = [];
  let px = 100, drift = 0, left = 0;
  for (let t = Date.parse("2026-10-01T00:00:00Z"); t < LIMIT + 7 * D; t += H) {
    if (left-- <= 0) { drift = (rnd() < 0.5 ? -1 : 1) * 0.0015; left = 48 + Math.floor(rnd() * 192); }
    px *= 1 + drift + (rnd() - 0.5) * 0.004;
    tape.push({ t, o: px, h: px, l: px, c: px, v: 1 });
  }
  return tape;
}
const TREND = btcTrendByHour(makeTape());
const trueLabel = (t, side) => {
  const tr = TREND.get(labelHour(t));
  return !tr ? null : (side === "LONG") === (tr === "UP") ? "WITH" : "AGAINST";
};
// Events every `every` hours from `from`, sides alternating; R from the event's true label.
function events(rFor, { from = START + 2 * H, every = 13, days = 70, seed = 3 } = {}) {
  const rnd = mulberry32(seed), out = [];
  let i = 0;
  for (let t = from; t < from + days * D; t += every * H, i++) {
    const side = i % 2 ? "LONG" : "SHORT";
    out.push({ t, side, r: rFor(trueLabel(t, side), rnd, i) });
  }
  return out;
}
const REG = Object.fromEntries(TREND_GATE_STUDY.reads.map((n) => [n, "2026-10-17T00:00:00Z"]));
const judge = (main, { at = Date.parse("2027-03-01T00:00:00Z"), name = "level_reclaim", holdout, registeredAt = REG } = {}) =>
  judgeTrendGate({ trendByHour: TREND, events: { [name]: { main, holdout } }, registeredAt, at }).reads[name];

test("the shifts: own seed, golden vector, ≥ 7 days both ways round the circle, short span refused", () => {
  assert.equal(TREND_GATE_SEED, 20261116);
  const d = drawTrendShifts(2000);
  assert.deepEqual(d.shiftsH.slice(0, 6), [582, 339, 978, 803, 1028, 1605]);
  assert.equal(d.shiftsH.length, 1000);
  for (const k of d.shiftsH) assert.ok(k >= 168 && 2000 - k >= 168, `${k}`);
  assert.deepEqual(drawTrendShifts(335), { ok: false, error: "span_too_short" });
  assert.deepEqual(drawTrendShifts(2000), d, "same span, same draws");
});

test("a shifted label reads BTC's trend at the event's hour moved back k hours, wrapped inside the study", () => {
  const startH = Math.floor(START / H), spanH = 24 * 60;
  const e = { t: START + 300 * H, side: "LONG" };
  for (const k of [168, 500, 1000]) {
    const back = startH + ((((labelHour(e.t) - startH - k) % spanH) + spanH) % spanH);
    const tr = TREND.get(back);
    assert.equal(shiftedTrendLabel(e, k, startH, spanH, TREND), tr ? (tr === "UP" ? "WITH" : "AGAINST") : null);
  }
  assert.equal(shiftedTrendLabel(e, 0, startH, spanH, TREND), trueLabel(e.t, "LONG"), "no shift = the real label");
});

test("a real gap is found: AGAINST loses while WITH wins → AGAINST_WORSE, licenses one block PR", () => {
  const r = judge(events((l, rnd) => (l === "WITH" ? 0.6 : -0.6) + (rnd() - 0.5)));
  assert.equal(r.status, "JUDGED");
  assert.equal(r.verdict, "AGAINST_WORSE");
  assert.equal(r.label, TREND_VERDICT_LABELS.AGAINST_WORSE);
  assert.equal(r.licensesBlock, true);
  assert.ok(r.p <= 0.01 && r.d > 0 && r.meanAgainst < 0);
  assert.equal(r.validShifts, 1000);
});

test("no gap: R that ignores the trend → NO_DIFFERENCE, licenses nothing", () => {
  const r = judge(events((l, rnd) => (rnd() - 0.5) * 2));
  assert.equal(r.verdict, "NO_DIFFERENCE");
  assert.equal(r.licensesBlock, false);
  assert.ok(r.p > 0.05);
  const flat = judge(events(() => 0.1));
  assert.equal(flat.p, 1, "d = 0: every shift is at least as far from 0");
  assert.equal(flat.verdict, "NO_DIFFERENCE");
});

test("lower against the trend but still positive → LOWER_STILL_POSITIVE, licenses nothing", () => {
  const r = judge(events((l, rnd) => (l === "WITH" ? 1.2 : 0.3) + (rnd() - 0.5) * 0.4));
  assert.equal(r.verdict, "LOWER_STILL_POSITIVE");
  assert.equal(r.licensesBlock, false);
});

test("worse WITH the trend → WITH_WORSE, never a licence to trade against it", () => {
  const r = judge(events((l, rnd) => (l === "WITH" ? -0.6 : 0.6) + (rnd() - 0.5)));
  assert.equal(r.verdict, "WITH_WORSE");
  assert.equal(r.licensesBlock, false);
});

test("timing: RIPENING until cutoff + 168h; WAITING_ON_PENDING while an earlier R is missing; a later re-run gives the same p", () => {
  const evs = events((l, rnd) => (l === "WITH" ? 0.6 : -0.6) + (rnd() - 0.5));
  const done = judge(evs);
  const cutoff = done.cutoffT;
  assert.equal(judge(evs, { at: cutoff + 100 * H }).status, "RIPENING");
  assert.equal(judge(evs, { at: cutoff + 100 * H }).verdict, null);
  assert.equal(done.judgedAt, cutoff + 168 * H);
  const pending = evs.map((e, i) => (i === 3 ? { ...e, r: null } : e));
  assert.equal(judge(pending, { at: cutoff + 200 * H }).status, "WAITING_ON_PENDING");
  for (const at of [cutoff + 168 * H, cutoff + 400 * H, LIMIT + D]) {
    const r = judge(evs, { at });
    assert.equal(r.p, done.p, `p at ${new Date(at).toISOString()}`);
    assert.equal(r.d, done.d);
    assert.equal(r.spanH, done.spanH);
  }
});

test("out-of-sample: events before the study start or the read's own registration never count", () => {
  const early = events(() => 1, { from: START - 20 * D, days: 19 });
  assert.equal(judge(early).counts.WITH + judge(early).counts.AGAINST, 0);
  const evs = events((l) => (l === "WITH" ? 1 : -1), { days: 10 });
  const reg = { ...REG, spot_absorb: "2026-11-20T00:00:00Z" };
  const r = judge(evs, { name: "spot_absorb", registeredAt: reg });
  const after = evs.filter((e) => e.t >= Date.parse("2026-11-20T00:00:00Z")).length;
  assert.equal(r.counts.WITH + r.counts.AGAINST + r.counts.UNLABELLED, after);
  assert.equal(r.from, Date.parse("2026-11-20T00:00:00Z"));
  const missing = judgeTrendGate({ trendByHour: TREND, events: {}, registeredAt: {}, at: LIMIT }).reads.level_reclaim;
  assert.equal(missing.status, "REFUSED");
  assert.equal(missing.error, "no_registration");
});

test("at the limit: < 20 on a side = NOT_ENOUGH; 20+ small and 30+ other = judged as it stands; both 20–29 = NEEDS_RULING", () => {
  const pick = (label, n) => events((l) => (l === "WITH" ? 0.5 : -0.5), { every: 7, days: 170 })
    .filter((e) => trueLabel(e.t, e.side) === label).slice(0, n);
  const mix = (w, a) => [...pick("WITH", w), ...pick("AGAINST", a)].sort((x, y) => x.t - y.t);
  const at = LIMIT + D;
  const few = judge(mix(40, 12), { at });
  assert.deepEqual([few.status, few.verdict, few.final, few.licensesBlock], ["NOT_ENOUGH", "NOT_ENOUGH", true, false]);
  const asIs = judge(mix(45, 22), { at });
  assert.equal(asIs.status, "JUDGED");
  assert.equal(asIs.judgedAt, LIMIT);
  const gap = judge(mix(25, 24), { at });
  assert.equal(gap.status, "NEEDS_RULING");
  assert.equal(gap.verdict, null);
  assert.equal(gap.final, false);
  assert.equal(judge(mix(25, 24), { at: LIMIT - D }).status, "ACCRUING", "before the limit it just accrues");
});

test("Holm across the 13: a borderline p waits for the family; p ≤ α/13 stands alone", () => {
  const strong = judge(events((l, rnd) => (l === "WITH" ? 0.6 : -0.6) + (rnd() - 0.5)));
  assert.equal(strong.holm.familyComplete, false);
  assert.equal(strong.holm.significant, true);
  // A full family: every other read NOT_ENOUGH at the limit → Holm runs over the judged ones only.
  const all = judgeTrendGate({ trendByHour: TREND, registeredAt: REG, at: LIMIT + D,
    events: { level_reclaim: { main: events((l, rnd) => (l === "WITH" ? 0.6 : -0.6) + (rnd() - 0.5)) } } });
  assert.equal(all.familyComplete, true);
  assert.equal(all.reads.level_reclaim.verdict, "AGAINST_WORSE");
  for (const n of TREND_GATE_STUDY.reads.filter((x) => x !== "level_reclaim")) assert.equal(all.reads[n].verdict, "NOT_ENOUGH");
});

test("the holdout line is display only: its own d and p, never a verdict, never in Holm", () => {
  const main = events((l, rnd) => (rnd() - 0.5) * 2);
  const hold = events((l, rnd) => (l === "WITH" ? 0.6 : -0.6) + (rnd() - 0.5), { seed: 9 });
  const r = judge(main, { holdout: hold });
  assert.equal(r.holdout.informational, true);
  assert.ok(r.holdout.p <= 0.01, "the holdout gap is measured");
  assert.equal(r.verdict, "NO_DIFFERENCE", "but only the main line is judged");
  assert.equal(r.holdout.verdict, undefined);
});

test("population: UNLABELLED events are counted but never in either side", () => {
  const evs = [{ t: START + 2 * H, side: "FLAT", r: 1 }, { t: START + 3 * H, side: "LONG", r: 1 }];
  const p = trendPopulation(evs, { trendByHour: TREND, startMs: START, endMs: LIMIT });
  assert.equal(p.counts.UNLABELLED, 1);
  assert.equal(p.all.length, 1);
});

test("measurement only: brain and exec never import the judge or the label", () => {
  const root = new URL("../../", import.meta.url);
  const scan = (dir) => (existsSync(new URL(dir, root)) ? readdirSync(new URL(dir, root), { recursive: true }) : [])
    .filter((f) => /\.(mjs|js|ts|tsx)$/.test(f) && !String(f).includes("node_modules"))
    .map((f) => [`${dir}/${f}`, readFileSync(new URL(`${dir}/${f}`, root), "utf8")]);
  const users = [...scan("workers/nexus-agent-brain"), ...scan("workers/nexus-agent-exec")]
    .filter(([, src]) => /trendGrading\.mjs|trendGate\.mjs/.test(src));
  assert.deepEqual(users.map(([f]) => f), []);
});
