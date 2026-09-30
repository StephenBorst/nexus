import test from "node:test";
import assert from "node:assert/strict";
import {
  PREREG, VERDICTS, mulberry32, summarize, stdev, permutationTest, groupGap, halves, leaveOneMarketOut,
  minDetectableGap, decideStage1, decideStage2, populationHash, isGradedHouseCall, pickCall, renderMarkdown, diagnostics,
} from "./study.mjs";
import { mulberry32 as engineMulberry32 } from "../../workers/nexus-lab-api/backtest.mjs";

const WIN = 1.33, LOSS = -1;
const DAY = 86400000;

// n rows in `market`, the first `wins` of every 10 are wins (spread evenly through time).
function rows({ n, winsPer10, counterCycle, market = "AAA", start = 0, direction = "SHORT" }) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${market}-${counterCycle ? "c" : "w"}-${start + i}`,
    market,
    direction,
    createdAt: (start + i) * DAY,
    r: i % 10 < winsPer10 ? WIN : LOSS,
    counterCycle,
    againstWeekly: counterCycle,
    intoZone: false,
  }));
}
// One group spread round-robin over 4 markets and the whole window, so halves + leave-one-out can
// pass. The win pattern runs over the GROUP's index, so winsPer10 holds exactly whenever n % 10 = 0.
function spread(winsPer10, counterCycle, n = 40) {
  const M = ["AAA", "BBB", "CCC", "DDD"];
  return Array.from({ length: n }, (_, i) => ({
    id: `${counterCycle ? "c" : "w"}-${i}`,
    market: M[i % 4],
    direction: "SHORT",
    createdAt: i * DAY + (counterCycle ? 1 : 0),
    r: i % 10 < winsPer10 ? WIN : LOSS,
    counterCycle,
    againstWeekly: counterCycle,
    intoZone: false,
  }));
}

test("mulberry32 is the engine's generator, value for value", () => {
  for (const seed of [7, 12345]) {
    const a = mulberry32(seed), b = engineMulberry32(seed);
    for (let i = 0; i < 1000; i++) assert.equal(a(), b());
  }
});

test("summarize + stdev", () => {
  const s = summarize([{ r: WIN }, { r: LOSS }, { r: LOSS }, { r: WIN }]);
  assert.equal(s.n, 4);
  assert.equal(s.wins, 2);
  assert.equal(s.hitRate, 0.5);
  assert.ok(Math.abs(s.meanR - 0.165) < 1e-12);
  assert.equal(summarize([]).meanR, null);
  assert.equal(stdev([1]), null);
  assert.ok(Math.abs(stdev([1, 3]) - Math.SQRT2) < 1e-12);
});

// Exact two-sided p for binary R: the wins landing in group a are hypergeometric under H0.
function logC(n, k) { let s = 0; for (let i = 1; i <= k; i++) s += Math.log((n - k + i) / i); return s; }
function exactP(na, nb, winsA, winsB) {
  const N = na + nb, K = winsA + winsB;
  const gapAt = (k) => (k * WIN + (na - k) * LOSS) / na - ((K - k) * WIN + (nb - (K - k)) * LOSS) / nb;
  const obs = Math.abs(gapAt(winsA));
  let p = 0;
  for (let k = Math.max(0, K - nb); k <= Math.min(K, na); k++) {
    if (Math.abs(gapAt(k)) >= obs - 1e-12) p += Math.exp(logC(K, k) + logC(N - K, na - k) - logC(N, na));
  }
  return p;
}

test("permutation p matches the exact hypergeometric answer (two-sided)", () => {
  for (const [na, nb, wa, wb] of [[30, 40, 16, 12], [50, 50, 25, 18], [35, 90, 10, 40]]) {
    const a = [...Array(wa).fill(WIN), ...Array(na - wa).fill(LOSS)];
    const b = [...Array(wb).fill(WIN), ...Array(nb - wb).fill(LOSS)];
    const { p } = permutationTest(a, b, { iters: 10000, seed: 7 });
    const exact = exactP(na, nb, wa, wb);
    assert.ok(Math.abs(p - exact) < 0.015, `${na}/${nb}: permutation ${p.toFixed(4)} vs exact ${exact.toFixed(4)}`);
  }
});

test("permutation: no difference → p = 1; total separation → p at its floor; seeded + symmetric", () => {
  assert.equal(permutationTest([WIN, LOSS, WIN, LOSS], [LOSS, WIN, LOSS, WIN], { iters: 500, seed: 7 }).p, 1);
  const sep = permutationTest(Array(40).fill(WIN), Array(40).fill(LOSS), { iters: 2000, seed: 7 });
  assert.equal(sep.p, 1 / 2001);
  const a = [...Array(18).fill(WIN), ...Array(22).fill(LOSS)], b = [...Array(10).fill(WIN), ...Array(30).fill(LOSS)];
  const x = permutationTest(a, b, { iters: 4000, seed: 7 });
  assert.deepEqual(permutationTest(a, b, { iters: 4000, seed: 7 }), x);
  const y = permutationTest(b, a, { iters: 4000, seed: 7 });
  assert.ok(Math.abs(x.gap + y.gap) < 1e-12);
  assert.ok(Math.abs(x.p - y.p) < 0.03);
});

test("groupGap, halves and leave-one-market-out", () => {
  const set = [...rows({ n: 10, winsPer10: 6, counterCycle: false, market: "A" }), ...rows({ n: 10, winsPer10: 2, counterCycle: true, market: "B", start: 10 })];
  assert.ok(Math.abs(groupGap(set) - 0.4 * (WIN - LOSS)) < 1e-12);
  assert.equal(groupGap(set.filter((x) => !x.counterCycle)), null);
  const hv = halves(set);
  assert.equal(hv.first.n + hv.second.n, 20);
  assert.equal(hv.first.gap, null); // first half = market A only (all with-structure)
  const lomo = leaveOneMarketOut(set);
  assert.deepEqual(lomo.map((x) => [x.market, x.left, x.gap]), [["A", 10, null], ["B", 10, null]]);
});

test("minDetectableGap: the power line printed in the report", () => {
  assert.ok(Math.abs(minDetectableGap(82, 82, 1.14) - 2.801585 * 1.14 * Math.sqrt(2 / 82)) < 1e-9);
  assert.ok(minDetectableGap(30, 133, 1.14) > minDetectableGap(82, 81, 1.14));
  assert.equal(minDetectableGap(0, 10, 1), null);
});

test("stage 1: too few calls in a group → INSUFFICIENT (never tested)", () => {
  const d = decideStage1([...spread(6, false, 40), ...spread(1, true, 20)]);
  assert.equal(d.verdict, VERDICTS.INSUFFICIENT);
  assert.equal(d.p, null);
});

test("stage 1: counter-cycle fades reliably worse, everywhere and all along → SILENCE_COUNTER_CYCLE", () => {
  const d = decideStage1([...spread(6, false), ...spread(1, true)]);
  assert.equal(d.verdict, VERDICTS.SILENCE_COUNTER_CYCLE, d.reasons.join("; "));
  assert.ok(d.gap >= 0.4 && d.p <= 0.05);
  assert.ok(d.checks.every((c) => c.pass));
});

test("stage 1: the other way (fades WITH structure worse) → SILENCE_WITH_STRUCTURE", () => {
  const d = decideStage1([...spread(1, false), ...spread(6, true)]);
  assert.equal(d.verdict, VERDICTS.SILENCE_WITH_STRUCTURE, d.reasons.join("; "));
  assert.ok(d.gap <= -0.4);
});

test("stage 1: a small gap → NOT_SHOWN", () => {
  const d = decideStage1([...spread(4, false), ...spread(4, true)]);
  assert.equal(d.verdict, VERDICTS.NOT_SHOWN);
  assert.ok(d.reasons.some((r) => r.startsWith("gap")));
});

test("stage 1: a big gap whose surviving group still loses → NOT_SHOWN (survivor)", () => {
  // with: 4/10 wins = −0.068R · counter: 0/10 = −1R · gap 0.93R, p tiny, but silencing leaves a loser
  const d = decideStage1([...spread(4, false), ...spread(0, true)]);
  assert.equal(d.verdict, VERDICTS.NOT_SHOWN);
  assert.deepEqual(d.reasons.map((r) => r.split(":")[0]), ["survivor"]);
});

test("stage 1: an effect that only lived in the first half → NOT_SHOWN (halves)", () => {
  const early = (x) => ({ ...x, createdAt: x.createdAt % (20 * DAY) });
  const late = (x) => ({ ...x, createdAt: 100 * DAY + (x.createdAt % (20 * DAY)) });
  const set = [
    ...spread(8, false).map(early), ...spread(0, true).map(early),
    ...spread(3, false).map(late), ...spread(5, true).map(late),
  ];
  const d = decideStage1(set);
  assert.equal(d.verdict, VERDICTS.NOT_SHOWN);
  assert.deepEqual(d.reasons.map((r) => r.split(":")[0]), ["halves"], d.reasons.join("; "));
});

test("stage 1: an effect one market carries → NOT_SHOWN (leave one market out)", () => {
  const set = [
    ...rows({ n: 30, winsPer10: 5, counterCycle: false, market: "AAA" }),
    ...rows({ n: 30, winsPer10: 5, counterCycle: false, market: "BBB", start: 1 }),
    ...rows({ n: 30, winsPer10: 6, counterCycle: true, market: "BBB", start: 2 }),
    ...rows({ n: 40, winsPer10: 0, counterCycle: true, market: "XXX", start: 3 }),
  ];
  const d = decideStage1(set);
  assert.equal(d.verdict, VERDICTS.NOT_SHOWN);
  assert.deepEqual(d.reasons.map((r) => r.split(":")[0]), ["leaveOneMarketOut"], d.reasons.join("; "));
  assert.match(d.reasons[0], /XXX out → −0\.\d\dR/);
});

test("stage 2 confirms only a stage-1 pass, in the same direction", () => {
  const good = [...spread(6, false, 20), ...spread(2, true, 20)];
  assert.equal(decideStage2(good, VERDICTS.NOT_SHOWN).verdict, "NOT_APPLICABLE");
  assert.equal(decideStage2(good, VERDICTS.SILENCE_COUNTER_CYCLE).verdict, "CONFIRMED");
  assert.equal(decideStage2(good, VERDICTS.SILENCE_WITH_STRUCTURE).verdict, "NOT_CONFIRMED");
  assert.equal(decideStage2(good.slice(0, 25), VERDICTS.SILENCE_COUNTER_CYCLE).verdict, VERDICTS.INSUFFICIENT);
  const losing = [...spread(4, false, 20), ...spread(0, true, 20)]; // gap fine, survivor < 0
  assert.equal(decideStage2(losing, VERDICTS.SILENCE_COUNTER_CYCLE).verdict, "NOT_CONFIRMED");
});

test("populationHash: order-free, sensitive to any graded field", () => {
  const calls = [
    { id: "nexus-A-1", symbol: "A", direction: "LONG", entryPrice: 1, createdAt: 1, gradedOutcome: "WIN", gradedR: 1.33 },
    { id: "nexus-B-2", symbol: "B", direction: "SHORT", entryPrice: 2, createdAt: 2, gradedOutcome: "LOSS", gradedR: -1 },
  ];
  const h = populationHash(calls);
  assert.equal(populationHash([...calls].reverse()), h);
  assert.notEqual(populationHash([calls[0], { ...calls[1], gradedOutcome: "WIN", gradedR: 1.33 }]), h);
  assert.match(h, /^[0-9a-f]{64}$/);
});

test("isGradedHouseCall: the registered population rule", () => {
  const ok = { id: "nexus-ETH-1", source: "nexus-signal", gradeV: 3, gradedOutcome: "LOSS", gradedR: -1, createdAt: 5 };
  assert.equal(isGradedHouseCall(ok), true);
  for (const bad of [
    { ...ok, gradedOutcome: undefined }, { ...ok, gradedOutcome: "INVALID" }, { ...ok, gradeV: 2 },
    { ...ok, id: "c7e0aab9-manual" }, { ...ok, source: undefined }, { ...ok, duplicateOf: "0xabc" },
  ]) assert.equal(isGradedHouseCall(bad), false);
  assert.deepEqual(Object.keys(pickCall({ ...ok, notes: "x", regimeAlign: "CHOP" })).sort(),
    ["createdAt", "direction", "entryPrice", "gradeV", "gradedOutcome", "gradedR", "id", "stopLoss", "symbol", "takeProfit1"]);
});

test("the report reads plainly and names its population", () => {
  const set = [...spread(4, false), ...spread(4, true)];
  const s1 = { ...decideStage1(set), diagnostics: diagnostics(set) };
  const md = renderMarkdown({
    stage: 1, runAt: "2026-10-01T00:00:00.000Z", commit: "abc", stage1: s1, stage2: null,
    populations: { "stage 1": { n: 80, sha256: "f".repeat(64), classified: 80, unclassified: 0, byReason: {} } },
    markets: [{ symbol: "AAA", gaps: 0, error: null }],
  });
  assert.match(md, /NOT SHOWN\. Structure does not gate the house caller\./);
  assert.match(md, /with structure \| 40/);
  assert.match(md, /Report only\. Nothing live reads this/);
  assert.equal(PREREG.stage1.n, 163);
});
