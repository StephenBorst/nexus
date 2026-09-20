// Tests for the OI coverage gate that decides whether CONFLUENCE / OI_ONLY are testable.
// Run: node --test workers/nexus-lab-api/strategies.test.mjs
//
// THE BUG THIS PINS: maturity used to be min(days)/min(samples) across every requested
// symbol. /agent/backtest asks about the CONFIG's symbols (BTC…) while /agent/validate
// asks about a fixed 6-symbol universe that includes BNB/XRP/LINK — which the brain only
// records when a user watchlists them. One unrecorded symbol zeroed the min, so the same
// config in the same session reported "tested over 81d" on TEST and "still maturing
// (0/14d)" on VALIDATE. Maturity is now per-symbol and callers run the mature subset.
import test from "node:test";
import assert from "node:assert/strict";
import {
  loadOiHistForBacktest, oiSymbolMature, oiCoverageText, shortSymbols,
  OI_BACKTEST_MIN_DAYS, OI_BACKTEST_MIN_SAMPLES, MIN_VALIDATE_SYMBOLS,
} from "./strategies.mjs";

const DAY = 86400000;
// An hourly-ish series with `samples` points spanning `days`.
function mkSeries(samples, days) {
  const end = Date.now(), start = end - days * DAY;
  const step = samples > 1 ? (end - start) / (samples - 1) : 0;
  return Array.from({ length: samples }, (_, i) => ({ t: Math.round(start + i * step), price: 100 + i, oi: 1000 + i, funding: 0.0001 }));
}
const fakeEnv = (map) => ({
  NEXUS_AGENT: { get: async (k) => { const sym = String(k).replace("oi:hist:", ""); return map[sym] ? JSON.stringify(map[sym]) : null; } },
});

// What production actually looks like: core three recorded for months, the rest never.
const CORE = { PERP_BTC_USDC: mkSeries(1900, 81), PERP_ETH_USDC: mkSeries(1900, 81), PERP_SOL_USDC: mkSeries(1900, 81) };
const VALIDATE_UNIVERSE = ["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC", "PERP_BNB_USDC", "PERP_XRP_USDC", "PERP_LINK_USDC"];

test("oiSymbolMature: a symbol clears the bar on its OWN coverage", () => {
  assert.equal(oiSymbolMature({ days: 81, samples: 1900 }), true);
  assert.equal(oiSymbolMature({ days: OI_BACKTEST_MIN_DAYS, samples: OI_BACKTEST_MIN_SAMPLES }), true, "exactly at the bar");
  assert.equal(oiSymbolMature({ days: 13, samples: 1900 }), false, "deep but too short");
  assert.equal(oiSymbolMature({ days: 81, samples: 199 }), false, "long but too sparse");
  assert.equal(oiSymbolMature({ days: 0, samples: 0 }), false);
  assert.equal(oiSymbolMature(null), false);
});

test("REGRESSION: one unrecorded symbol no longer zeroes the whole universe", async () => {
  const oi = await loadOiHistForBacktest(VALIDATE_UNIVERSE, fakeEnv(CORE));
  assert.deepEqual(oi.matureSymbols, ["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC"]);
  assert.deepEqual(oi.staleSymbols, ["PERP_BNB_USDC", "PERP_XRP_USDC", "PERP_LINK_USDC"]);
  assert.equal(oi.anyMature, true, "BTC/ETH/SOL are testable even though BNB/XRP/LINK are empty");
  assert.equal(oi.oiMature, false, "strict all-symbols flag is still honestly false");
  assert.equal(oi.gate.minDays, 0, "the old min() really is 0 here — that was the 0/14d report");
  assert.equal(oi.matureMinDays, 81, "but the symbols we RUN span 81d");
  assert.ok(oi.matureSymbols.length >= MIN_VALIDATE_SYMBOLS, "enough markets for a walk-forward");
});

test("REGRESSION: TEST and VALIDATE reach the same verdict on the same KV", async () => {
  const env = fakeEnv(CORE);
  const testSide = await loadOiHistForBacktest(["PERP_BTC_USDC"], env);          // /agent/backtest: config symbols
  const validateSide = await loadOiHistForBacktest(VALIDATE_UNIVERSE, env);      // /agent/validate: fixed universe
  assert.equal(testSide.anyMature, true);
  assert.equal(validateSide.anyMature, true);
  assert.equal(testSide.anyMature, validateSide.anyMature, "no more split gate: both see usable OI");
});

test("oiHistMature hands the engine ONLY mature series (no empty ones leak in)", async () => {
  const oi = await loadOiHistForBacktest(VALIDATE_UNIVERSE, fakeEnv(CORE));
  assert.deepEqual(Object.keys(oi.oiHistMature).sort(), ["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC"]);
  assert.equal(oi.oiHistBySymbol.PERP_BNB_USDC.length, 0, "raw map still shows the empty series");
  assert.equal(oi.oiHistMature.PERP_BNB_USDC, undefined, "but it never reaches the engine");
});

test("nothing recorded anywhere → honestly untestable", async () => {
  const oi = await loadOiHistForBacktest(["PERP_BNB_USDC", "PERP_XRP_USDC"], fakeEnv({}));
  assert.equal(oi.anyMature, false);
  assert.deepEqual(oi.matureSymbols, []);
  assert.equal(oi.matureMinDays, 0);
  assert.deepEqual(Object.keys(oi.oiHistMature), []);
});

test("a still-accruing symbol is excluded, not counted", async () => {
  const oi = await loadOiHistForBacktest(["PERP_BTC_USDC", "PERP_SOL_USDC"], fakeEnv({
    PERP_BTC_USDC: mkSeries(1900, 81), PERP_SOL_USDC: mkSeries(150, 9), // 9d/150 — short AND sparse
  }));
  assert.deepEqual(oi.matureSymbols, ["PERP_BTC_USDC"]);
  assert.deepEqual(oi.staleSymbols, ["PERP_SOL_USDC"]);
  assert.ok(oi.matureSymbols.length < MIN_VALIDATE_SYMBOLS, "one market can't be called robust — validate must refuse");
});

test("coverage text names WHICH market is short", async () => {
  const oi = await loadOiHistForBacktest(["PERP_BTC_USDC", "PERP_BNB_USDC"], fakeEnv(CORE));
  const txt = oiCoverageText(oi.gate.perSymbol);
  assert.match(txt, /BTC 81d\/1900/);
  assert.match(txt, /BNB 0d\/0/);
  assert.equal(shortSymbols(oi.staleSymbols), "BNB");
});
