import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBest, bestLine, bestGasNote, routeFor, SAME_BPS } from "./spotBest.mjs";

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
  assert.deepEqual(pickBest({ spandexRaw: null, flashHuman: "2", decimals: 6 }), { spandex: null, flash: 2, spandexAfterGas: null, gasIncluded: false, best: "flash", edgePct: null });
  assert.equal(pickBest({ spandexRaw: "5", flashHuman: null, decimals: null }).best, null, "spanDEX unreadable without decimals");
  assert.equal(pickBest({ spandexRaw: null, flashHuman: "0", decimals: 6 }).best, null);
});

test("the ticket line", () => {
  assert.equal(bestLine(pickBest({ spandexRaw: "1000000", flashHuman: "1.02", decimals: 6 }), "WETH"), "Best price now: Flash · 2.00% more WETH (est.)");
  assert.match(bestLine(pickBest({ spandexRaw: "1000000", flashHuman: "1.0001", decimals: 6 }), "X"), /About the same/);
  assert.equal(bestLine(pickBest({ spandexRaw: null, flashHuman: "1", decimals: 6 }), "X"), null, "no comparison with one router");
});

test("gas: comes off spanDEX before comparing, so a small lead can flip", () => {
  // spanDEX 1.0018 vs Flash 1.0000 (Flash already after its gas). spanDEX gas = 0.0015 token.
  const r = pickBest({ spandexRaw: "1001800", flashHuman: "1.0000", decimals: 6, gasToken: 0.0015 });
  assert.equal(r.gasIncluded, true);
  assert.ok(Math.abs(r.spandexAfterGas - 1.0003) < 1e-9);
  assert.equal(r.best, "same", "0.03% after gas is under 5 bps");
  const big = pickBest({ spandexRaw: "1001800", flashHuman: "1.0000", decimals: 6, gasToken: 0.01 });
  assert.equal(big.best, "flash");
  assert.equal(pickBest({ spandexRaw: "1001800", flashHuman: "1.0000", decimals: 6, gasToken: 0 }).best, "spandex", "zero gas = plain compare");
});

test("gas: unknown leaves the plain compare; gas bigger than the output → Flash, no edge claimed", () => {
  const r = pickBest({ spandexRaw: "1020000", flashHuman: "1", decimals: 6, gasToken: null });
  assert.equal(r.gasIncluded, false);
  assert.equal(r.spandexAfterGas, null);
  assert.equal(r.best, "spandex");
  const eaten = pickBest({ spandexRaw: "1000000", flashHuman: "0.5", decimals: 6, gasToken: 2 });
  assert.equal(eaten.best, "flash");
  assert.equal(eaten.edgePct, null);
  assert.equal(bestLine(eaten, "X"), "Best price now: Flash (est.)");
});

test("the note says what was counted", () => {
  assert.equal(bestGasNote(null), "");
  assert.equal(bestGasNote({ gasIncluded: false }), "Flash incl. gas");
  assert.equal(bestGasNote({ gasIncluded: true, gasUsd: 0.0234 }), "both after gas · spanDEX gas ≈ $0.02");
  assert.equal(bestGasNote({ gasIncluded: true, gasUsd: 0.0031 }), "both after gas · spanDEX gas ≈ $0.0031");
  assert.equal(bestGasNote({ gasIncluded: true, gasUsd: null }), "both after gas");
});

test("routeFor: the main BUY opens Flash only when Flash clearly nets more on a real comparison", () => {
  // Flash 2% ahead → Flash.
  assert.equal(routeFor(pickBest({ spandexRaw: "1000000", flashHuman: "1.02", decimals: 6 })), "flash");
  // spanDEX ahead → spanDEX.
  assert.equal(routeFor(pickBest({ spandexRaw: "1020000", flashHuman: "1", decimals: 6 })), "spandex");
  // Under SAME_BPS is a tie → stays on spanDEX (the default), never flips on noise.
  assert.equal(routeFor(pickBest({ spandexRaw: "1000000", flashHuman: "1.0001", decimals: 6 })), "spandex");
  // Gas eats spanDEX's whole output → Flash.
  assert.equal(routeFor(pickBest({ spandexRaw: "1000000", flashHuman: "0.5", decimals: 6, gasToken: 2 })), "flash");
  // Gas flips a small spanDEX lead into a Flash win → Flash.
  assert.equal(routeFor(pickBest({ spandexRaw: "1001800", flashHuman: "1.0000", decimals: 6, gasToken: 0.01 })), "flash");
});

test("routeFor: no real comparison → spanDEX", () => {
  assert.equal(routeFor(null), "spandex");
  assert.equal(routeFor(undefined), "spandex");
  // Only Flash quoted (pickBest says flash, but there was nothing to beat) → no reroute.
  assert.equal(routeFor(pickBest({ spandexRaw: null, flashHuman: "1", decimals: 6 })), "spandex");
  assert.equal(routeFor(pickBest({ spandexRaw: "1000000", flashHuman: null, decimals: 6 })), "spandex");
  assert.equal(routeFor({ best: "flash", spandex: null, flash: 1 }), "spandex");
});
