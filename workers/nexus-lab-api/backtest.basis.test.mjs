// Tests for the BASIS replay — BASIS_FADE (+ the CVD / smart-money confirms) backtested off
// RECORDED history. The bar: (1) no lookahead — a row written after a bar's close can never
// change that bar's decision; (2) the replay trades exactly what the live brain would, using
// the SAME shared rules; (3) no history ⇒ no trades, never a guess; (4) the sweep + the
// maturity loader behave end-to-end.
// Run: node --test workers/nexus-lab-api/backtest.basis.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { makeBasisAt, runBacktest, runBasisSweep, histSeriesInfo, basisAtForConfig } from "./backtest.mjs";
import { loadFlowHistForBacktest, BASIS_BACKTEST_MIN_DAYS } from "./strategies.mjs";
import { basisFadeFromHistory } from "../../app/lib/basisFade.mjs";
import { basisCvdConfirm } from "../../app/lib/basisStack.mjs";
import { strategyLabel, backtestGateSupport } from "../../app/lib/strategyLabel.mjs";

const H = 3600000;
const T0 = 1_780_000_000_000 - (1_780_000_000_000 % H);

// A deterministic synthetic market: hourly candles + recorded basis/cvd/sm/oi series.
// Basis spikes every 23h after a 60h warm-up; flow is random but seeded.
function market({ hours = 400, seed = 11, spikeEvery = 23 } = {}) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const candles = [], basisHist = [], cvdHist = [], smHist = [], oiHist = [];
  let price = 100;
  for (let i = 0; i < hours; i++) {
    const t = T0 + i * H;
    const o = price;
    price *= 1 + (rnd() - 0.5) * 0.03;
    candles.push({ t: t / 1000, o, h: Math.max(o, price) * (1 + rnd() * 0.01), l: Math.min(o, price) * (1 - rnd() * 0.01), c: price });
    const spike = i > 60 && i % spikeEvery === 0;
    basisHist.push({ t: t + 7 * 60000, basisPct: spike ? (rnd() > 0.5 ? 1 : -1) * (0.5 + rnd()) : (rnd() - 0.5) * 0.1 });
    const buy = 1000 * rnd(), sell = 1000 * rnd();
    cvdHist.push({ t: t + 7 * 60000, cvd: buy - sell, buy, sell });
    oiHist.push({ t: t + 2 * 60000, price, oi: 1, funding: 0 });
    const r = rnd();
    smHist.push({ t: t + 12 * 60000, side: r < 0.45 ? "LONG" : r < 0.9 ? "SHORT" : "SPLIT" });
  }
  return { candles, flow: { basisHist, cvdHist, smHist, oiHist } };
}
const noFunding = () => 0;
const CFG = { signalMode: "BASIS_FADE", leverage: 5, capitalPerTrade: 50, tpPercent: 2.5, slPercent: 2, maxHoldHours: 12, feeBps: 3, cooldownBars: 0 };

test("makeBasisAt: no lookahead — rows written AFTER now cannot change the verdict", () => {
  const { flow } = market();
  const now = T0 + 200 * H + 30 * 60000;
  const before = makeBasisAt(flow, { needCvd: true, needSmart: true })(now);
  // Poison the future: an enormous basis spike + flipped flow one minute after `now`.
  const poisoned = {
    basisHist: [...flow.basisHist, { t: now + 60000, basisPct: 99 }],
    cvdHist: [...flow.cvdHist, { t: now + 60000, cvd: 1e9, buy: 1e9, sell: 0 }],
    smHist: [...flow.smHist, { t: now + 60000, side: "LONG" }],
    oiHist: [...flow.oiHist, { t: now + 60000, price: 1e6, oi: 1 }],
  };
  const after = makeBasisAt(poisoned, { needCvd: true, needSmart: true })(now);
  assert.deepEqual(after, before);
});

test("makeBasisAt: equals the live brain's call on the same prefix (shared rule, no copy)", () => {
  const { flow } = market();
  const at = makeBasisAt(flow, { needCvd: true });
  let checked = 0;
  for (let i = 70; i < 400; i += 1) {
    const now = T0 + i * H + 59 * 60000;
    const prefix = (rows) => rows.filter((r) => r.t <= now);
    const b = basisFadeFromHistory(prefix(flow.basisHist), { now });
    const got = at(now);
    assert.equal(got.basisSide, b.side, `hour ${i}`);
    if (b.side) {
      const c = basisCvdConfirm({ basisT: b.t, side: b.side, cvdHist: prefix(flow.cvdHist), oiHist: prefix(flow.oiHist) });
      assert.equal(got.basisCvdConfirmed, c.confirmed, `hour ${i} cvd`);
      checked++;
    }
  }
  assert.ok(checked > 5, "fixture should produce basis extremes");
});

test("runBacktest: BASIS_FADE with no basis lookup trades NOTHING (never a proxy)", () => {
  const { candles } = market();
  assert.equal(runBacktest(candles, noFunding, CFG).trades, 0);
});

test("runBacktest: BASIS_FADE enters exactly on the hours the basis rule fires", () => {
  const { candles, flow } = market();
  const at = makeBasisAt(flow);
  const r = runBacktest(candles, noFunding, CFG, null, null, null, at);
  assert.ok(r.trades > 3, "should trade the spikes");
  for (const t of r._trades) {
    const i = candles.findIndex((c) => c.t === t.entryT);
    const closeMs = (candles[i + 1]?.t ?? candles[i].t + 3600) * 1000;
    const v = at(closeMs);
    assert.ok(v.basisSide === "LONG" || v.basisSide === "SHORT", "entered without a basis extreme");
    assert.equal(t.direction, v.basisSide);
  }
});

test("runBacktest: the CVD confirm only REMOVES entries (subset of the plain fade)", () => {
  const { candles, flow } = market({ seed: 5 });
  const plain = runBacktest(candles, noFunding, CFG, null, null, null, basisAtForConfig(CFG, flow));
  const cvdCfg = { ...CFG, basisConfirm: "CVD" };
  const stacked = runBacktest(candles, noFunding, cvdCfg, null, null, null, basisAtForConfig(cvdCfg, flow));
  assert.ok(stacked.trades <= plain.trades);
  // Every stacked entry happens on a bar where the plain rule also fired the same side.
  const at = makeBasisAt(flow);
  for (const t of stacked._trades) {
    const i = candles.findIndex((c) => c.t === t.entryT);
    assert.equal(at(((candles[i + 1]?.t) ?? candles[i].t + 3600) * 1000).basisSide, t.direction);
  }
});

test("runBacktest: a stale basis series (gap > 3h) stops entries", () => {
  const { candles, flow } = market();
  // Cut the basis series off at hour 120 → everything after is stale.
  const cut = { ...flow, basisHist: flow.basisHist.filter((r) => r.t < T0 + 120 * H) };
  const r = runBacktest(candles, noFunding, CFG, null, null, null, makeBasisAt(cut));
  for (const t of r._trades) assert.ok(t.entryT * 1000 < T0 + 124 * H, "entered on stale basis");
});

test("basisAtForConfig: only BASIS_FADE gets a lookup", () => {
  const { flow } = market();
  assert.equal(basisAtForConfig({ signalMode: "FUNDING_ONLY" }, flow), null);
  assert.equal(basisAtForConfig(CFG, null), null);
  assert.equal(typeof basisAtForConfig(CFG, flow), "function");
});

test("runBasisSweep: grid runs end-to-end, confirms without series are left out", async () => {
  const { candles, flow } = market({ hours: 500 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/tv/history")) {
      const q = new URL(u).searchParams, from = +q.get("from"), to = +q.get("to");
      const rows = candles.filter((c) => c.t >= from && c.t < to);
      return { json: async () => ({ s: "ok", t: rows.map((c) => c.t), o: rows.map((c) => c.o), h: rows.map((c) => c.h), l: rows.map((c) => c.l), c: rows.map((c) => c.c) }) };
    }
    return { json: async () => ({ data: { rows: [] } }) }; // funding history: none
  };
  try {
    const noSmart = { ...flow, smHist: [] };
    const out = await runBasisSweep({}, { symbols: ["PERP_BTC_USDC"], days: 30 }, { PERP_BTC_USDC: noSmart });
    assert.deepEqual(out.confirmsTested, ["NONE", "CVD"]);
    assert.equal(out.results.length, 2 * 4 * 3); // confirms × exits × holds
    assert.ok(out.results.every((r) => r.config.signalMode === "BASIS_FADE" && r.totalSymbols === 1));
    assert.ok(out.results[0].netUsd >= out.results[out.results.length - 1].netUsd, "ranked by net");
  } finally { globalThis.fetch = realFetch; }
});

test("loadFlowHistForBacktest: per-symbol maturity, the confirm series binds, stale markets named", async () => {
  const days = (n) => Array.from({ length: n * 24 }, (_, i) => ({ t: T0 + i * H, basisPct: 0.01, cvd: 1, buy: 2, sell: 1, side: "LONG", price: 100, oi: 1 }));
  const kv = new Map([
    ["basis:hist:BTC", JSON.stringify(days(30))], ["cvd:hist:BTC", JSON.stringify(days(30))], ["oi:hist:PERP_BTC_USDC", JSON.stringify(days(30))],
    ["basis:hist:ETH", JSON.stringify(days(30))], ["cvd:hist:ETH", JSON.stringify(days(5))], // CVD too thin on ETH
    ["basis:hist:SOL", JSON.stringify(days(3))],  // basis too thin on SOL
  ]);
  const env = { NEXUS_AGENT: { get: async (k) => kv.get(k) ?? null } };
  const plain = await loadFlowHistForBacktest(["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC"], env);
  assert.deepEqual(plain.matureSymbols, ["PERP_BTC_USDC", "PERP_ETH_USDC"]);
  assert.deepEqual(plain.staleSymbols, ["PERP_SOL_USDC"]);
  assert.ok(plain.windowDays >= BASIS_BACKTEST_MIN_DAYS);
  const cvd = await loadFlowHistForBacktest(["PERP_BTC_USDC", "PERP_ETH_USDC"], env, { needCvd: true });
  assert.deepEqual(cvd.matureSymbols, ["PERP_BTC_USDC"], "ETH's thin CVD series must exclude it for a CVD run");
  assert.ok(cvd.flowBySymbol.PERP_BTC_USDC.oiHist.length > 0, "CVD run carries the oi price spine");
});

test("histSeriesInfo: samples + days", () => {
  assert.deepEqual(histSeriesInfo([]), { samples: 0, days: 0, firstT: null });
  assert.equal(histSeriesInfo([{ t: T0 }, { t: T0 + 3 * 86400000 }]).days, 3);
});

test("labels + gate support name the basis stack honestly", () => {
  assert.equal(strategyLabel({ signalMode: "BASIS_FADE" }), "Basis Extreme Fade");
  assert.equal(strategyLabel({ signalMode: "BASIS_FADE", basisConfirm: "CVD" }), "Basis × CVD Stack");
  assert.equal(strategyLabel({ signalMode: "BASIS_FADE", basisConfirm: "SMART" }), "Basis × Smart Stack");
  assert.deepEqual(backtestGateSupport({ signalMode: "BASIS_FADE", basisConfirm: "CVD" }).applied, ["CVD confirm"]);
});
