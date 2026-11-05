import test from "node:test";
import assert from "node:assert/strict";
import { positionCallDraft, openPositionOn, orderCallDraft, restingEntryOrderOn } from "./positionCall.mjs";
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

const lim = { symbol: "PERP_ETH_USDC", side: "BUY", type: "LIMIT", price: 2950.456, quantity: 1, executed: 0, reduce_only: false, created_time: 100 };

test("limit order → call: side from BUY/SELL, entry = the limit price, the permanence note; no size", () => {
  const d = orderCallDraft(lim);
  assert.deepEqual([d.symbol, d.direction, d.entryPrice], ["ETH", "LONG", "2950.456"]);
  assert.match(d.notes, /Published calls are permanent: cancelling the order later won.t cancel the call/);
  assert.deepEqual(Object.keys(d).sort(), ["direction", "entryPrice", "notes", "symbol"]);
  assert.equal(orderCallDraft({ ...lim, side: "SELL", type: "POST_ONLY" }).direction, "SHORT");
});

test("only plain resting entries qualify: reduce-only, market, stop orders and priceless rows give no draft", () => {
  assert.equal(orderCallDraft({ ...lim, reduce_only: true }), null);
  assert.equal(orderCallDraft({ ...lim, type: "MARKET" }), null);
  assert.equal(orderCallDraft({ ...lim, type: "STOP_LIMIT" }), null);
  assert.equal(orderCallDraft({ ...lim, price: null }), null);
  assert.equal(orderCallDraft({ ...lim, side: "?" }), null);
});

test("restingEntryOrderOn: the newest unfilled entry on the viewed market only", () => {
  const rows = [
    { ...lim, order_id: 1, created_time: 100 },
    { ...lim, order_id: 2, created_time: 300 },
    { ...lim, order_id: 3, created_time: 400, reduce_only: true },
    { ...lim, order_id: 4, created_time: 500, symbol: "PERP_BTC_USDC" },
    { ...lim, order_id: 5, created_time: 600, executed: 1 },
    { ...lim, order_id: 6, created_time: 700, algo_order_id: 9 },
  ];
  assert.equal(restingEntryOrderOn(rows, "PERP_ETH_USDC").order_id, 2);
  assert.equal(restingEntryOrderOn(rows, "PERP_SOL_USDC"), null);
  assert.equal(restingEntryOrderOn(null, "PERP_ETH_USDC"), null);
});
