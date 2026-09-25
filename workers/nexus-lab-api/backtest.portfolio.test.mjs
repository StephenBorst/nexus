// Portfolio replay: the agent's whole watchlist on one timeline, one position at a time,
// the brain's single best signal per tick, the exec's own daily caps.
// Run: node --test workers/nexus-lab-api/backtest.portfolio.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { runBacktest, runPortfolioBacktest } from "./backtest.mjs";

const T0 = 1_790_000_000 - (1_790_000_000 % 3600); // hour-aligned, seconds
const H = 3600;
// Flat 100 tape of n hourly bars; `jumps` = bar indexes where price steps +1% (a MOMENTUM LONG).
function tape(n, jumps = []) {
  const set = new Set(jumps);
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    if (set.has(i)) p *= 1.01;
    return { t: T0 + i * H, o: p, h: p * 1.0005, l: p * 0.9995, c: p };
  });
}
const feeds = { fundingAt: () => 0 };
const CFG = { signalMode: "MOMENTUM", priceChangeThreshold: 0.5, tpPercent: 5, slPercent: 5, maxHoldHours: 3, capitalPerTrade: 50, leverage: 1, feeBps: 0 };
const mk = (symbol, candles) => ({ symbol, candles, feeds });
const cfg = (extra = {}) => ({ ...CFG, symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC"], ...extra });

test("one market, no caps: the portfolio replay equals runBacktest trade-for-trade", () => {
  const c = tape(60, [5, 20, 40]);
  const single = runBacktest(c, feeds.fundingAt, CFG);
  const port = runPortfolioBacktest([mk("PERP_BTC_USDC", c)], { ...CFG, symbols: ["PERP_BTC_USDC"] });
  assert.equal(port.trades, single.trades);
  assert.deepEqual(port._trades.map((t) => [t.entryT, t.reason]), single._trades.map((t) => [t.entryT, t.reason]));
  assert.equal(port.netUsd, single.netUsd);
});

test("two markets fire on the same bar: the agent takes ONE (first-listed on a tie)", () => {
  const port = runPortfolioBacktest([mk("PERP_ETH_USDC", tape(30, [5])), mk("PERP_BTC_USDC", tape(30, [5]))], cfg());
  assert.equal(port.trades, 1);
  assert.equal(port._trades[0].symbol, "PERP_BTC_USDC", "watchlist order decides a tie, not array order");
  assert.equal(port.blocked.otherMarket, 1);
});

test("a signal on another market while a position is open is blocked (one position at a time)", () => {
  const port = runPortfolioBacktest([mk("PERP_BTC_USDC", tape(30, [5])), mk("PERP_ETH_USDC", tape(30, [6]))], cfg());
  assert.equal(port.trades, 1);
  assert.equal(port._trades[0].symbol, "PERP_BTC_USDC");
  assert.equal(port.blocked.busy, 1);
  // the per-market replays would have taken both
  const indep = runBacktest(tape(30, [5]), feeds.fundingAt, CFG).trades + runBacktest(tape(30, [6]), feeds.fundingAt, CFG).trades;
  assert.equal(indep, 2);
});

test("cooldown: no entry on the exit bar or the bar after (runBacktest's cooldownBars semantics)", () => {
  // BTC enters at 5, times out at 8; ETH fires at 9 (inside cooldown) and 12 (free)
  const port = runPortfolioBacktest([mk("PERP_BTC_USDC", tape(30, [5])), mk("PERP_ETH_USDC", tape(30, [9, 12]))], cfg());
  assert.equal(port.blocked.cooldown, 1);
  assert.deepEqual(port._trades.map((t) => t.symbol), ["PERP_BTC_USDC", "PERP_ETH_USDC"]);
});

test("daily trade cap (the exec's own dailyCapBlocked) stops entries until the 24h reset", () => {
  const port = runPortfolioBacktest([mk("PERP_BTC_USDC", tape(60, [5, 12, 30]))], { ...cfg({ symbols: ["PERP_BTC_USDC"] }), maxTradesPerDay: 1 });
  // 5 taken; 12 same day → capped; 30 is > 24h after the reset stamp at bar 0 → taken
  assert.equal(port.blocked.dailyCap, 1);
  assert.equal(port.trades, 2);
});

test("daily loss cap blocks after a losing day", () => {
  // A −1% step right after entry makes the first trade a loser; cap $0.10 on a $50 notional.
  const c = tape(40, [5]);
  c[6] = { ...c[6], l: c[6].c * 0.9, h: c[6].c, c: c[6].c * 0.94 };
  for (let i = 7; i < c.length; i++) c[i] = { ...c[i], o: c[6].c, h: c[6].c * 1.0005, l: c[6].c * 0.9995, c: c[6].c };
  c[12] = { ...c[12], c: c[11].c * 1.01, h: c[11].c * 1.0105 }; // a fresh LONG signal the same day
  for (let i = 13; i < c.length; i++) c[i] = { ...c[i], o: c[12].c, h: c[12].c * 1.0005, l: c[12].c * 0.9995, c: c[12].c };
  const port = runPortfolioBacktest([mk("PERP_BTC_USDC", c)], { ...cfg({ symbols: ["PERP_BTC_USDC"] }), maxDailyLossUsdc: 0.1 });
  assert.equal(port._trades[0].reason, "SL");
  assert.equal(port.blocked.dailyCap, 1);
  assert.equal(port.trades, 1);
});

test("per-symbol breakdown sums to the total", () => {
  const port = runPortfolioBacktest([mk("PERP_BTC_USDC", tape(80, [5, 40])), mk("PERP_ETH_USDC", tape(80, [20, 60]))], cfg());
  assert.equal(port.perSymbol.reduce((s, x) => s + x.trades, 0), port.trades);
});

// ── Sweep + walk-forward on the portfolio replay (market data stubbed) ─────────
import { runSweep, walkForwardValidate } from "./backtest.mjs";
const NOW_S = T0 + 400 * H;
function stubMarkets(bySymbol, fn) {
  const realFetch = globalThis.fetch, realNow = Date.now;
  Date.now = () => NOW_S * 1000;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.includes("/tv/history")) {
      const c = bySymbol[u.searchParams.get("symbol")] || [];
      const from = +u.searchParams.get("from"), to = +u.searchParams.get("to");
      const rows = c.filter((x) => x.t >= from && x.t < to);
      return { json: async () => ({ s: "ok", t: rows.map((x) => x.t), o: rows.map((x) => x.o), h: rows.map((x) => x.h), l: rows.map((x) => x.l), c: rows.map((x) => x.c) }) };
    }
    return { json: async () => ({ data: { rows: [] } }) };
  };
  return fn().finally(() => { globalThis.fetch = realFetch; Date.now = realNow; });
}
// Two markets whose moves overlap: the per-market sum counts both, the agent can take one.
const overlapping = () => {
  const jumps = Array.from({ length: 20 }, (_, k) => 20 + k * 18);
  return { PERP_BTC_USDC: tape(400, jumps), PERP_ETH_USDC: tape(400, jumps.map((j) => j + 1)) };
};

test("sweep: ranked by the portfolio net; the per-market sum is kept for reference", async () => {
  await stubMarkets(overlapping(), async () => {
    const out = await runSweep({ maxTradesPerDay: 9 }, { symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC"], days: 16 });
    assert.equal(out.rankedBy, "portfolio");
    for (let i = 1; i < out.results.length; i++) assert.ok(out.results[i - 1].netUsd >= out.results[i].netUsd);
    assert.ok(out.results.every((r) => Number.isFinite(r.indepNetUsd) && Number.isFinite(r.indepTrades)));
    assert.ok(out.results.some((r) => r.trades < r.indepTrades), "overlap removed at least somewhere");
  });
});

test("walk-forward: verdict stays per-market; the portfolio stream replays the config's own watchlist", async () => {
  await stubMarkets(overlapping(), async () => {
    const cfg = { ...CFG, symbols: ["PERP_BTC_USDC"] };
    const v = await walkForwardValidate(cfg, { symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC"], days: 16, folds: 4 });
    assert.equal(v.totalSymbols, 2, "breadth across the whole validate universe");
    assert.deepEqual(v.portfolio.watchlist, ["PERP_BTC_USDC"]);
    assert.equal(v.portfolio.folds.length, 4);
    assert.equal(v.portfolio.foldTrades.reduce((a, b) => a + b, 0), v.portfolio.trades);
    const btcOnly = v.perSymbol.find((s) => s.symbol === "PERP_BTC_USDC");
    assert.equal(v.portfolio.trades, btcOnly.trades, "one market, no competition → same trades as its own replay");
  });
});
