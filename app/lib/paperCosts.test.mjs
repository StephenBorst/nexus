import { test } from "node:test";
import assert from "node:assert/strict";
import { paperCostReread, paperFeeRate, ASSUMED_TAKER_BPS } from "./paperCosts.mjs";

const H = 3600000;
const T0 = Date.UTC(2026, 9, 20, 0, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
const row = (o = {}) => ({
  symbol: "PERP_BTC_USDC", direction: "LONG", entry_price: 100, exit_price: 102, qty: 5, pnl: 10,
  opened_at: iso(T0), closed_at: iso(T0 + 8 * H), ...o,
});
// A flat 0.0001 per-8h rate for every hour around the trade.
const flat = (rate = 0.0001, from = T0 - 10 * H, hours = 40) =>
  Array.from({ length: hours }, (_, i) => ({ t: from + i * H, funding: rate }));

test("fees: entry + exit notional at the rate per side", () => {
  const r = paperCostReread([row()], { feeBps: 3, oiHistBySymbol: { PERP_BTC_USDC: flat(0) } });
  // entry 500 + exit 510 = 1010 × 3 bps = 0.303
  assert.equal(r.feesUsd, 0.3);
  assert.equal(r.grossUsd, 10);
  assert.equal(r.fundingUsd, 0);
  assert.equal(r.netUsd, 9.7);
});

test("funding: a long held 8h at 0.01%/8h pays 1 bp of entry notional", () => {
  const r = paperCostReread([row()], { feeBps: 0, oiHistBySymbol: { PERP_BTC_USDC: flat(0.0001) } });
  assert.equal(r.fundingUsd, 0.05); // 500 × 1 bp
  assert.equal(r.netUsd, 9.95);
  assert.equal(r.fundingMissing, 0);
});

test("funding: a short collects the same rate", () => {
  const r = paperCostReread([row({ direction: "SHORT", pnl: -10 })], { feeBps: 0, oiHistBySymbol: { PERP_BTC_USDC: flat(0.0001) } });
  assert.equal(r.fundingUsd, -0.05);
  assert.equal(r.netUsd, -9.95);
});

test("no recorded funding = missing, never free", () => {
  const r = paperCostReread([row(), row({ symbol: "PERP_ETH_USDC" })], { feeBps: 0, oiHistBySymbol: { PERP_BTC_USDC: flat(0.0001) } });
  assert.equal(r.trades, 2);
  assert.equal(r.fundingMissing, 1);
  assert.equal(r.fundingUsd, 0.05);
});

test("a gap in the rates longer than the carry = missing", () => {
  const gappy = flat(0.0001, T0 - 10 * H, 11); // stops at T0, trade runs to T0+20h
  const r = paperCostReread([row({ closed_at: iso(T0 + 20 * H) })], { feeBps: 0, oiHistBySymbol: { PERP_BTC_USDC: gappy } });
  assert.equal(r.fundingMissing, 1);
  assert.equal(r.fundingUsd, 0);
});

test("unreadable rows are skipped, not counted as zero", () => {
  const r = paperCostReread([row(), row({ qty: null }), row({ pnl: "x" })], { feeBps: 3 });
  assert.equal(r.trades, 1);
  assert.equal(r.skipped, 2);
});

test("a sub-hour trade still pays one hour of funding", () => {
  const r = paperCostReread([row({ closed_at: iso(T0 + 20 * 60000) })], { feeBps: 0, oiHistBySymbol: { PERP_BTC_USDC: flat(0.0008) } });
  assert.equal(r.fundingUsd, 0.05); // 0.0008/8 per hour × 1h = 1 bp of 500
});

test("fee rate: a set value is the account's, anything else is the assumed default", () => {
  assert.deepEqual(paperFeeRate("4.5"), { feeBps: 4.5, feeSource: "account" });
  assert.deepEqual(paperFeeRate("0"), { feeBps: 0, feeSource: "account" });
  for (const bad of [undefined, "", "abc", "-1", "500"]) assert.deepEqual(paperFeeRate(bad), { feeBps: ASSUMED_TAKER_BPS, feeSource: "assumed" });
});

test("empty ledger", () => {
  assert.deepEqual(paperCostReread([], { feeBps: 3 }), { trades: 0, skipped: 0, feeBps: 3, grossUsd: 0, feesUsd: 0, fundingUsd: 0, fundingMissing: 0, netUsd: 0 });
});
