// The scoreboard's random-entry baseline — per signal, per side, window-matched.
// Every verdict on the board is graded against ZERO; in a window that rose, any long
// "predicts". These pin the control that separates "the signal picked good moments" from
// "the window did the work". Run: node --test workers/nexus-lab-api/axisbt.random.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { scoreEvents, runScorecard, buildRandomPools, randomEntryBaselineR, windowTide, hourBucket } from "./axisbt.mjs";
import { baselineVerdict, randomEntryBaseline } from "./backtest.mjs";

const HR = 3600000, BASE = Date.UTC(2026, 7, 1);

// A market from a close path: oi:hist price spine + hourly candles with ±0.4% wicks.
function market(coin, closes) {
  return {
    coin,
    oiHist: closes.map((price, i) => ({ t: BASE + i * HR, price, oi: 1000, funding: 0 })),
    candleHist: closes.map((c, i) => ({ t: BASE + i * HR, o: c, h: c * 1.004, l: c * 0.996, c, v: 1 })),
  };
}
const at = (i) => BASE + i * HR;
const range = (from, to, step) => { const out = []; for (let i = from; i <= to; i += step) out.push(i); return out; };

// ── 1. DRIFT ALONE — a steady uptrend, entries with no timing information ──────
// Every long here hits its 1.5R target and every short its stop, wherever it enters. So the
// real grade and every random replay are identical: the read cannot be told apart from
// random, and the baseline must say so, even though its raw grade (+1.5R) looks superb.
const uptrend = market("BTC", Array.from({ length: 600 }, (_, i) => 100 * 1.002 ** i));
const driftGen = () => [
  ...range(100, 500, 7).map((i) => ({ t: at(i), side: "LONG" })),
  ...range(105, 500, 11).map((i) => ({ t: at(i), side: "SHORT" })),
];

test("drift alone: a superb raw grade that random entries match is NOT_DISTINGUISHABLE", () => {
  const pools = buildRandomPools([uptrend]);
  const s = scoreEvents([uptrend], driftGen, { horizons: [4], minSamples: 5, randomPools: pools });
  const L = s.random.bySide.LONG, S = s.random.bySide.SHORT;
  assert.equal(L.realMeanR, 1.5, "every long hit its target — the raw grade looks excellent");
  assert.equal(L.randomMedianR, 1.5, "…and so did every random long: that is the window, not the signal");
  assert.equal(L.verdict, "NOT_DISTINGUISHABLE");
  assert.equal(L.pctBeaten, 50, "all replays tie the real mean → exactly the middle");
  assert.equal(S.realMeanR, -1);
  assert.equal(S.randomMedianR, -1, "random shorts lose just as badly — shorting didn't pay in this window");
  assert.equal(S.verdict, "NOT_DISTINGUISHABLE", "a losing side is not 'worse than random' — it IS random here");
});

test("the tide: in a window that rose, a random long earns and a random short loses", () => {
  const d = windowTide(buildRandomPools([uptrend]));
  assert.ok(d.LONG.meanR > 0, `random long earned ${d.LONG.meanR}R`);
  assert.ok(d.SHORT.meanR < 0, `random short earned ${d.SHORT.meanR}R`);
  assert.equal(d.markets, 1);
});

// ── 2. REAL TIMING — an oscillating market, a signal that buys the troughs ─────
// No trend at all. Troughs reach the 1.5R target; a random entry often buys a peak and stops
// out. The signal carries information about WHEN, and the baseline must credit it.
const wave = market("ETH", Array.from({ length: 1200 }, (_, i) => 100 + 8 * Math.sin((2 * Math.PI * i) / 48)));
const troughGen = () => range(132, 1140, 48).map((i) => ({ t: at(i), side: "LONG" })); // sin minimum at i ≡ 36 (mod 48)

// The mirror image: buying the PEAKS of the same wave. Every entry stops out; random entries on
// the same wave do far better. That is not "indistinguishable from random" — it is reliably
// worse, and before the BELOW_RANDOM rung the ladder said the former.
const peakGen = () => range(108, 1116, 48).map((i) => ({ t: at(i), side: "LONG" })); // sin maximum at i ≡ 12 (mod 48)

test("reliably bad timing: buying the peaks of a trendless wave is BELOW_RANDOM, not 'indistinguishable'", () => {
  const s = scoreEvents([wave], peakGen, { horizons: [4], minSamples: 5, randomPools: buildRandomPools([wave]) });
  const L = s.random.bySide.LONG;
  assert.equal(L.realMeanR, -1, "every peak long stopped out");
  assert.ok(L.pctBeaten <= 5, `beat ${L.pctBeaten}% of replays`);
  assert.equal(L.verdict, "BELOW_RANDOM");
  assert.ok(L.excessR < -0.5, `timing cost ${L.excessR}R vs random entries`);
});

test("real timing: buying the troughs of a trendless wave BEATS_RANDOM", () => {
  const s = scoreEvents([wave], troughGen, { horizons: [4], minSamples: 5, randomPools: buildRandomPools([wave]) });
  const L = s.random.bySide.LONG;
  assert.equal(L.verdict, "BEATS_RANDOM", `pctBeaten ${L.pctBeaten}`);
  assert.ok(L.excessR > 0.5, `timing added ${L.excessR}R over random entries`);
  assert.equal(s.random.pooled.verdict, "BEATS_RANDOM");
});

// ── 3. WINDOW-MATCHED — random entries come only from when the read could fire ─
// Falls for 400h, then rises. The read only fires in the rising half. Drawn from the whole
// history, random longs would include the falling half, and the read would falsely BEAT
// random. Drawn from its own window, it's exactly as good as any long in that window.
const vee = market("SOL", Array.from({ length: 800 }, (_, i) => (i < 400 ? 100 * 0.998 ** i : 100 * 0.998 ** 400 * 1.002 ** (i - 400))));
const lateGen = () => range(460, 740, 7).map((i) => ({ t: at(i), side: "LONG" }));

test("window-matched: a read that only fired in the rally is compared with the rally, not the crash", () => {
  const s = scoreEvents([vee], lateGen, { horizons: [4], minSamples: 5, randomPools: buildRandomPools([vee]) });
  const L = s.random.bySide.LONG;
  assert.equal(L.verdict, "NOT_DISTINGUISHABLE", "drawing from the crash too would have said BEATS_RANDOM");
  assert.ok(L.randomMedianR >= 1, `random longs in its window earned ${L.randomMedianR}R`);
  assert.equal(s.random.window.from, new Date(hourBucket(at(460)) * HR).toISOString(), "the window starts at the first event");
});

// ── 4. The contract details ────────────────────────────────────────────────────
test("too few events on a side is TOO_FEW, never a verdict", () => {
  const gen = () => [at(100), at(150), at(200)].map((t) => ({ t, side: "LONG" }));
  const s = scoreEvents([uptrend], gen, { horizons: [4], minSamples: 1, randomPools: buildRandomPools([uptrend]) });
  assert.equal(s.random.bySide.LONG.verdict, "TOO_FEW");
  assert.equal(s.random.bySide.LONG.n, 3);
  assert.equal(s.random.bySide.SHORT.verdict, "TOO_FEW");
  assert.equal(s.random.bySide.SHORT.n, 0, "a one-sided read reports its empty side as empty");
});

test("seeded: identical inputs give an identical baseline", () => {
  const a = scoreEvents([wave], troughGen, { horizons: [4], minSamples: 5, randomPools: buildRandomPools([wave]) }).random;
  const b = scoreEvents([wave], troughGen, { horizons: [4], minSamples: 5, randomPools: buildRandomPools([wave]) }).random;
  assert.deepEqual(a, b);
});

test("the side is preserved: a short is only ever replayed as a short", () => {
  const shortGen = () => range(100, 500, 9).map((i) => ({ t: at(i), side: "SHORT" }));
  const s = scoreEvents([uptrend], shortGen, { horizons: [4], minSamples: 5, randomPools: buildRandomPools([uptrend]) });
  assert.equal(s.random.bySide.SHORT.randomMedianR, -1, "replayed as shorts (a long would have been +1.5)");
  assert.equal(s.random.pooled.randomMedianR, -1);
});

test("measurement only: the baseline never changes a verdict, grade or split", () => {
  const without = scoreEvents([wave], troughGen, { horizons: [4, 12], minSamples: 5 });
  const withIt = scoreEvents([wave], troughGen, { horizons: [4, 12], minSamples: 5, randomPools: buildRandomPools([wave]) });
  assert.equal(without.random, null);
  assert.ok(withIt.random);
  for (const k of ["verdict", "r", "sides", "horizons", "headline", "samples"]) assert.deepEqual(withIt[k], without[k], k);
});

test("ONE verdict ladder: the scoreboard and the Lab backtest can't disagree on what BEATS_RANDOM means", () => {
  assert.equal(baselineVerdict(95), "BEATS_RANDOM");
  assert.equal(baselineVerdict(94.9), "LEANS_ABOVE");
  assert.equal(baselineVerdict(80), "LEANS_ABOVE");
  assert.equal(baselineVerdict(79.9), "NOT_DISTINGUISHABLE");
  assert.equal(baselineVerdict(50), "NOT_DISTINGUISHABLE", "the middle of the pack is the honest 'can't tell'");
  assert.equal(baselineVerdict(5.1), "NOT_DISTINGUISHABLE");
  assert.equal(baselineVerdict(5), "BELOW_RANDOM", "symmetric with the ≥95 top rung");
  assert.equal(baselineVerdict(0), "BELOW_RANDOM");
  for (const gen of [driftGen, troughGen, peakGen]) {
    const cs = gen === driftGen ? uptrend : wave;
    const r = scoreEvents([cs], gen, { horizons: [4], minSamples: 5, randomPools: buildRandomPools([cs]) }).random;
    for (const x of [r.pooled, r.bySide.LONG, r.bySide.SHORT]) if (x.verdict !== "TOO_FEW") assert.equal(x.verdict, baselineVerdict(x.pctBeaten));
  }
  assert.equal(typeof randomEntryBaseline, "function", "the Lab baseline still exists beside it");
});

test("runScorecard exposes the tide and a baseline on every read", () => {
  const sc = runScorecard([uptrend, wave], { horizons: [4], minSamples: 5 });
  assert.ok(sc.tide && sc.tide.markets === 2);
  for (const a of sc.axes) assert.ok("random" in a, `${a.name} carries a random field`);
});

test("no pools / no events → null, never a fabricated baseline", () => {
  assert.equal(randomEntryBaselineR([], new Map()), null);
  assert.equal(randomEntryBaselineR([{ t: at(1), side: "LONG", mkt: "BTC", _r: 1.5 }], null), null);
  assert.equal(windowTide(new Map()), null);
});
