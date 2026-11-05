import test from "node:test";
import assert from "node:assert/strict";
import { positionCallDraft, openPositionOn } from "./positionCall.mjs";
import { callInvalidReason } from "./callMath.mjs";

const long = { symbol: "PERP_BTC_USDC", position_qty: 0.02, average_open_price: 90000, mark_price: 101234.56, full_tp_sl: { tp_trigger_price: 110000, sl_trigger_price: 97000 } };

test("long with TP/SL: side, entry at the MARK (not the fill), both levels kept; the draft grades", () => {
  const d = positionCallDraft(long);
  assert.equal(d.symbol, "BTC");
  assert.equal(d.direction, "LONG");
  assert.equal(d.entryPrice, "101234.6");
  assert.equal(d.stopLoss, "97000");
  assert.equal(d.takeProfit1, "110000");
  const call = { direction: d.direction, entryPrice: +d.entryPrice, stopLoss: +d.stopLoss, takeProfit1: +d.takeProfit1 };
  assert.equal(callInvalidReason(call), null);
});

test("short, suffixed symbol, small price: bare ticker and 6 decimals", () => {
  const d = positionCallDraft({ symbol: "PERP_XLM_USDC_mythos", position_qty: -500, mark_price: 0.2876543, full_tp_sl: { tp_trigger_price: 0.25, sl_trigger_price: 0.31 } });
  assert.deepEqual([d.symbol, d.direction, d.entryPrice, d.takeProfit1, d.stopLoss], ["XLM", "SHORT", "0.287654", "0.25", "0.31"]);
});

test("levels on the wrong side of the market are dropped (a trailed stop above a long's mark), and the note says so", () => {
  const d = positionCallDraft({ ...long, full_tp_sl: { tp_trigger_price: 110000, sl_trigger_price: 102000 } });
  assert.equal(d.stopLoss, undefined);
  assert.equal(d.takeProfit1, "110000");
  assert.match(d.notes, /stop sat on the wrong side/);
});

test("no TP/SL: side + entry only; the trader sets the levels", () => {
  const d = positionCallDraft({ symbol: "PERP_ETH_USDC", position_qty: 1, mark_price: 3000 });
  assert.deepEqual(Object.keys(d).sort(), ["direction", "entryPrice", "notes", "symbol"]);
  assert.match(d.notes, /Set your stop and target/);
});

test("nothing about size or P&L goes into the draft; flat or unpriced positions give no draft", () => {
  const d = positionCallDraft({ ...long, unrealized_pnl: 5555.5, notional: 7777.7, leverage: 10 });
  assert.deepEqual(Object.keys(d).sort(), ["direction", "entryPrice", "notes", "stopLoss", "symbol", "takeProfit1"]);
  assert.equal(/0\.02|5555|7777|90000|leverage/.test(JSON.stringify(d)), false);
  assert.equal(positionCallDraft({ ...long, position_qty: 0 }), null);
  assert.equal(positionCallDraft({ ...long, mark_price: 0 }), null);
  assert.equal(positionCallDraft(null), null);
});

test("openPositionOn finds the live row for the viewed market only", () => {
  const rows = [{ symbol: "PERP_ETH_USDC", position_qty: 0 }, long, { symbol: "PERP_SOL_USDC", position_qty: -3 }];
  assert.equal(openPositionOn(rows, "PERP_BTC_USDC"), long);
  assert.equal(openPositionOn(rows, "PERP_ETH_USDC"), null);
  assert.equal(openPositionOn(undefined, "PERP_BTC_USDC"), null);
});
