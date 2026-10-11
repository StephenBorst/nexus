// Stop triggers checked against Flash's own price (from a market quote), not the page's.
// Run: node --test app/lib/flashTrigger.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { flashRefPrice, triggerCheck } from "./flashGuards.mjs";

const Q = JSON.parse(readFileSync(new URL("./__fixtures__/flash-quotes.json", import.meta.url), "utf8"));

test("flashRefPrice: the target leg's notional ÷ amount, on a live market buy", () => {
  const p = flashRefPrice(Q.market);
  assert.ok(Math.abs(p - 19.957654 / 0.007370861063564397) < 1e-9);
  assert.ok(p > 2600 && p < 2800, `WETH ≈ $2.7k on the fixture day, got ${p}`);
});

test("flashRefPrice: a sell reads the FROM leg (the token being sold)", () => {
  assert.equal(flashRefPrice(Q.stoploss), 10 / 0.005); // priced at its trigger, which is why the ticket uses a MARKET quote
});

test("flashRefPrice: unreadable quotes give null, never 0 or NaN", () => {
  for (const q of [null, {}, { to: { asset: "target", amount: "0", notional: "5" } }, { to: { asset: "contra", amount: "1", notional: "1" } }, { from: { asset: "target", amount: "x", notional: "1" } }])
    assert.equal(flashRefPrice(q), null);
});

test("triggerCheck: a breakout stop at or below Flash's price is crossed → block", () => {
  assert.deepEqual(triggerCheck({ type: "stop", trigger: 2700, ref: 2707 }), { block: true, crossed: true });
  assert.deepEqual(triggerCheck({ type: "stop", trigger: 2707, ref: 2707 }), { block: true, crossed: true });
});

test("triggerCheck: a stop-loss at or above Flash's price is crossed → block", () => {
  assert.deepEqual(triggerCheck({ type: "stop-loss", trigger: 2710, ref: 2707 }), { block: true, crossed: true });
});

test("triggerCheck: within 0.5% warns without blocking; further out is clean", () => {
  assert.deepEqual(triggerCheck({ type: "stop", trigger: 2715, ref: 2707 }), { block: false, near: true });
  assert.deepEqual(triggerCheck({ type: "stop-loss", trigger: 2700, ref: 2707 }), { block: false, near: true });
  assert.equal(triggerCheck({ type: "stop", trigger: 2750, ref: 2707 }), null);
  assert.equal(triggerCheck({ type: "stop-loss", trigger: 2650, ref: 2707 }), null);
});

test("triggerCheck: the page-vs-Flash gap that let a crossed stop through", () => {
  // Page said $2,690 (stale), Flash's market was $2,707: a stop at $2,700 passed the page check.
  assert.equal(triggerCheck({ type: "stop", trigger: 2700, ref: 2690, near: 0 }), null);
  assert.equal(triggerCheck({ type: "stop", trigger: 2700, ref: flashRefPrice(Q.market) }).block, true);
});

test("triggerCheck: limits, missing prices and junk are not its job → null", () => {
  assert.equal(triggerCheck({ type: "limit", trigger: 1, ref: 2 }), null);
  assert.equal(triggerCheck({ type: "stop", trigger: 2700, ref: null }), null);
  assert.equal(triggerCheck({ type: "stop", trigger: "", ref: 2700 }), null);
});
