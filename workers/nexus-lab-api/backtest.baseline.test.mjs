// Random-entry baseline: same markets, trade count, long/short mix and exits — random timing.
// Run: node --test workers/nexus-lab-api/backtest.baseline.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { randomEntryBaseline, BASELINE_MIN_TRADES } from "./backtest.mjs";

const H = 3600, T0 = 1_790_000_000 - (1_790_000_000 % 3600);
const CFG = { tpPercent: 1, slPercent: 1, maxHoldHours: 6, capitalPerTrade: 50, leverage: 1, feeBps: 3 };

// Seeded random-walk tape; `pumps` = bars where price jumps +2% on the NEXT bar.
function tape(n, seed, pumps = []) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const set = new Set(pumps.map((i) => i + 1));
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    p = set.has(i) ? p * 1.02 : p * (1 + (rnd() - 0.5) * 0.004);
    const h = Math.max(o, p) * 1.001, l = Math.min(o, p) * 0.999;
    return { t: T0 + i * H, o, h, l, c: p };
  });
}
const trade = (symbol, candles, i, direction) => {
  // resolve the real trade through the same kind of exit the baseline uses (TP/SL/timeout)
  const entry = candles[i].c;
  let pnlPct = null;
  for (let k = i + 1; k < candles.length && k <= i + CFG.maxHoldHours; k++) {
    const c = candles[k];
    const adv = direction === "LONG" ? (c.l - entry) / entry * 100 : (entry - c.h) / entry * 100;
    const fav = direction === "LONG" ? (c.h - entry) / entry * 100 : (entry - c.l) / entry * 100;
    if (adv <= -CFG.slPercent) { pnlPct = adv; break; }
    if (k - i >= CFG.maxHoldHours) { pnlPct = direction === "LONG" ? (c.l - entry) / entry * 100 : (entry - c.h) / entry * 100; break; }
    if (fav >= CFG.tpPercent) { pnlPct = fav; break; }
  }
  return { symbol, direction, entryT: candles[i].t, pnlPct };
};

test("perfect timing (entering right before each pump) beats nearly every random replay", () => {
  const pumps = Array.from({ length: 12 }, (_, k) => 30 + k * 25);
  const c = tape(400, 1, pumps);
  const real = pumps.map((i) => trade("PERP_BTC_USDC", c, i, "LONG"));
  const b = randomEntryBaseline([{ symbol: "PERP_BTC_USDC", candles: c }], CFG, real, { runs: 200 });
  assert.equal(b.verdict, "BEATS_RANDOM");
  assert.ok(b.pctBeaten >= 95, String(b.pctBeaten));
  assert.equal(b.trades, 12, "same number of trades");
  assert.ok(b.randomMedianUsd < b.realNetUsd);
});

test("the worst timing (shorting right before each pump) loses to nearly every random replay", () => {
  const pumps = Array.from({ length: 12 }, (_, k) => 30 + k * 25);
  const c = tape(400, 2, pumps);
  const real = pumps.map((i) => trade("PERP_BTC_USDC", c, i, "SHORT"));
  const b = randomEntryBaseline([{ symbol: "PERP_BTC_USDC", candles: c }], CFG, real, { runs: 200 });
  assert.ok(b.pctBeaten <= 5, String(b.pctBeaten));
  assert.equal(b.verdict, "NOT_DISTINGUISHABLE");
});

test("entries that ARE random land mid-pack — the baseline doesn't flatter noise", () => {
  const c = tape(400, 3);
  let s = 99;
  const pick = () => ((s = (Math.imul(s, 22695477) + 1) >>> 0) % 380) + 1;
  const real = Array.from({ length: 15 }, (_, k) => trade("PERP_BTC_USDC", c, pick(), k % 2 ? "LONG" : "SHORT")).filter((t) => t.pnlPct != null);
  const b = randomEntryBaseline([{ symbol: "PERP_BTC_USDC", candles: c }], CFG, real, { runs: 300 });
  assert.ok(b.pctBeaten > 5 && b.pctBeaten < 95, String(b.pctBeaten));
});

test("reproducible: the same seed gives the same answer", () => {
  const pumps = [40, 90, 140, 190, 240, 290];
  const c = tape(400, 4, pumps);
  const real = pumps.map((i) => trade("PERP_BTC_USDC", c, i, "LONG"));
  const m = [{ symbol: "PERP_BTC_USDC", candles: c }];
  assert.deepEqual(randomEntryBaseline(m, CFG, real, { seed: 11 }), randomEntryBaseline(m, CFG, real, { seed: 11 }));
});

test("keeps each trade on its own market (a trade on an unknown market is dropped, not reassigned)", () => {
  const pumps = [40, 90, 140, 190, 240, 290];
  const c = tape(400, 5, pumps);
  const real = [...pumps.map((i) => trade("PERP_BTC_USDC", c, i, "LONG")), { symbol: "PERP_NOPE_USDC", direction: "LONG", entryT: T0, pnlPct: 1 }];
  const b = randomEntryBaseline([{ symbol: "PERP_BTC_USDC", candles: c }], CFG, real, { runs: 50 });
  assert.equal(b.trades, pumps.length);
});

test(`fewer than ${BASELINE_MIN_TRADES} trades → TOO_FEW_TRADES (no verdict from a handful)`, () => {
  const c = tape(200, 6);
  const b = randomEntryBaseline([{ symbol: "PERP_BTC_USDC", candles: c }], CFG, [trade("PERP_BTC_USDC", c, 50, "LONG")]);
  assert.equal(b.verdict, "TOO_FEW_TRADES");
  assert.equal(b.runs, 0);
});
