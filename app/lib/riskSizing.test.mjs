// Fixed-risk sizing (build #1 of docs/research/live-plan-level-reclaim.md). One rule for exec, the replays
// and lab-api. Run: node --test app/lib/riskSizing.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { usesRiskSizing, riskSizingRefusal, riskSizedMargin, tradeNotional, riskTaken, RISK_PER_TRADE_MAX_USD } from "./riskSizing.mjs";
import { aggregate, randomEntryBaseline } from "../../workers/nexus-lab-api/backtest.mjs";

const GRADED = { exitContract: "R_CONTRACT", maxHoldHours: 168, mode: "PAPER", leverage: 3, capitalPerTrade: 300 };

test("the live plan's numbers: $10 at the median 2.21% stop ≈ $452 notional; BTC 1.14% ≈ $877; WLD 6.6% ≈ $152", () => {
  const at = (sl) => riskSizedMargin({ riskPerTradeUsd: 10, slPercent: sl, leverage: 3, maxMargin: 300 });
  assert.deepEqual(at(2.21), { margin: 150.83, notional: 452.49, capped: false });
  assert.equal(at(1.14).notional, 877.19);
  assert.equal(at(6.6).notional, 151.52);
  // every stop-out loses the same dollars, whatever the coin
  for (const sl of [1.14, 2.21, 3.91, 6.6]) assert.ok(Math.abs(at(sl).notional * (sl / 100) - 10) < 0.01, `sl ${sl}`);
});

test("capitalPerTrade is the margin ceiling: a very tight stop is capped and says so", () => {
  const s = riskSizedMargin({ riskPerTradeUsd: 10, slPercent: 0.5, leverage: 3, maxMargin: 300 });
  assert.deepEqual(s, { margin: 300, notional: 900, capped: true });
});

test("no stop, no leverage or no risk = no size (the caller sits the trade out)", () => {
  assert.equal(riskSizedMargin({ riskPerTradeUsd: 10, slPercent: null, leverage: 3 }), null);
  assert.equal(riskSizedMargin({ riskPerTradeUsd: 10, slPercent: 2, leverage: 0 }), null);
  assert.equal(riskSizedMargin({ riskPerTradeUsd: 0, slPercent: 2, leverage: 3 }), null);
});

test("refusals: paper only, graded exit only, one sizing rule, a sane number", () => {
  assert.equal(riskSizingRefusal({}, false), null, "not asked = nothing to refuse, any mode");
  assert.equal(riskSizingRefusal({ riskPerTradeUsd: 0 }, false), null);
  assert.equal(riskSizingRefusal({ ...GRADED, riskPerTradeUsd: 10 }, true), null);
  assert.match(riskSizingRefusal({ ...GRADED, riskPerTradeUsd: 10, mode: "AUTONOMOUS" }, false), /paper-only/);
  assert.match(riskSizingRefusal({ riskPerTradeUsd: 10, mode: "PAPER" }, true), /graded exit/);
  assert.match(riskSizingRefusal({ ...GRADED, riskPerTradeUsd: 10, volTargetPct: 2 }, true), /two different ways/);
  assert.match(riskSizingRefusal({ ...GRADED, riskPerTradeUsd: 10, dcaEnabled: true }, true), /DCA/);
  assert.match(riskSizingRefusal({ ...GRADED, riskPerTradeUsd: -5 }, true), /positive/);
  assert.match(riskSizingRefusal({ ...GRADED, riskPerTradeUsd: "ten" }, true), /positive/);
  assert.match(riskSizingRefusal({ ...GRADED, riskPerTradeUsd: RISK_PER_TRADE_MAX_USD + 1 }, true), /capped/);
  assert.equal(usesRiskSizing({ riskPerTradeUsd: "10" }), true);
  assert.equal(usesRiskSizing({ riskPerTradeUsd: undefined }), false);
});

test("tradeNotional: risk-sized when asked and allowed, else the flat capital × leverage (replay defaults kept)", () => {
  assert.equal(tradeNotional({ ...GRADED, riskPerTradeUsd: 10 }, 2), 500);
  assert.equal(tradeNotional({ ...GRADED }, 2), 900);
  assert.equal(tradeNotional({}, 2), 50, "the replays' default 50 × 1");
  // a refused config books the flat size, the way exec would never have opened the risk-sized one
  assert.equal(tradeNotional({ ...GRADED, riskPerTradeUsd: 10, dcaEnabled: true }, 2), 900);
});

test("riskTaken: the dollars a filled position risks to its stop", () => {
  assert.equal(riskTaken(0.005, 90000, 1.14), 5.13);
  assert.equal(riskTaken(0, 100, 2), null);
});

test("replays book each trade at its own notional: a stop-out at any stop width costs the same dollars", () => {
  const cfg = { ...GRADED, riskPerTradeUsd: 10 };
  const trades = [2, 6].map((sl) => ({ pnlPct: -sl, notional: tradeNotional(cfg, sl) }));
  assert.equal(aggregate(trades, cfg).netUsd, -20);
  // unsized trades (no notional on the row) keep the flat size, as before
  assert.equal(aggregate([{ pnlPct: -2 }], cfg).netUsd, -18);
});

test("the random-entry baseline sizes its random trades the same way as the real ones", () => {
  // A flat tape with a known ATR: every random entry gets the same graded stop, so the random replays and the
  // real trade are sized alike. Real trade = a stop-out at that stop, worth exactly -$10 under fixed risk.
  const candles = [];
  for (let i = 0; i < 400; i++) {
    const c = 100 + Math.sin(i / 3) * 0.8;
    candles.push({ t: 1_700_000_000 + i * 3600, o: c, h: c + 0.6, l: c - 0.6, c });
  }
  const cfg = { ...GRADED, riskPerTradeUsd: 10, feeBps: 0 };
  const real = Array.from({ length: 6 }, () => ({ symbol: "X", direction: "LONG", pnlPct: -2, notional: tradeNotional(cfg, 2) }));
  const b = randomEntryBaseline([{ symbol: "X", candles }], cfg, real, { runs: 20 });
  assert.equal(b.realNetUsd, -60);
  // Random trades are sized from their own graded stop: on a gap-free tape no run of six can lose more than six
  // stops (-$60) or win more than six targets (+$90). The same entries at the flat $900 lose more.
  assert.ok(b.randomP5Usd >= -60 - 1e-9 && b.randomP95Usd <= 90 + 1e-9, JSON.stringify(b));
  const flatCfg = { ...cfg, riskPerTradeUsd: undefined };
  const flat = randomEntryBaseline([{ symbol: "X", candles }], flatCfg, real.map((t) => ({ ...t, notional: undefined })), { runs: 20 });
  assert.ok(flat.randomP5Usd < b.randomP5Usd, `flat ${flat.randomP5Usd} vs risk ${b.randomP5Usd}`);
});

test("exec: refuses before any read, reads the graded stop before sizing, sizes from it, records the risk", () => {
  const src = readFileSync(new URL("../../workers/nexus-agent-exec/index.js", import.meta.url), "utf8");
  const start = src.indexOf("async function enterPosition(");
  const body = src.slice(start, src.indexOf("\nasync function ", start + 10));
  const at = (needle) => { const i = body.indexOf(needle); assert.ok(i > 0, `missing: ${needle}`); return i; };
  assert.ok(at("riskSizingRefusal(config, paper, { liveLift })") < at("await getMarkPrice("), "refused before any price read");
  assert.ok(at("gradedLv = await fetchGradedExitLevels(") < at("riskSizedMargin("), "the stop is known before sizing");
  assert.ok(at("riskSizedMargin(") < at("const snap = snapQty("), "the risk-sized margin feeds the qty");
  assert.match(body, /capitalPerTrade: sizeMargin, leverage: effLeverage/);
  assert.match(body, /maxMargin: config\.capitalPerTrade/);
  assert.match(body, /risk_usd: riskTaken\(qty, entryFill\.price, effSl\)/);
  assert.ok(at("const riskSized = !directive && usesRiskSizing(config)") > 0, "a directive keeps its own size");
  // the live Supabase row's columns are unchanged: risk_usd rides on paper rows only
  assert.match(src, /state\.paper_trades\.unshift\(\{ id: `paper_\$\{Date\.now\(\)\}`, \.\.\.auditable, \.\.\.\(pos\.risk_usd > 0/);
});

test("lab-api refuses a bad risk-sizing config on every path that stores one, next to the graded-exit check", () => {
  const src = readFileSync(new URL("../../workers/nexus-lab-api/index.js", import.meta.url), "utf8");
  const graded = src.split('error: "graded_exit_refused"').length - 1;
  const risk = src.split('error: "risk_sizing_refused"').length - 1;
  assert.ok(graded >= 4);
  assert.equal(risk, graded);
});
