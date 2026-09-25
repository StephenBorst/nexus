// Exit-matched grading: a read traded through a preset's own tp / sl / max-hold exit,
// walked along logged hourly candles with the backtest's shared stepExit.
// Run: node --test workers/nexus-lab-api/axisbt.exit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { gradeEventExit, scoreExit, scoreEvents, runScorecard, candlesByHour, hourBucket, EXIT_GRACE_H } from "./axisbt.mjs";
import { AXIS_EXITS } from "../../app/lib/axisExits.mjs";

const HR = 3600 * 1000;
const BASE = 1_000_000_000_000;
const H0 = hourBucket(BASE);
const EXIT = { preset: "t", tpPercent: 2.5, slPercent: 2, maxHoldHours: 12 };
// Candles at hours H0+1.. from [{h,l,c}] (open irrelevant to the exit path).
const bars = (rows, start = 1) => candlesByHour(rows.map((r, i) => ({ t: BASE + (start + i) * HR, o: r.c, h: r.h, l: r.l, c: r.c })));
const flat = (n, p = 100) => Array.from({ length: n }, () => ({ h: p * 1.001, l: p * 0.999, c: p }));

test("LONG reaches the target → TP at +tp%, held until that bar", () => {
  const cbh = bars([...flat(2), { h: 103, l: 99.5, c: 102.8 }, ...flat(20)]);
  const g = gradeEventExit(cbh, H0, "LONG", 100, EXIT);
  assert.equal(g.reason, "TP");
  assert.equal(g.holdH, 3);
  assert.ok(Math.abs(g.pnlPct - 3) < 1e-9, "fills at the bar's favourable extreme the evaluator first sees past TP");
});

test("SHORT stop is hit → SL; a bar touching BOTH stop and target stops out (conservative)", () => {
  const sl = gradeEventExit(bars([...flat(1), { h: 102.5, l: 99.9, c: 102 }, ...flat(20)]), H0, "SHORT", 100, EXIT);
  assert.equal(sl.reason, "SL");
  assert.ok(sl.pnlPct <= -2);
  const both = gradeEventExit(bars([{ h: 103, l: 97, c: 100 }, ...flat(20)]), H0, "LONG", 100, EXIT);
  assert.equal(both.reason, "SL");
});

test("no touch → TIMEOUT on the bar where the max hold is reached", () => {
  const g = gradeEventExit(bars(flat(30)), H0, "LONG", 100, EXIT);
  assert.equal(g.reason, "TIMEOUT");
  assert.equal(g.holdH, 12);
  assert.ok(Math.abs(g.pnlPct) < 0.2);
});

test("right-censored: candles end before any exit → null (left out, never credited)", () => {
  assert.equal(gradeEventExit(bars(flat(5)), H0, "LONG", 100, EXIT), null);
  // a data gap that swallows the whole hold + grace → null too
  assert.equal(gradeEventExit(bars(flat(3), 12 + EXIT_GRACE_H + 5), H0, "LONG", 100, EXIT), null);
  assert.equal(gradeEventExit(new Map(), H0, "LONG", 100, EXIT), null);
  assert.equal(gradeEventExit(bars(flat(30)), H0, "LONG", 0, EXIT), null);
});

test("a missing bar is skipped, not treated as a fill", () => {
  const rows = flat(30); const cbh = bars(rows); cbh.delete(H0 + 12);
  const g = gradeEventExit(cbh, H0, "LONG", 100, EXIT);
  assert.equal(g.reason, "TIMEOUT");
  assert.equal(g.holdH, 13);
});

test("the exit grade is NOT the 12h horizon: a 12h round trip that crossed the stop grades as a loss", () => {
  // price dumps through the stop at hour 4, then recovers to +1% by hour 12
  const rows = [...flat(3), { h: 100, l: 97.5, c: 98 }, ...Array.from({ length: 7 }, () => ({ h: 99, l: 98, c: 98.5 })), { h: 101.2, l: 100.8, c: 101 }, ...flat(20, 101)];
  const g = gradeEventExit(bars(rows), H0, "LONG", 100, EXIT);
  assert.equal(g.reason, "SL");
  assert.ok(g.pnlPct < 0);
});

test("scoreExit: fee deducted, exits tallied, verdict needs samples + stability", () => {
  const mk = (i, win) => {
    const t = BASE + i * 100 * HR, h0 = hourBucket(t);
    const rows = win ? [{ h: 103, l: 99.9, c: 102 }] : [{ h: 100.1, l: 97, c: 98 }];
    const cbh = candlesByHour(rows.map((r) => ({ t: t + HR, o: 100, ...r })));
    return { t, side: "LONG", pmap: new Map([[h0, 100]]), cbh };
  };
  const all = Array.from({ length: 24 }, (_, i) => mk(i, i % 4 !== 0)); // 18 wins, 6 losses
  const medT = all[11].t;
  const x = scoreExit(all, EXIT, medT, 20, 3);
  assert.equal(x.samples, 24);
  assert.deepEqual(x.exits, { TP: 18, SL: 6, TIMEOUT: 0 });
  assert.equal(x.hitRate, 75);
  // wins fill at 3% (bar high 103 seen after TP threshold) minus 0.06% fee; losses at -3% minus fee
  assert.ok(Math.abs(x.netBps - ((18 * 294 + 6 * -306) / 24)) < 0.11);
  assert.equal(x.verdict, "PREDICTIVE");
  assert.equal(x.stable, true);
  assert.equal(scoreExit(all.slice(0, 10), EXIT, medT, 20, 3).verdict, "INSUFFICIENT");
  assert.equal(x.maxHoldHours, 12);
});

test("scoreEvents without an exit contract carries exit:null (every other axis unchanged)", () => {
  const cs = { coin: "BTC", oiHist: Array.from({ length: 40 }, (_, i) => ({ t: BASE + i * HR, price: 100, oi: 1, funding: 0 })) };
  const s = scoreEvents([cs], () => [{ t: BASE, side: "LONG" }], { horizons: [4], minSamples: 1 });
  assert.equal(s.exit, null);
});

test("runScorecard: axes with a trading preset carry the preset's exit grade; the rest carry null", () => {
  const sc = runScorecard([{ coin: "BTC", oiHist: Array.from({ length: 5 }, (_, i) => ({ t: BASE + i * HR, price: 100, oi: 1, funding: 0 })) }], { horizons: [4], minSamples: 20 });
  for (const a of sc.axes) {
    if (AXIS_EXITS[a.name]) {
      assert.ok(a.exit, `${a.name} should carry an exit grade`);
      assert.equal(a.exit.preset, AXIS_EXITS[a.name].preset);
      assert.equal(a.exit.maxHoldHours, AXIS_EXITS[a.name].maxHoldHours);
    } else assert.equal(a.exit, null, a.name);
  }
  assert.ok(sc.axes.some((a) => a.name === "basis_x_cvd" && a.exit));
});
