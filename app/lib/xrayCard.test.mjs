import { test } from "node:test";
import assert from "node:assert/strict";
import { xrayCard, cardVersion, utcStamp, shortAddr } from "./xrayCard.mjs";
import { fillsToClosedTrades } from "./xrayGrade.mjs";

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 25, 14, 0);
const W = "0xDa744273F80b22412417F7cfE0503f3d721F987d";
const tr = (daysAgo, pnl) => ({ timestamp: NOW - daysAgo * DAY, pnl });
const many = (n, daysAgo, pnl) => Array.from({ length: n }, () => tr(daysAgo, pnl));

test("graded 30D card shows its parts, lifetime as context, dated", () => {
  const trades = [...many(40, 60, 50), ...many(14, 5, 30), ...many(8, 5, -15)];
  const c = xrayCard({ address: W, trades, now: NOW });
  assert.equal(c.kind, "HL");
  assert.equal(c.status, "GRADED");
  assert.deepEqual(c.stats.map((s) => s.label), ["NET", "TRADES", "WIN RATE", "PROFIT FACTOR"]);
  assert.deepEqual(c.stats.map((s) => s.value), ["+$300.00", "22", "64%", "3.50"]);
  assert.equal(c.headline, "30D · +$300.00 net");
  assert.equal(c.context, "lifetime +$2300.00 · 62 trades");
  assert.equal(c.title, "0xDa74…987d · 30D PF 3.50 · 64% win · 22 trades — Wallet X-Ray");
  assert.equal(c.stamp, "Sep 25 · 14:00 UTC");
  assert.match(c.description, /Sep 25 · 14:00 UTC/);
  assert.equal(c.partialNote, null);
  assert.equal(c.address, W.toLowerCase());
});

test("below 30D's minimum the card says ACCRUING — no win rate, no PF", () => {
  const c = xrayCard({ address: W, trades: [...many(40, 60, 50), ...many(3, 2, 500)], now: NOW });
  assert.equal(c.status, "ACCRUING");
  assert.equal(c.headline, "30D · ACCRUING");
  const labels = c.stats.map((s) => s.label);
  assert.ok(!labels.includes("WIN RATE") && !labels.includes("PROFIT FACTOR"));
  assert.match(c.title, /30D accruing \(3\/20 trades\)/);
});

test("partial tape inside 30D is disclosed on the card", () => {
  const trades = many(25, 3, 10);
  const c = xrayCard({ address: W, trades, completeFrom: NOW - 10 * DAY, now: NOW });
  assert.equal(c.partialNote, "partial tape — complete from Sep 15");
  assert.match(c.context, /since Sep 15$/);
  const full = xrayCard({ address: W, trades, completeFrom: NOW - 90 * DAY, now: NOW });
  assert.equal(full.partialNote, null, "tape reaching back past 30D ⇒ 30D is complete");
});

test("Orderly-only wallet shows its watched record", () => {
  const track = { building: false, netRealized: 4200, gradedWindows: 26, daysTracked: 27.4, winWindowRate: 62, maxDrawdown: 800 };
  const c = xrayCard({ address: W, trades: [], track, now: NOW });
  assert.equal(c.kind, "WATCHED");
  assert.equal(c.status, "GRADED");
  assert.equal(c.headline, "WATCHED 27D · +$4200.00 net");
  assert.deepEqual(c.stats.map((s) => s.value), ["+$4200.00", "26", "62%", "-$800.00"]);
  const young = xrayCard({ address: W, trades: [], track: { ...track, gradedWindows: 6, daysTracked: 6 }, now: NOW });
  assert.equal(young.status, "ACCRUING");
  assert.equal(young.stats[1].value, "6/20");
});

test("Hyperliquid tape wins over the watched record when both exist", () => {
  const c = xrayCard({ address: W, trades: many(25, 3, 10), track: { building: false, netRealized: 1, gradedWindows: 30 }, now: NOW });
  assert.equal(c.kind, "HL");
});

test("nothing to grade → honest empty card", () => {
  const c = xrayCard({ address: W, now: NOW });
  assert.equal(c.kind, "NONE");
  assert.equal(c.stats.length, 0);
  assert.equal(c.title, "0xDa74…987d — Wallet X-Ray");
  assert.equal(xrayCard({ address: W, track: { building: true, points: 1 }, now: NOW }).kind, "NONE");
});

test("card grades the SAME trades the page does (fillsToClosedTrades)", () => {
  const fills = [
    { coin: "BTC", px: "1", sz: "1", side: "B", time: NOW - DAY, dir: "Open Long", closedPnl: "0", fee: "0.1" },
    { coin: "BTC", px: "1", sz: "1", side: "A", time: NOW - DAY / 2, dir: "Close Long", closedPnl: "10", fee: "0.5" },
    { coin: "ETH", px: "1", sz: "1", side: "B", time: NOW - DAY / 4, dir: "Close Short", closedPnl: "-4", fee: "0.5" },
  ];
  const t = fillsToClosedTrades(fills);
  assert.deepEqual(t.map((x) => [x.symbol, x.direction, x.pnl]), [["BTC", "LONG", 9.5], ["ETH", "SHORT", -4.5]]);
});

test("version key changes when the tape or watched record grows", () => {
  const a = cardVersion({ newestFillTs: 100, fillCount: 10, trackPoints: 3 });
  assert.notEqual(a, cardVersion({ newestFillTs: 101, fillCount: 11, trackPoints: 3 }));
  assert.notEqual(a, cardVersion({ newestFillTs: 100, fillCount: 10, trackPoints: 4 }));
  assert.equal(cardVersion({}), "0-0-0");
});

test("helpers", () => {
  assert.equal(shortAddr(W), "0xDa74…987d");
  assert.equal(utcStamp(Date.UTC(2025, 0, 3, 9, 5), NOW), "Jan 3 2025 · 09:05 UTC");
});
