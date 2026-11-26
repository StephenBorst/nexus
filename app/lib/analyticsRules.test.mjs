// Analytics tab rules (analyticsRules.mjs). Run: node --test app/lib/analyticsRules.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chronological, signed, compactUsd, perfRows, peakHours, weekSplit, wonWords } from "./analyticsRules.mjs";

const H = 3600_000;
const T0 = Date.UTC(2026, 10, 23, 0); // a Monday
const tr = (pnl, t, extra = {}) => ({ symbol: "PERP_ETH_USDC", direction: "LONG", pnl, timestamp: t, qty: 1, price: 100, ...extra });

test("the equity curve reads oldest → newest whatever order the rows arrive in", () => {
  const rows = [tr(3, T0 + 2 * H), tr(1, T0), tr(2, T0 + H)];
  assert.deepEqual(chronological(rows).map((o) => o.pnl), [1, 2, 3]);
  assert.deepEqual(chronological([]), []);
});

test("every dollar figure keeps its sign; a loss is never printed as $13.70", () => {
  assert.equal(signed(12.4), "+$12.40");
  assert.equal(signed(-13.7), "−$13.70");
  assert.equal(signed(0), "$0.00");
  assert.equal(signed(1234.5), "+$1,234.50");
  const p = perfRows([tr(10, T0), tr(20, T0), tr(-13.7, T0), tr(-6.3, T0)]);
  const by = Object.fromEntries(p.map((r) => [r.label, r]));
  assert.equal(by["AVG WIN"].value, "+$15.00");
  assert.equal(by["AVG LOSS"].value, "−$10.00");
  assert.equal(by["BEST TRADE"].value, "+$20.00");
  assert.equal(by["WORST TRADE"].value, "−$13.70");
  assert.equal(by["VOLUME"].value, "$400");
  const noLoss = Object.fromEntries(perfRows([tr(5, T0)]).map((r) => [r.label, r]));
  assert.equal(noLoss["AVG LOSS"].value, "—", "no losing trade = no average loss, never $0.00");
  assert.equal(noLoss["WORST TRADE"].value, "—", "the worst trade isn't a win");
  assert.equal(compactUsd(42_464), "$42.5k");
  assert.equal(compactUsd(0), "—");
});

test("peak hours: only hours with enough trades, best net dollars first; one lucky trade is not a peak", () => {
  const hourOf = (t) => new Date(t).getUTCHours();
  const rows = [tr(50, T0 + 3 * H)]; // one big win at 03:00
  for (let i = 0; i < 5; i++) rows.push(tr(4, T0 + 14 * H + i * 24 * H));  // 5 at 14:00, +20
  for (let i = 0; i < 6; i++) rows.push(tr(i < 5 ? 1 : 2, T0 + 9 * H + i * 24 * H)); // 6 at 09:00, +7, all won
  for (let i = 0; i < 5; i++) rows.push(tr(-3, T0 + 20 * H + i * 24 * H)); // 5 at 20:00, −15
  const p = peakHours(rows, { hourOf });
  assert.deepEqual(p.peak.map((b) => b.h), [14, 9], "03:00 has one trade; 20:00 lost money");
  assert.equal(p.thin, false);
  assert.equal(peakHours([tr(5, T0)], { hourOf }).thin, true);
  assert.equal(p.hours.length, 24);
});

test("weekdays vs weekends: no weekend trades = no weekend win rate, never 0%", () => {
  const dayOf = (t) => new Date(t).getUTCDay();
  const s = weekSplit([tr(5, T0), tr(-2, T0 + 24 * H)], { dayOf });
  assert.deepEqual(s.weekday, { trades: 2, wins: 1, pnl: 3, winRate: 50 });
  assert.equal(s.weekend.winRate, null);
  const sat = weekSplit([tr(-1, T0 + 5 * 24 * H)], { dayOf });
  assert.equal(sat.weekend.winRate, 0);
  assert.equal(wonWords(0, 0), "—");
  assert.equal(wonWords(5, 8), "63% won · 8 trades");
  assert.equal(wonWords(1, 1), "100% won · 1 trade");
});

test("the Analytics screen uses these rules: chronological rows, signed money, no Sharpe, win rates in ink", () => {
  const src = readFileSync(new URL("../pages/lab/AnalyticsView.tsx", import.meta.url), "utf8");
  for (const fn of ["chronological(", "perfRows(", "peakHours(", "weekSplit(", "coverageLine("]) assert.ok(src.includes(fn), fn);
  assert.doesNotMatch(src, /SHARPE|SORTINO/, "no Sharpe on uneven dollar trades");
  assert.doesNotMatch(src, /parseFloat\(weekday\.weekendWR\) > 0 \? "#3ecf8e"/, "a win rate is not money");
  assert.doesNotMatch(src, /wr > 50 \? "#3ecf8e" : "#f7525f"/);
  assert.doesNotMatch(src, /\$\{avgLoss\.toFixed\(2\)\}/, "the average loss lost its sign");
  assert.doesNotMatch(src, /function PerformanceAnalysis/, "best/worst and long/short already show above");
});
