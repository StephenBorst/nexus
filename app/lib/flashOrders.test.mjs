// Flash order rows → panel lines. Rows are shaped from Flash's OpenAPI schema (GET /v1/orders).
import test from "node:test";
import assert from "node:assert/strict";
import { describeFlashOrder, sortFlashOrders, fmtAmount } from "./flashOrders.mjs";

const WETH = { address: "0x4200000000000000000000000000000000000006", ticker: "WETH", chain: { id: "base", name: "base" } };
const USDC = { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", ticker: "USDC", chain: { id: "base", name: "base" } };
const row = (o = {}) => ({
  orderId: "5d0aaee6-1111-4222-8333-944445555666", orderType: "limit", side: "buy", status: "ORDER_STATUS_ACCEPTED",
  targetAsset: WETH, contraAsset: USDC, qty: "20", filled: { targetAmount: "0", contraAmount: "0" },
  limitNotionalPrice: "1000", placedAt: "2026-09-27T06:00:00Z", expiresAt: "2026-10-04T00:00:00Z", ...o,
});

test("a resting limit buy reads as what it is", () => {
  const NOW = Date.parse("2026-09-27T06:30:00Z");
  const d = describeFlashOrder(row(), NOW);
  assert.equal(d.title, "LIMIT BUY WETH");
  assert.equal(d.size, "20 USDC → WETH");
  assert.equal(d.detail, "at or below $1,000");
  assert.equal(d.status, "Working");
  assert.equal(d.open, true);
  assert.equal(d.cancellable, true);
  assert.equal(d.expires, "expires Oct 4");
  assert.equal(describeFlashOrder(row({ expiresAt: null }), NOW).expires, "until cancelled");
  // inside a day it's a clock time (local), and a TWAP "ends" rather than "expires"
  assert.match(describeFlashOrder(row({ orderType: "twap", expiresAt: "2026-09-27T07:31:00Z" }), NOW).expires, /^ends \d{2}:\d{2}$/);
});

test("sells, stops, TWAP progress and pairs", () => {
  const sl = describeFlashOrder(row({ orderType: "stop-loss", side: "sell", qty: "0.005", limitNotionalPrice: null, trigger: { notionalPrice: "2000", triggerType: "lower" } }));
  assert.equal(sl.title, "STOP-LOSS SELL WETH");
  assert.equal(sl.size, "0.005 WETH → USDC");
  assert.equal(sl.detail, "if price falls to $2,000");
  const tw = describeFlashOrder(row({ orderType: "twap", limitNotionalPrice: null, twapBucketCount: 12, status: "ORDER_STATUS_PARTIALLY_FILLED", filled: { contraAmount: "5" }, expiresAt: null }));
  assert.equal(tw.detail, "12 slices · 5 of 20 USDC filled");
  assert.equal(tw.status, "Partly filled");
  assert.equal(tw.expires, "");
  const pair = describeFlashOrder(row({ orderType: "bracket", side: "sell", qty: "0.0077", limitNotionalPrice: null, brackets: [{ notionalPrice: "5000", triggerType: "upper" }, { notionalPrice: "2000", triggerType: "lower" }] }));
  assert.equal(pair.title, "SL/TP SELL WETH");
  assert.equal(pair.size, "0.0077 WETH → USDC");
  assert.equal(pair.detail, "TP $5,000 · SL $2,000");
  const entry = describeFlashOrder(row({ orderType: "market", limitNotionalPrice: null, attachedBracket: { status: "pending_activation" } }));
  assert.equal(entry.detail, "SL/TP arms on first fill");
  assert.equal(entry.expires, "");
});

test("closed orders say why, in words; unknown codes fall back to Flash's", () => {
  const c = describeFlashOrder(row({ status: "ORDER_STATUS_CANCELLED", closeReason: "REASON_INSUFFICIENT_ASSET_BALANCE" }));
  assert.equal(c.open, false);
  assert.equal(c.cancellable, false);
  assert.equal(c.reason, "the wallet balance was too low when it tried to fill");
  assert.equal(c.expires, "");
  assert.equal(describeFlashOrder(row({ status: "ORDER_STATUS_REJECTED", closeReason: "REASON_SOMETHING_NEW" })).reason, "something new");
  assert.equal(describeFlashOrder(row({ status: "ORDER_STATUS_FILLED", closeReason: "REASON_FULLY_FILLED" })).reason, "");
  assert.equal(describeFlashOrder(row({ status: "WHATEVER" })).status, "—");
  assert.doesNotThrow(() => describeFlashOrder({}));
  // a finished order doesn't repeat its fill as progress
  assert.equal(describeFlashOrder(row({ orderType: "market", limitNotionalPrice: null, status: "ORDER_STATUS_FILLED", filled: { contraAmount: "20" } })).detail, "");
});

test("open first (newest placed), then closed (newest closed)", () => {
  const list = [
    row({ orderId: "a", status: "ORDER_STATUS_FILLED", closedAt: "2026-09-27T05:00:00Z" }),
    row({ orderId: "b", placedAt: "2026-09-27T04:00:00Z" }),
    row({ orderId: "c", status: "ORDER_STATUS_CANCELLED", closedAt: "2026-09-27T06:30:00Z" }),
    row({ orderId: "d", placedAt: "2026-09-27T06:10:00Z", status: "ORDER_STATUS_PENDING" }),
  ];
  assert.deepEqual(sortFlashOrders(list).map((o) => o.orderId), ["d", "b", "c", "a"]);
  assert.deepEqual(sortFlashOrders(null), []);
});

test("amounts print short and never as floats gone wrong", () => {
  assert.equal(fmtAmount("0.0077550489485031"), "0.007755");
  assert.equal(fmtAmount("20"), "20");
  assert.equal(fmtAmount("12345.678"), "12,346");
  assert.equal(fmtAmount("0.000001234"), "0.000001234");
  assert.equal(fmtAmount("x"), "—");
});
