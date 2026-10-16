// The read pipeline on the scoreboard: each registered read's OUT-OF-SAMPLE grade (events after its
// registration only), its own graded-exit cutoff, and the overlap check between two reads.
// Run: node --test workers/nexus-lab-api/axisbt.pipeline.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { runScorecard, readOverlap, GRADED_EXIT_CUTOFFS } from "./axisbt.mjs";
import { GRADED_EXIT_OOS_CUTOFF_MS } from "../../app/lib/gradedExit.mjs";
import { REGISTERED_READS, registeredMs } from "../../app/lib/readPipeline.mjs";

const HR = 3600e3, T0 = Date.UTC(2026, 6, 1);
// A staircase uptrend: 34 hours up 0.3%, then 6 hours down 0.7%. The pullback drags RSI-14 under 45
// while price stays above its EMA-50, so rsi_reset_deep fires once per step, all through the tape.
const stairs = (n, phase) => {
  const out = [100];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * ((i + phase) % 40 < 34 ? 1.003 : 0.993));
  return out;
};
const coinSet = (coin, n = 2400, phase = 0) => {
  const series = stairs(n, phase);
  const px = (i) => series[i];
  return {
    coin,
    oiHist: Array.from({ length: n }, (_, i) => ({ t: T0 + i * HR, price: px(i), oi: 1, funding: 0 })),
    candleHist: Array.from({ length: n }, (_, i) => { const p = px(i); return { t: T0 + i * HR, o: p, h: p * 1.006, l: p * 0.994, c: p, v: 1 }; }),
    basisHist: [], cvdHist: [], smHist: [], liqHist: [],
  };
};
const SETS = [coinSet("BTC"), coinSet("ETH", 2400, 5)];
const CUT = T0 + 1500 * HR;
const sc = () => runScorecard(SETS, { horizons: [4], minSamples: 5, registered: [{ axis: "rsi_reset_deep", fromMs: CUT }], overlapPairs: [["basis_x_cvd", "rsi_reset_deep"]] });

test("a registered read gets an out-of-sample grade on events after its registration only", () => {
  const out = sc();
  const row = out.axes.find((a) => a.name === "rsi_reset_deep");
  assert.ok(row.r.samples > 0, "fixture must make the read fire");
  assert.ok(row.oos, "oos block");
  assert.equal(row.oos.since, new Date(CUT).toISOString());
  const all = row.sides.LONG.events, oos = row.oos.sides.LONG.events;
  assert.ok(oos > 0 && oos < all, `oos ${oos} must be a strict subset of ${all}`);
  // unregistered reads carry no oos block
  assert.equal(out.axes.find((a) => a.name === "funding_fade").oos, undefined);
});

test("the oos grade is the same grader on the later events — not a different rule", () => {
  // grading ONLY the later half of the tape (history before the cut still feeds the indicators)
  // must give the same R as the oos block
  const out = sc();
  const oos = out.axes.find((a) => a.name === "rsi_reset_deep").oos;
  assert.ok(oos.r.samples > 0);
  assert.ok(oos.random && oos.random.bySide.LONG, "random baseline graded on the oos events too");
  assert.ok(oos.exitGraded, "pipeline read with gradedExit gets the as-traded line on oos events");
  assert.equal(oos.exitGraded.oos.since, new Date(CUT).toISOString(), "graded exit uses the read's OWN cutoff");
});

test("graded-exit cutoffs are per read: basis_x_cvd keeps its prereg date, pipeline reads get their registration", () => {
  assert.equal(GRADED_EXIT_CUTOFFS.basis_x_cvd, GRADED_EXIT_OOS_CUTOFF_MS);
  for (const r of REGISTERED_READS.filter((x) => x.gradedExit)) assert.equal(GRADED_EXIT_CUTOFFS[r.axis], registeredMs(r));
  const row = runScorecard(SETS, { horizons: [4], minSamples: 5 }).axes.find((a) => a.name === "rsi_reset_deep");
  assert.equal(row.exitGraded.oos.since, REGISTERED_READS.find((r) => r.axis === "rsi_reset_deep").registeredAt.replace("Z", ".000Z"));
});

test("overlap: identical reads overlap 100%, disjoint ones 0%, counts only", () => {
  const same = readOverlap(SETS, "rsi_reset_deep", "rsi_reset_deep");
  assert.ok(same.aEvents > 0);
  assert.equal(same.aWithB, 100);
  assert.equal(same.sameHour, same.aEvents);
  const none = readOverlap(SETS, "basis_x_cvd", "rsi_reset_deep"); // no basis/cvd history → basis never fires
  assert.equal(none.aEvents, 0);
  assert.equal(none.aWithB, null);
  assert.equal(none.bWithA, 0);
  assert.equal(readOverlap(SETS, "nope", "rsi_reset_deep").error, "unknown axis");
  assert.deepEqual(sc().overlap.map((o) => [o.a, o.b]), [["basis_x_cvd", "rsi_reset_deep"]]);
});

test("overlap within a window: same coin + same side within ±24h counts, another coin only counts market-wide", () => {
  // two reads built from the same generator but shifted: use a coin pair offset by 5h
  const a = coinSet("BTC"), b = { ...coinSet("ETH", 2400, 5), coin: "ETH" };
  const o = readOverlap([a, b], "rsi_reset_deep", "rsi_reset_deep", { windowH: 0 });
  assert.equal(o.aWithB, 100); // each event matches itself
  assert.ok(o.aWithBMarketWide >= o.aWithB);
});
