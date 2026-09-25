// Funding display — the "don't clamp, explain" rule, pinned.
// Run: node --test app/lib/funding.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  FUNDING_PERIODS_PER_YEAR, annualizeFundingPct, periodFromAnnualPct,
  fmtFunding8h, isThinBook, THIN_OI_USD, BOARD_MIN_OI_USD,
} from "./funding.mjs";

test("the annualized figure is the period rate × 1095 — nothing else", () => {
  assert.equal(FUNDING_PERIODS_PER_YEAR, 3 * 365);
  // The real USDJPY print that looked broken: -0.188%/8h IS -206%/yr.
  assert.ok(Math.abs(annualizeFundingPct(-0.188) - -205.86) < 0.01);
  assert.ok(Math.abs(periodFromAnnualPct(-206) - -0.18813) < 1e-4);
  // Round-trip: no clamping, no saturation, at any magnitude.
  for (const p of [-0.5, -0.188, -0.01, 0, 0.0001, 0.02, 1.2]) {
    assert.ok(Math.abs(periodFromAnnualPct(annualizeFundingPct(p)) - p) < 1e-12, `round-trip ${p}`);
  }
});

test("an extreme annualized rate is NEVER squashed into a sane-looking range", () => {
  // The guard against the 'fix the display by fixing the number' temptation.
  assert.ok(annualizeFundingPct(-0.5) < -500, "a -0.5%/8h book really is < -500%/yr");
  assert.ok(annualizeFundingPct(2) > 2000, "and the upside is just as unbounded");
});

test("fmtFunding8h keeps enough precision that a live rate never reads as zero", () => {
  assert.equal(fmtFunding8h(-0.188125), "-0.188%");
  assert.equal(fmtFunding8h(0.01), "+0.01%");
  assert.equal(fmtFunding8h(0.0001), "+0.0001%", "a tiny-but-real rate stays visible");
  assert.equal(fmtFunding8h(0.00001), "+0.00001%");
  assert.equal(fmtFunding8h(0), "0%", "flat is flat — no sign, no padding");
  assert.equal(fmtFunding8h(1.5), "+1.5%");
});

test("fmtFunding8h returns null for absent data so callers can omit the line", () => {
  // Number(null) is 0 — printing "0%" for missing data would report a flat book.
  assert.equal(fmtFunding8h(null), null);
  assert.equal(fmtFunding8h(undefined), null);
  assert.equal(fmtFunding8h(""), null);
  assert.equal(fmtFunding8h(NaN), null);
  assert.equal(fmtFunding8h("not a number"), null);
});

test("thin-book marks low confidence WITHOUT moving the server gate", () => {
  assert.equal(BOARD_MIN_OI_USD, 50_000, "the gate itself is unchanged");
  assert.ok(THIN_OI_USD > BOARD_MIN_OI_USD, "the marker is stricter than the gate, not a substitute");
  assert.equal(isThinBook(60_000), true, "clears the $50k gate, still too thin to trust");
  assert.equal(isThinBook(5_000_000), false);
  assert.equal(isThinBook(THIN_OI_USD), false, "the threshold itself is not thin");
  assert.equal(isThinBook(null), false, "no OI reading is not a thin-book claim");
  assert.equal(isThinBook(NaN), false);
});
