// The CLEARED-read house caller's rules (readHouseCall.mjs, borst 2026-11-27). Run: node --test app/lib/readHouseCall.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readHouseDue, readHouseCall, readHouseCallId, READ_HOUSE_READS, READ_HOUSE_MAX_PER_RUN } from "./readHouseCall.mjs";
import { SOLD_READS } from "./soldRead.mjs";

const H = 3600e3;
const NOW = Date.UTC(2026, 11, 30, 5, 8);
const EV = Date.UTC(2026, 11, 30, 5);
const row = (symbol, side, t = EV) => ({ symbol, side, event_at: side ? new Date(t).toISOString() : null, reason: "x" });

test("wired for btc_lead_lag only, the same read the paid feed may carry", () => {
  assert.deepEqual(Object.keys(READ_HOUSE_READS), ["btc_lead_lag"]);
  for (const r of Object.keys(READ_HOUSE_READS)) assert.ok(SOLD_READS.includes(r));
});

test("due: this hour's events once, one per coin + side per 24h, at most 3 a run", () => {
  const rows = [row("ETH", "LONG"), row("SOL", null), row("XRP", "SHORT", EV - 2 * H), row("DOGE", "LONG", NOW + 60_000)];
  assert.deepEqual(readHouseDue({ axis: "btc_lead_lag", rows, existing: [], now: NOW }), [{ coin: "ETH", side: "LONG", eventT: EV }]);
  const posted = [{ id: readHouseCallId("btc_lead_lag", "ETH", "LONG", EV), symbol: "ETH", direction: "LONG", createdAt: NOW - 60_000 }];
  assert.deepEqual(readHouseDue({ axis: "btc_lead_lag", rows, existing: posted, now: NOW }), []);
  const yesterday = [{ id: "x", symbol: "ETH", direction: "LONG", createdAt: NOW - 23 * H }];
  assert.deepEqual(readHouseDue({ axis: "btc_lead_lag", rows, existing: yesterday, now: NOW }), [], "24h cooldown per coin + side");
  const many = ["ETH", "SOL", "XRP", "DOGE", "BNB"].map((c) => row(c, "LONG"));
  assert.equal(readHouseDue({ axis: "btc_lead_lag", rows: many, existing: [], now: NOW }).length, READ_HOUSE_MAX_PER_RUN);
});

test("the call is the graded contract: mark entry, 1.2× H4 ATR stop, 1.5R target, 168h", () => {
  const c = readHouseCall({ axis: "btc_lead_lag", coin: "ETH", side: "LONG", eventT: EV, markPx: 2500, atrFrac: 0.02, now: NOW });
  assert.equal(c.id, `houseread-btc_lead_lag-ETH-LONG-${EV}`);
  assert.equal(c.entryPrice, 2500); assert.equal(c.stopLoss, 2440); assert.equal(c.takeProfit1, 2590);
  assert.equal(c.timeStopH, 168); assert.equal(c.riskReward, 1.5); assert.equal(c.isPublic, true);
  assert.equal(c.source, "house-read"); assert.equal(c.houseRead, "btc_lead_lag");
  assert.doesNotMatch(c.notes, /proven|guarantee|edge/i);
  const s = readHouseCall({ axis: "btc_lead_lag", coin: "ETH", side: "SHORT", eventT: EV, markPx: 2500, atrFrac: 0.02, now: NOW });
  assert.equal(s.stopLoss, 2560); assert.equal(s.takeProfit1, 2410);
  assert.equal(readHouseCall({ axis: "btc_lead_lag", coin: "ETH", side: "LONG", eventT: EV, markPx: null, atrFrac: 0.02, now: NOW }), null);
  assert.equal(readHouseCall({ axis: "btc_lead_lag", coin: "ETH", side: "LONG", eventT: EV, markPx: 2500, atrFrac: null, now: NOW }), null);
  assert.equal(readHouseCall({ axis: "level_reclaim", coin: "ETH", side: "LONG", eventT: EV, markPx: 2500, atrFrac: 0.02, now: NOW }), null);
});
