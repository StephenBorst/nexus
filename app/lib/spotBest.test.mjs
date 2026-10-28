import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBest, bestLine, SAME_BPS } from "./spotBest.mjs";

test("compares spanDEX base units against Flash token units", () => {
  // spanDEX 8.4723 WETH-milli in 18 decimals vs Flash 0.0084... same scale
  const r = pickBest({ spandexRaw: "8472375047237527", flashHuman: "0.008430", decimals: 18 });
  assert.equal(r.best, "spandex");
  assert.ok(Math.abs(r.spandex - 0.008472375) < 1e-9);
  assert.ok(r.edgePct > 0.4 && r.edgePct < 0.6);
  assert.equal(pickBest({ spandexRaw: "1000000", flashHuman: "1.02", decimals: 6 }).best, "flash");
});

test("under SAME_BPS reads as about the same", () => {
  assert.equal(SAME_BPS, 5);
  assert.equal(pickBest({ spandexRaw: "1000000", flashHuman: "1.0004", decimals: 6 }).best, "same");
});

test("one side missing → that side only, no edge; nothing → null", () => {
  assert.deepEqual(pickBest({ spandexRaw: null, flashHuman: "2", decimals: 6 }), { spandex: null, flash: 2, best: "flash", edgePct: null });
  assert.equal(pickBest({ spandexRaw: "5", flashHuman: null, decimals: null }).best, null, "spanDEX unreadable without decimals");
  assert.equal(pickBest({ spandexRaw: null, flashHuman: "0", decimals: 6 }).best, null);
});

test("the ticket line", () => {
  assert.equal(bestLine(pickBest({ spandexRaw: "1000000", flashHuman: "1.02", decimals: 6 }), "WETH"), "Best price now: Flash · 2.00% more WETH (est.)");
  assert.match(bestLine(pickBest({ spandexRaw: "1000000", flashHuman: "1.0001", decimals: 6 }), "X"), /About the same/);
  assert.equal(bestLine(pickBest({ spandexRaw: null, flashHuman: "1", decimals: 6 }), "X"), null, "no comparison with one router");
});
