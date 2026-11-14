// Lab home's lens card (app/lib/intelLenses.mjs): one card, a chip per lens, only the chosen one mounted.
// Run: node --test app/lib/intelLenses.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INTEL_LENSES, LENS_KEY, LENS_NONE, initialLens, lensFromQuery, nextLens } from "./intelLenses.mjs";

const store = (obj) => (k) => (k in obj ? obj[k] : null);

test("six lenses, unique ids, the funnel order", () => {
  assert.deepEqual(INTEL_LENSES.map((l) => l.id), ["funding", "positioning", "catalysts", "forecast", "qsignals", "tape"]);
  assert.equal(new Set(INTEL_LENSES.map((l) => l.legacyKey)).size, 6);
});

test("the query wins, then the stored choice, then an old open fold, else closed", () => {
  assert.equal(initialLens(store({ [LENS_KEY]: "funding" }), "TAPE"), "tape");
  assert.equal(initialLens(store({ [LENS_KEY]: "catalysts" }), null), "catalysts");
  assert.equal(initialLens(store({ [LENS_KEY]: LENS_NONE, nx_forecast_open: "1" }), null), null);
  // Someone who kept Forecast divergence open under the old folds lands on it.
  assert.equal(initialLens(store({ nx_forecast_open: "1", nx_intel_deep_open: "1" }), null), "forecast");
  assert.equal(initialLens(store({ nx_funding_board_open: "0" }), null), null);
  assert.equal(initialLens(store({ [LENS_KEY]: "bogus" }), "bogus"), null);
});

test("storage that throws (private mode) reads as closed, never a crash", () => {
  assert.equal(initialLens(() => { throw new Error("blocked"); }, null), null);
  assert.equal(initialLens(() => { throw new Error("blocked"); }, "funding"), "funding");
});

test("tapping the open lens closes the card; another opens it; an unknown id changes nothing", () => {
  assert.deepEqual(nextLens(null, "funding"), ["funding", "funding"]);
  assert.deepEqual(nextLens("funding", "funding"), [null, LENS_NONE]);
  assert.deepEqual(nextLens("funding", "tape"), ["tape", "tape"]);
  assert.deepEqual(nextLens("funding", "x"), ["funding", "funding"]);
  assert.equal(lensFromQuery(" Positioning "), "positioning");
  assert.equal(lensFromQuery(undefined), null);
});

test("Lab home renders every lens from the card, and no lens fold is left behind", () => {
  const lab = readFileSync(new URL("../pages/lab/index.tsx", import.meta.url), "utf8");
  for (const l of INTEL_LENSES) {
    if (l.id !== "tape") assert.ok(lab.includes(`id === "${l.id}"`), `lens ${l.id} rendered`);
    assert.ok(!lab.includes(`storageKey="${l.legacyKey}"`), `old fold ${l.legacyKey} gone`);
  }
  assert.ok(lab.includes("<MarketIntelView />"), "Tape is the fallback render");
});
