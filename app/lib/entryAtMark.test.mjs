// Run: node --test app/lib/entryAtMark.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENTRY_AT_MARK_PCT, atMark, publishMarkLine } from "./entryAtMark.mjs";
import { ENTRY_AT_MARK_PCT as GRADER_PCT } from "../../workers/nexus-lab-api/logic.mjs";

test("the call page and the grader use the same band", () => {
  assert.equal(GRADER_PCT, ENTRY_AT_MARK_PCT);
  assert.equal(ENTRY_AT_MARK_PCT, 0.3);
});

test("atMark: 0.3% either side of the mark", () => {
  assert.equal(atMark(100.3, 100), true);
  assert.equal(atMark(99.7, 100), true);
  assert.equal(atMark(100.31, 100), false);
  assert.equal(atMark(99.6, 100), false);
});

test("publishMarkLine: says what the grader will do with this entry", () => {
  const at = publishMarkLine({ entryPrice: 63750, publishMark: { px: 63712.4 } });
  assert.equal(at.markText, "$63,712.40");
  assert.equal(at.atMarket, true);
  assert.equal(at.line, "Entry within 0.3% of it: filled when posted.");

  const below = publishMarkLine({ entryPrice: 61000, publishMark: { px: 63712.4 } });
  assert.equal(below.atMarket, false);
  assert.equal(below.offPct, -4.26);
  assert.equal(below.line, "Entry 4.26% below it: counts once price trades there.");

  const above = publishMarkLine({ entryPrice: 0.00125, publishMark: { px: 0.001234567 } });
  assert.equal(above.markText, "$0.001235", "small prices keep 4 significant digits");
  assert.match(above.line, /above it/);
});

test("publishMarkLine: no locked price, nothing to show", () => {
  for (const t of [{}, { entryPrice: 100 }, { entryPrice: 100, publishMark: null }, { entryPrice: 100, publishMark: { px: 0 } },
    { entryPrice: 0, publishMark: { px: 100 } }, null]) {
    assert.equal(publishMarkLine(t), null, JSON.stringify(t));
  }
});
