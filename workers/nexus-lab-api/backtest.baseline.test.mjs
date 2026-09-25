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
  // This line used to assert NOT_DISTINGUISHABLE — pinning a label that contradicted the test's
  // own title. Losing to ~every random replay IS distinguishable: it's reliably worse.
  assert.equal(b.verdict, "BELOW_RANDOM");
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

// ── trades-needed + evidence across markets ──────────────────────────────────
import { probit, tradesToSeparate, evidenceAcrossMarkets } from "./backtest.mjs";

test("probit matches known quantiles; tradesToSeparate scales with (z95/z)^2", () => {
  assert.ok(Math.abs(probit(0.5)) < 1e-9);
  assert.ok(Math.abs(probit(0.95) - 1.6448536) < 1e-6);
  assert.ok(Math.abs(probit(0.025) + 1.959964) < 1e-5);
  assert.equal(tradesToSeparate(95, 20), 20, "already at the line → the same n");
  assert.ok(tradesToSeparate(80, 10) > 10);
  assert.ok(tradesToSeparate(70, 10) > tradesToSeparate(85, 10), "weaker reading needs more trades");
  assert.equal(tradesToSeparate(50, 10), null, "no edge to scale");
  assert.equal(tradesToSeparate(30, 10), null);
  assert.equal(tradesToSeparate(80, 0), null);
});

test("baseline reports how many more trades a verdict needs", () => {
  const pumps = [40, 90, 140, 190, 240, 290];
  const c = tape(400, 8, pumps);
  const real = pumps.map((i) => trade("PERP_BTC_USDC", c, i, "LONG"));
  const b = randomEntryBaseline([{ symbol: "PERP_BTC_USDC", candles: c }], CFG, real, { runs: 100 });
  if (b.pctBeaten > 50) {
    assert.ok(Number.isInteger(b.tradesNeeded));
    assert.equal(b.moreTradesNeeded, Math.max(0, b.tradesNeeded - b.trades));
  } else assert.equal(b.tradesNeeded, null);
});

test("evidence: each market replayed on its own, trades pooled, baseline on the pool, caveat stated", () => {
  // MOMENTUM on pump tapes: every market fires; pooled trades = the sum of per-market trades
  const M = { signalMode: "MOMENTUM", priceChangeThreshold: 1, tpPercent: 1, slPercent: 1, maxHoldHours: 6, capitalPerTrade: 50, leverage: 1 };
  const mk = (sym, seed) => ({ symbol: sym, candles: tape(400, seed, Array.from({ length: 10 }, (_, k) => 20 + k * 35)), feeds: {} });
  const markets = [mk("PERP_BTC_USDC", 11), mk("PERP_ETH_USDC", 12), mk("PERP_SOL_USDC", 13)];
  const ev = evidenceAcrossMarkets(markets, M, { runs: 80 });
  assert.equal(ev.markets, 3);
  assert.equal(ev.trades, ev.perMarket.reduce((s, x) => s + x.trades, 0));
  assert.ok(ev.trades >= BASELINE_MIN_TRADES);
  assert.equal(ev.baseline.trades, ev.trades, "baseline tests the whole pool");
  assert.match(ev.caveat, /not independent/);
  assert.ok(ev.perMarket[0].netUsd >= ev.perMarket[ev.perMarket.length - 1].netUsd, "sorted by net");
});

import { marketDiag } from "./backtest.mjs";
test("marketDiag: exits by reason, sides, and the stop measured in typical hourly ranges", () => {
  const candles = [{ h: 101, l: 99, c: 100 }, { h: 102, l: 100, c: 101 }, { h: 100.5, l: 99.5, c: 100 }]; // ranges 2%, ~1.98%, 1%
  const trades = [
    { reason: "SL", direction: "LONG", holdH: 2 },
    { reason: "SL", direction: "SHORT", holdH: 4 },
    { reason: "TP", direction: "SHORT", holdH: 6 },
  ];
  const d = marketDiag(candles, trades, { slPercent: 2 });
  assert.deepEqual(d.exits, { SL: 2, TP: 1 });
  assert.equal(d.longs, 1); assert.equal(d.shorts, 2);
  assert.equal(d.avgHoldH, 4);
  assert.equal(d.medHourlyRangePct, 1.98);
  assert.equal(d.stopInRanges, 1.01);
  assert.equal(marketDiag([], [], {}).stopInRanges, null, "no candles → no claim");
});
