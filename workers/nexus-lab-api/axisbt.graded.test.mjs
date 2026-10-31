// The graded exit (R contract) as the agent trades it — the scoreboard's `exitGraded` line.
// Stop = 1.2× H4 ATR-14 at the event hour, target = 1.5× the stop, 168h hold, fees in, a timeout
// closed at the market on that bar. Same rule as exec's paper entries (app/lib/gradedExit.mjs).
// Run: node --test workers/nexus-lab-api/axisbt.graded.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { gradeEventExit, scoreGradedExit, scoreEvents, scoreExitVariants, runScorecard, candlesByHour, hourBucket, atrPctH4At, GRADED_EXIT_SPEC, GRADED_EXIT_AXES } from "./axisbt.mjs";
import { GRADED_EXIT_OOS_CUTOFF_MS, GRADED_EXIT_LOOKBACK_H, gradedExitLevels, gradedExitLevelsFromHourly } from "../../app/lib/gradedExit.mjs";
import { AXIS_EXITS } from "../../app/lib/axisExits.mjs";

const HR = 3600 * 1000;
const BASE = Date.UTC(2026, 9, 20, 0, 0, 0); // hour-aligned, after the oos cutoff
const H0 = hourBucket(BASE);
// 80h of history up to and including the event hour: every hour high 101 / low 99 / close 100
// → every 4H bar has range 2 on a 100 close → H4 ATR-14 = 2% → stop 2.4%, target 3.6%.
const hist = (n = GRADED_EXIT_LOOKBACK_H, base = BASE) =>
  Array.from({ length: n }, (_, k) => ({ t: base - (n - 1 - k) * HR, o: 100, h: 101, l: 99, c: 100 }));
// Each future bar opens at the previous close (the history ends at 100): the open is where a gap fills.
const after = (rows, base = BASE) => rows.map((r, i) => ({ t: base + (i + 1) * HR, o: i ? rows[i - 1].c : 100, ...r }));
const flat = (n, p = 100) => Array.from({ length: n }, () => ({ h: p * 1.001, l: p * 0.999, c: p }));
const tapeOf = (future, base = BASE) => candlesByHour([...hist(GRADED_EXIT_LOOKBACK_H, base), ...after(future, base)]);
const SPEC = GRADED_EXIT_SPEC;

test("levels: stop = 1.2× the H4 ATR, target = 1.5× the stop", () => {
  const cbh = tapeOf(flat(5));
  assert.ok(Math.abs(atrPctH4At(cbh, H0) - 0.02) < 1e-12);
  assert.deepEqual(gradedExitLevels(0.02), { slPercent: 2.4, tpPercent: 3.6 });
});

test("target hit → TP; the stop sits at 2.4%, so a 2.3% dip that the flat 2% stop would take is survived", () => {
  const cbh = tapeOf([{ h: 100.2, l: 97.7, c: 98 }, ...flat(3), { h: 103.7, l: 100, c: 103.5 }, ...flat(10, 103.5)]);
  const g = gradeEventExit(cbh, H0, "LONG", 100, SPEC);
  assert.equal(g.reason, "TP");
  assert.equal(g.slPercent, 2.4);
  // the preset's flat exit stops out on the same tape
  assert.equal(gradeEventExit(cbh, H0, "LONG", 100, { tpPercent: 2.5, slPercent: 2, maxHoldHours: 12 }).reason, "SL");
});

test("stop past 2.4% → SL", () => {
  const g = gradeEventExit(tapeOf([{ h: 100.2, l: 97.5, c: 97.6 }, ...flat(5)]), H0, "LONG", 100, SPEC);
  assert.equal(g.reason, "SL");
  assert.ok(g.pnlPct <= -2.4);
});

test("no touch in 168h → closed at the market on that bar, not credited 0 the way the R grade does", () => {
  const g = gradeEventExit(tapeOf(flat(200, 101)), H0, "LONG", 100, SPEC);
  assert.equal(g.reason, "TIMEOUT");
  assert.equal(g.holdH, 168);
  // a timeout closes at the first price of its bar, the open (101), not the bar's adverse extreme
  // (measurement change 2026-10-31; it used to fill at 101 × 0.999, +0.899%)
  assert.ok(Math.abs(g.pnlPct - 1) < 1e-6, `got ${g.pnlPct}`);
});

test("no ATR (too little history) → null: the agent would sit it out, the line leaves it out", () => {
  const cbh = candlesByHour([...hist(20), ...after(flat(200))]);
  assert.equal(gradeEventExit(cbh, H0, "LONG", 100, SPEC), null);
});

test("exec's level rule and the grader's agree on the same candles (parity)", () => {
  // uneven ranges so the window boundaries matter
  const rows = Array.from({ length: 120 }, (_, k) => {
    const r = 0.5 + ((k * 7) % 11) / 4;
    return { t: BASE - (119 - k) * HR, o: 100, h: 100 + r, l: 100 - r * 0.8, c: 100 + ((k % 5) - 2) * 0.1 };
  });
  const cbh = candlesByHour(rows);
  // exec reads tv/history: seconds, everything up to now (the event hour's candle included)
  const execLv = gradedExitLevelsFromHourly(rows.map((c) => ({ t: c.t / 1000, h: c.h, l: c.l, c: c.c })));
  const gradeLv = gradedExitLevels(atrPctH4At(cbh, H0));
  assert.ok(execLv && gradeLv);
  assert.deepEqual(execLv, gradeLv);
});

test("scoreGradedExit: fee deducted, oos from the pre-registered cutoff, stop size reported", () => {
  // two events far apart on one market: the first wins (+3.6% target), the second times out flat
  const base2 = BASE + 300 * HR;
  const future = [...flat(2), { h: 103.7, l: 100, c: 103.6 }, ...flat(600)];
  const cbh = candlesByHour([...hist(GRADED_EXIT_LOOKBACK_H), ...after(future)]);
  const pmap = new Map(Array.from({ length: 800 }, (_, h) => [H0 - 100 + h, 100]));
  const all = [
    { t: BASE, side: "LONG", coin: "BTC", pmap, cbh },
    { t: base2, side: "LONG", coin: "BTC", pmap, cbh },
  ];
  const x = scoreGradedExit(all, BASE, 1);
  assert.equal(x.samples, 2);
  assert.equal(x.feeBps, 3);
  assert.equal(x.exits.TP, 1);
  assert.equal(x.exits.TIMEOUT, 1);
  assert.equal(x.maxHoldHours, 168);
  assert.equal(x.exitContract, "R_CONTRACT");
  assert.equal(x.atrMult, 1.2); assert.equal(x.rMultiple, 1.5);
  assert.equal(x.presetExit, false);
  // first: +3.7% (fills at the bar's high) − 0.06% fee; second: flat close − 0.06% fee
  assert.ok(x.netBps < 370 / 2, "fees come off");
  assert.equal(x.oos.since, new Date(GRADED_EXIT_OOS_CUTOFF_MS).toISOString());
  assert.equal(x.oos.samples, 2, "both entries are after Oct 16");
  assert.ok(x.avgSlPercent > 0);
});

test("adding the graded line changes nothing on the 12h / 24h lines", () => {
  const cs = { coin: "BTC", oiHist: Array.from({ length: 300 }, (_, i) => ({ t: BASE - 100 * HR + i * HR, price: 100, oi: 1, funding: 0 })), candleHist: [...hist(GRADED_EXIT_LOOKBACK_H), ...after(flat(250))] };
  const gen = () => [{ t: BASE, side: "LONG" }];
  const opts = { horizons: [4], minSamples: 1, exit: AXIS_EXITS.basis_x_cvd };
  const off = scoreEvents([cs], gen, opts), on = scoreEvents([cs], gen, { ...opts, gradedExit: true });
  assert.deepEqual(on.exit, off.exit);
  assert.deepEqual(on.exit24h, off.exit24h);
  assert.equal(off.exitGraded, null);
  assert.ok(on.exitGraded && on.exitGraded.samples === 1);
  assert.ok(scoreExitVariants); // imported so a rename breaks this file loudly
});

test("runScorecard: only the registered axes carry the graded line (basis_x_cvd + pipeline reads)", () => {
  assert.deepEqual([...GRADED_EXIT_AXES], ["basis_x_cvd", "rsi_reset_deep", "level_reclaim", "oi_div_reversal", "session_momentum", "confluence_follow", "oi_div_reversal_4h", "oi_coil_break"]);
  const sc = runScorecard([{ coin: "BTC", oiHist: Array.from({ length: 5 }, (_, i) => ({ t: BASE + i * HR, price: 100, oi: 1, funding: 0 })) }], { horizons: [4], minSamples: 20 });
  for (const a of sc.axes) {
    if (GRADED_EXIT_AXES.includes(a.name)) assert.ok(a.exitGraded, `${a.name} graded line`);
    else assert.equal(a.exitGraded, null, a.name);
  }
});

// ── "Net of funding" beside the graded exit (informational) ─────────────────────────────────
import { fundingByHour } from "../../app/lib/funding.mjs";
const fundedSet = (rate) => ({
  coin: "BTC",
  oiHist: Array.from({ length: 600 }, (_, i) => ({ t: BASE - 100 * HR + i * HR, price: 100, oi: 1, funding: rate })),
  candleHist: [...hist(GRADED_EXIT_LOOKBACK_H), ...after(flat(400))],
});
const oneLong = () => [{ t: BASE, side: "LONG" }];
const oneShort = () => [{ t: BASE, side: "SHORT" }];

test("net of funding: a long held 168h at +0.01%/8h pays 21 bps; the grade itself is untouched", () => {
  const paid = scoreEvents([fundedSet(0.0001)], oneLong, { horizons: [4], minSamples: 1, gradedExit: true }).exitGraded;
  const free = scoreEvents([fundedSet(0)], oneLong, { horizons: [4], minSamples: 1, gradedExit: true }).exitGraded;
  assert.equal(paid.samples, 1);
  assert.equal(paid.funding.estimate, true);
  assert.equal(paid.funding.samples, 1);
  assert.ok(Math.abs(paid.funding.costBps - 21) < 0.2, `cost ${paid.funding.costBps}`);
  assert.ok(Math.abs(paid.funding.netBps - (paid.netBps - 21)) < 0.2);
  assert.equal(paid.funding.feesNetBps, paid.netBps, "same trades as the headline when every trade is covered");
  assert.ok(Math.abs(paid.funding.netBps - (paid.funding.feesNetBps - 21)) < 0.2);
  assert.ok(Math.abs(paid.funding.oos.costBps - 21) < 0.2, "the oos line carries it too");
  // the verdict, the fee-net number and everything the pipeline reads are identical with or without funding
  const { funding: _a, ...gradePaid } = paid, { funding: _b, ...gradeFree } = free;
  assert.deepEqual(gradePaid, gradeFree);
  assert.equal(free.funding.costBps, 0);
});

test("net of funding: a short at the same rate collects it", () => {
  const g = scoreEvents([fundedSet(0.0001)], oneShort, { horizons: [4], minSamples: 1, gradedExit: true }).exitGraded;
  assert.ok(g.funding.costBps < -20 && g.funding.netBps > g.netBps);
});

test("net of funding: a trade with no recorded funding is left out and counted, never read as free", () => {
  const cs = fundedSet(0.0001);
  cs.oiHist = cs.oiHist.map((p) => ({ ...p, funding: null }));
  const g = scoreEvents([cs], oneLong, { horizons: [4], minSamples: 1, gradedExit: true }).exitGraded;
  assert.equal(g.samples, 1);
  assert.equal(g.funding.samples, 0);
  assert.equal(g.funding.missing, 1);
  assert.equal(g.funding.feesNetBps, 0, "the fee-net is over the covered trades only (none here)");
  assert.ok(fundingByHour(cs.oiHist).size === 0);
});

test("net of funding rides only the graded exit, not the preset 12h / 24h lines", () => {
  const s = scoreEvents([fundedSet(0.0001)], oneLong, { horizons: [4], minSamples: 1, exit: AXIS_EXITS.basis_x_cvd, gradedExit: true });
  assert.equal(s.exit.funding, undefined);
  assert.equal(s.exit24h.funding, undefined);
  assert.ok(s.exitGraded.funding);
});

test("net of funding: with some trades uncovered, fees-net and net-of-funding compare the SAME trades", () => {
  const covered = fundedSet(0.0001);
  const gap = { ...fundedSet(0.0001), coin: "ETH" };
  gap.oiHist = gap.oiHist.map((p) => ({ ...p, funding: null }));
  // the uncovered market wins big; the covered one times out flat: the headline mixes both
  gap.candleHist = [...hist(GRADED_EXIT_LOOKBACK_H), ...after([...flat(2), { h: 103.7, l: 100, c: 103.6 }, ...flat(400)])];
  const g = scoreEvents([covered, gap], oneLong, { horizons: [4], minSamples: 1, gradedExit: true }).exitGraded;
  assert.equal(g.samples, 2);
  assert.deepEqual([g.funding.samples, g.funding.missing], [1, 1]);
  assert.ok(g.netBps > g.funding.feesNetBps, "the headline includes the uncovered winner");
  assert.ok(Math.abs(g.funding.netBps - (g.funding.feesNetBps - 21)) < 0.2, "funding is the only gap on the same trades");
});
