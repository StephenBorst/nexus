import test from "node:test";
import assert from "node:assert/strict";
import { fadeFamilyGrade, fadeFamilyLine, FADE_FAMILY_AXIS } from "./fadeGrade.mjs";

// Shape of the funding_fade row as /intel/axis-backtest served it on 2026-10-04.
const live = {
  axes: [
    { name: "basis_x_cvd", verdict: "PREDICTIVE", r: { samples: 53 }, random: { pooled: { verdict: "LEANS_ABOVE" } } },
    { name: "funding_fade", verdict: "NOISE", r: { samples: 3444 }, random: { pooled: { verdict: "BELOW_RANDOM" } } },
  ],
};

test("reads the plain funding fade's live grade, not another axis", () => {
  assert.equal(FADE_FAMILY_AXIS, "funding_fade");
  assert.deepEqual(fadeFamilyGrade(live), { tier: "NOISE", vsRandom: "worse than random entries", samples: 3444 });
  assert.equal(fadeFamilyLine(fadeFamilyGrade(live)), "The plain funding fade grades NOISE, worse than random entries (3,444 samples).");
});

test("the words follow the grade when it moves", () => {
  const sc = (verdict, rv, n) => ({ axes: [{ name: "funding_fade", verdict, r: { samples: n }, random: { pooled: { verdict: rv } } }] });
  assert.equal(fadeFamilyLine(fadeFamilyGrade(sc("PREDICTIVE", "BEATS_RANDOM", 900))), "The plain funding fade grades PREDICTIVE, beats random entries (900 samples).");
  assert.equal(fadeFamilyLine(fadeFamilyGrade(sc("PROMISING", "LEANS_ABOVE", 120))), "The plain funding fade grades PROMISING, leans above random entries (120 samples).");
  assert.equal(fadeFamilyLine(fadeFamilyGrade(sc("NOISE", "NOT_DISTINGUISHABLE", 50))), "The plain funding fade grades NOISE, no better than random entries (50 samples).");
  // The scoreboard's INSUFFICIENT tier reads ACCRUING everywhere it's shown.
  assert.equal(fadeFamilyGrade(sc("INSUFFICIENT", "TOO_FEW", 4)).tier, "ACCRUING");
});

test("missing pieces are left out, never invented", () => {
  const noRandom = { axes: [{ name: "funding_fade", verdict: "NOISE", r: { samples: 3444 } }] };
  assert.equal(fadeFamilyLine(fadeFamilyGrade(noRandom)), "The plain funding fade grades NOISE (3,444 samples).");
  const noSamples = { axes: [{ name: "funding_fade", verdict: "NOISE", random: { pooled: { verdict: "BELOW_RANDOM" } } }] };
  assert.equal(fadeFamilyLine(fadeFamilyGrade(noSamples)), "The plain funding fade grades NOISE, worse than random entries.");
});

test("no scorecard, no axis or an unknown verdict → null, and the line says nothing", () => {
  for (const sc of [null, undefined, {}, { axes: null }, { axes: [] }, { axes: [{ name: "basis_x_cvd", verdict: "NOISE" }] },
    { axes: [{ name: "funding_fade", verdict: "SOMETHING_NEW" }] }, { failed: true, axes: [] }]) {
    assert.equal(fadeFamilyGrade(sc), null);
  }
  assert.equal(fadeFamilyLine(null), null);
  assert.equal(fadeFamilyLine(undefined), null);
});
