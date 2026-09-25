// The ×1095 constant and its one application. Pins the arithmetic the Lab's funding
// copy claims, and the "never clamp" rule that copy exists to justify.
// Run: node --test app/lib/funding.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { FUNDING_PERIODS_PER_YEAR, annualFundingPct } from "./funding.mjs";

test("the multiplier is three periods a day", () => {
  assert.equal(FUNDING_PERIODS_PER_YEAR, 1095);
  assert.equal(FUNDING_PERIODS_PER_YEAR, 3 * 365);
});

test("annualFundingPct takes a raw decimal rate and returns percent/yr", () => {
  // The venue reports 0.0001 for "0.01% per 8h".
  assert.ok(Math.abs(annualFundingPct(0.0001) - 10.95) < 1e-9);
  // The real USDJPY print the board's copy is written around.
  assert.ok(Math.abs(annualFundingPct(-0.00188) - -205.86) < 1e-9);
  assert.equal(annualFundingPct(0), 0);
});

test("an extreme rate is never squashed into a comfortable range", () => {
  // The guard against 'fix the display by fixing the number'.
  assert.ok(annualFundingPct(-0.005) < -500, "-0.5%/8h really is worse than -500%/yr");
  assert.ok(annualFundingPct(0.02) > 2000, "and the upside is just as unbounded");
});

test("absent data yields null, never a silent 0%", () => {
  // Number(null) is 0 — annualizing it would report a paying crowd as a free one.
  assert.equal(annualFundingPct(null), null);
  assert.equal(annualFundingPct(undefined), null);
  assert.equal(annualFundingPct(""), null);
  assert.equal(annualFundingPct(NaN), null);
  assert.equal(annualFundingPct("not a rate"), null);
});

test("it reproduces the hand-written sites it replaces", () => {
  // The call sites spelled the same arithmetic two ways: `* 1095 * 100` (most of them) and
  // `* 3 * 365 * 100` (MarketStatStrip). Those are NOT bit-identical — float multiplication
  // doesn't associate, so 0.0001 gives 10.95 one way and 10.950000000000001 the other. Both
  // round to the same displayed number, but it is a neat illustration of why one literal
  // written out in eight places is a liability. This module is the `* 1095` form.
  for (const r of [0.0001, -0.00188, 0.01, -0.0005, 0]) {
    assert.equal(annualFundingPct(r), r * 1095 * 100, `exact vs the x1095 form, rate ${r}`);
    assert.ok(Math.abs(annualFundingPct(r) - r * 3 * 365 * 100) < 1e-9, `within a ULP of the x3x365 form, rate ${r}`);
  }
});
