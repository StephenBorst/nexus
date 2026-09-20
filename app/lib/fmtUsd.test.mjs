// Run: node --test app/lib/fmtUsd.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { fmtUsdCompact, fmtUsdExact, fmtUsdCompactAbs } from "./fmtUsd.mjs";

test("fmtUsdCompact: the 6-figure value that overflowed the tile is now short", () => {
  assert.equal(fmtUsdCompact(148617.53), "+$148.6k");
  assert.ok(fmtUsdCompact(148617.53).length <= 9, "fits a stat tile at phone width");
});

test("fmtUsdCompact: scales by magnitude, keeps the sign", () => {
  assert.equal(fmtUsdCompact(842.1), "+$842.10");
  assert.equal(fmtUsdCompact(-842.1), "-$842.10");
  assert.equal(fmtUsdCompact(9999.99), "+$9999.99", "under 10k stays exact");
  assert.equal(fmtUsdCompact(10000), "+$10.0k");
  assert.equal(fmtUsdCompact(-1490000), "-$1.49M");
  assert.equal(fmtUsdCompact(2.5e9), "+$2.50B");
  assert.equal(fmtUsdCompact(0), "+$0.00");
});

test("fmtUsdExact: full precision for the tooltip", () => {
  assert.equal(fmtUsdExact(148617.53), "+$148,617.53");
  assert.equal(fmtUsdExact(-42), "-$42.00");
});

test("non-finite never renders NaN", () => {
  for (const bad of [NaN, undefined, null, "abc", Infinity]) {
    assert.equal(fmtUsdCompact(bad), "—");
    assert.equal(fmtUsdExact(bad), "—");
  }
});

test("fmtUsdCompactAbs drops the sign for direction-labelled tiles", () => {
  assert.equal(fmtUsdCompactAbs(148617.53), "$148.6k");
  assert.equal(fmtUsdCompactAbs(-320.5), "$320.50");
});
