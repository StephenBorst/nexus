// Run: node --test app/lib/basisFade.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { trailingPct, basisExtremeSide, basisFadeFromHistory, BASIS_FADE_DEFAULTS } from "./basisFade.mjs";

const HR = 3600000;
const T0 = Date.parse("2026-09-01T00:00:00Z");
// 60 calm hours (|basis| ~0.10) — enough to clear the 48h warmup.
const calm = (n = 60, v = 0.1) => Array.from({ length: n }, (_, i) => ({ t: T0 + i * HR, basisPct: v }));

test("trailingPct: nearest-rank quantile", () => {
  assert.equal(trailingPct([1, 2, 3, 4, 5], 0.9), 5);
  assert.equal(trailingPct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
  assert.equal(trailingPct([], 0.9), null);
  assert.equal(trailingPct([NaN, 2], 0.5), 2, "non-finite filtered");
});

test("basisExtremeSide: premium fades SHORT, discount fades LONG", () => {
  const trail = new Array(60).fill(0.1);
  assert.equal(basisExtremeSide(trail, 0.5), "SHORT", "perp at a premium = froth → fade short");
  assert.equal(basisExtremeSide(trail, -0.5), "LONG", "perp at a discount → fade long");
});

test("basisExtremeSide: must be STRICTLY above the trailing threshold", () => {
  const trail = new Array(60).fill(0.2);
  assert.equal(basisExtremeSide(trail, 0.2), null, "equal to p90 is not extreme");
  assert.equal(basisExtremeSide(trail, 0.19), null);
  assert.ok(basisExtremeSide(trail, 0.21));
});

test("basisExtremeSide: refuses on a thin sample or a flat regime", () => {
  assert.equal(basisExtremeSide(new Array(47).fill(0.1), 5), null, "under the 48h warmup");
  assert.equal(basisExtremeSide(new Array(60).fill(0), 0.5), null, "flat regime has no extreme (thr=0)");
  assert.equal(basisExtremeSide(new Array(60).fill(0.1), NaN), null);
  assert.equal(basisExtremeSide(null, 1), null);
});

test("basisFadeFromHistory: newest row is the observation, earlier rows the trail", () => {
  const rows = [...calm(60, 0.1), { t: T0 + 60 * HR, basisPct: 0.9 }];
  const r = basisFadeFromHistory(rows, { now: T0 + 60 * HR });
  assert.equal(r.side, "SHORT");
  assert.equal(r.basisPct, 0.9);
  assert.equal(r.thr, 0.1);
  assert.match(r.reason, /premium/);
});

test("basisFadeFromHistory: an extreme in the PAST does not fire now", () => {
  const rows = [...calm(60, 0.1), { t: T0 + 60 * HR, basisPct: 0.9 }, { t: T0 + 61 * HR, basisPct: 0.1 }];
  const r = basisFadeFromHistory(rows, { now: T0 + 61 * HR });
  assert.equal(r.side, null, "only the latest observation can trigger");
});

test("basisFadeFromHistory: refuses stale data rather than trading an old premium", () => {
  const rows = [...calm(60, 0.1), { t: T0 + 60 * HR, basisPct: 0.9 }];
  const r = basisFadeFromHistory(rows, { now: T0 + 60 * HR + 8 * HR });
  assert.equal(r.side, null);
  assert.match(r.reason, /stale/);
});

test("basisFadeFromHistory: says it is still accruing instead of guessing", () => {
  const rows = [...calm(10, 0.1), { t: T0 + 10 * HR, basisPct: 5 }];
  const r = basisFadeFromHistory(rows, { now: T0 + 10 * HR });
  assert.equal(r.side, null);
  assert.match(r.reason, /accruing \(10\/48h\)/);
});

test("basisFadeFromHistory: empty / garbage in, honest null out", () => {
  assert.equal(basisFadeFromHistory([]).side, null);
  assert.equal(basisFadeFromHistory(null).reason, "no basis history");
  assert.equal(basisFadeFromHistory([{ t: T0, basisPct: "x" }]).side, null);
});

test("defaults match the scoreboard's graded parameters", () => {
  assert.deepEqual({ ...BASIS_FADE_DEFAULTS }, { window: 168, minWarmup: 48, pct: 0.9 });
});
