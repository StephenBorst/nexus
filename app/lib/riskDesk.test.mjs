// app/lib/riskDesk.mjs. Run: node --test app/lib/riskDesk.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { positionRisk, positionFlags, riskDesk, riskLine, usd, RISK_NOTE } from "./riskDesk.mjs";

const ethLong = { symbol: "PERP_ETH_USDC", position_qty: 2, mark_price: 3000, est_liq_price: 2400, full_tp_sl: { sl_trigger_price: 2850 } };
const solShort = { symbol: "PERP_SOL_USDC", position_qty: -50, mark_price: 200, est_liq_price: 208 };

test("one position: liquidation distance, loss at the stop, funding a day (longs pay a positive rate)", () => {
  const p = positionRisk(ethLong, { fundingRate: 0.0001, fundingPeriodH: 8, equity: 3000 });
  assert.equal(p.side, "LONG");
  assert.equal(p.notional, 6000);
  assert.equal(p.liqDistPct, 20);
  assert.equal(p.lossToLiq, 1200);
  assert.deepEqual(p.stop, { kind: "full", price: 2850, pastLiq: false, lockedIn: false, distPct: 5, loss: 300 });
  assert.equal(p.stopShareOfEquity, 10);
  assert.equal(p.shareOfEquity, 2);
  assert.equal(p.fundingPerDay, -1.8, "0.01% × 3 periods × $6,000, paid by the long");
  const s = positionRisk(solShort, { fundingRate: 0.0001, fundingPeriodH: 1 });
  assert.equal(s.fundingPerDay, 24, "an hourly market earns the short 24 periods a day");
  assert.equal(s.liqDistPct, 4);
  assert.equal(s.stop.kind, "none");
  assert.equal(positionRisk({ ...ethLong, position_qty: 0 }), null);
  assert.equal(positionRisk({ ...ethLong, est_liq_price: 0 }).liqDistPct, null, "no liquidation price is unread, never 0% away");
});

test("a stop past liquidation never fires; a stop above the mark locks in profit", () => {
  const past = positionRisk({ ...ethLong, full_tp_sl: { sl_trigger_price: 2300 } });
  assert.equal(past.stop.pastLiq, true);
  assert.match(positionFlags(past)[0].text, /stop sits past liquidation/);
  assert.equal(positionFlags(past)[0].level, "warn");
  const locked = positionRisk({ ...ethLong, full_tp_sl: { sl_trigger_price: 3050 } });
  assert.equal(locked.stop.lockedIn, true);
  assert.equal(locked.stop.loss, 0);
  assert.match(riskLine(locked), /stop locks in profit/);
  const partial = positionRisk({ ...ethLong, full_tp_sl: undefined, partial_tp_sl: { sl_trigger_price: 2800 } });
  assert.equal(partial.stop.kind, "partial");
});

test("the book: leverage, net, at stops, unstopped, same-side bunching; warnings first", () => {
  const d = riskDesk([solShort, ethLong, { ...solShort, symbol: "PERP_X_USDC", position_qty: 0 }], {
    equity: 4000, funding: { PERP_ETH_USDC: 0.0001 }, periods: { PERP_ETH_USDC: 8 },
  });
  assert.deepEqual(d.positions.map((p) => p.coin), ["SOL", "ETH"], "biggest first; a flat row is left out");
  assert.equal(d.gross, 16000);
  assert.equal(d.net, -4000);
  assert.equal(d.leverage, 4);
  assert.equal(d.atStops, 300);
  assert.equal(d.atStopsPct, 7.5);
  assert.deepEqual(d.unstopped, ["SOL"]);
  assert.equal(d.fundingPerDay, -1.8, "only rates read are summed");
  assert.equal(d.flags[0].level, "warn");
  assert.match(d.flags[0].text, /SOL liquidation is 4\.0%/);
  const past = riskDesk([ethLong, { ...ethLong, symbol: "PERP_BTC_USDC", full_tp_sl: { sl_trigger_price: 2300 } }], { equity: 3000 });
  assert.equal(past.atStops, 300, "a stop past liquidation is not counted as risk capped");
  assert.deepEqual(past.unstopped, ["BTC"]);
  const bunch = riskDesk([ethLong, { ...ethLong, symbol: "PERP_BTC_USDC" }], { equity: 10000 });
  assert.ok(bunch.flags.some((f) => /2 longs, no offset/.test(f.text)));
  const empty = riskDesk([], { equity: 1000 });
  assert.equal(empty.leverage, null);
  assert.equal(empty.fundingPerDay, null);
});

test("words: the Trade line, dollars, and no advice or grade", () => {
  const p = positionRisk(ethLong, { fundingRate: 0.0001, equity: 3000 });
  assert.equal(riskLine(p), "Your long · liquidation 20.0% away · stop loses $300.00 (10.0% of account) · funding pays $1.80/day");
  assert.equal(usd(1234.5), "$1,235");
  assert.equal(usd(-0.42), "−$0.42");
  const all = [riskLine(p), RISK_NOTE, ...riskDesk([ethLong, solShort], { equity: 100 }).flags.map((f) => f.text)].join(" ");
  assert.doesNotMatch(all, /you should|close it|reduce|add to|edge|graded|proven|safe/i);
});

test("wired: the Lab panel and the Trade line read the SDK in the browser only", () => {
  const hook = readFileSync(new URL("../hooks/useRiskDesk.ts", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../pages/lab/RiskDeskPanel.tsx", import.meta.url), "utf8");
  const line = readFileSync(new URL("../components/PositionRiskLine.tsx", import.meta.url), "utf8");
  assert.match(hook, /usePositionStream\(\)/);
  for (const src of [hook, panel, line]) {
    assert.doesNotMatch(src, /fetch\(|sharedJson|og\.nexustradinglabs/, "nothing about the book leaves the device");
  }
  for (const src of [panel, line]) assert.match(src, /useRiskDesk\(\)/);
  assert.match(readFileSync(new URL("../pages/lab/index.tsx", import.meta.url), "utf8"), /<RiskDeskPanel \/>/);
  assert.match(readFileSync(new URL("../pages/perp/Layout.tsx", import.meta.url), "utf8"), /<PositionRiskLine \/>/);
});
