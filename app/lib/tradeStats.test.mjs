// Your own trades, measured (app/lib/tradeStats.mjs): the Stats tab's record + "where the money goes".
// Run: node --test app/lib/tradeStats.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tradeRecord, moneyLeaks, sliceLine, signedUsd, RECORD_MIN_TRADES, SLICE_MIN_TRADES } from "./tradeStats.mjs";

const T0 = Date.parse("2026-11-01T14:00:00Z"); // 14:00 UTC = US hours
const H = 3_600_000;
let seq = 0;
const tr = (symbol, direction, pnl, extra = {}) => {
  seq++;
  return { symbol: `PERP_${symbol}_USDC`, direction, side: direction, pnl, timestamp: T0 + seq * H, openTimestamp: T0 + seq * H - 2 * H, leverage: 3, ...extra };
};

test("nothing closed = no record", () => {
  assert.equal(tradeRecord([]), null);
  assert.equal(tradeRecord(null), null);
  assert.equal(tradeRecord([{ pnl: NaN, timestamp: 1 }]), null);
});

test("the record: net, expectancy, profit factor, payoff, break-even win rate", () => {
  const rows = [tr("BTC", "LONG", 30), tr("BTC", "LONG", -10), tr("ETH", "SHORT", 30), tr("ETH", "SHORT", -10), tr("ETH", "SHORT", 0)];
  const r = tradeRecord(rows);
  assert.equal(r.trades, 5);
  assert.equal(r.wins, 2);
  assert.equal(r.losses, 2);
  assert.equal(r.net, 40);
  assert.equal(r.expectancy, 8);
  assert.equal(r.profitFactor, 3);
  assert.equal(r.avgWin, 30);
  assert.equal(r.avgLoss, 10);
  assert.equal(r.payoff, 3);
  assert.equal(r.breakevenWinRate, 0.25); // 10 / (30 + 10)
  assert.equal(r.winRate, 0.4);
  assert.equal(r.sampled, false);
  assert.equal(r.needMore, RECORD_MIN_TRADES - 5);
});

test("no losing trade = no profit factor, never an infinite one", () => {
  const r = tradeRecord([tr("BTC", "LONG", 5), tr("BTC", "LONG", 7)]);
  assert.equal(r.profitFactor, null);
  assert.equal(r.payoff, null);
  assert.equal(r.breakevenWinRate, null);
});

test("drawdown is the most realized P&L given back from a high-water mark, in time order", () => {
  // Sorted by close time, not array order: +50, −20, −40, +10, +100 → peak 50, trough −10, drop 60.
  const a = tr("BTC", "LONG", 50), b = tr("BTC", "LONG", -20), c = tr("BTC", "LONG", -40), d = tr("BTC", "LONG", 10), e = tr("BTC", "LONG", 100);
  const r = tradeRecord([e, c, a, d, b]);
  assert.equal(r.maxDrawdown, 60);
  assert.equal(r.drawdownFrom, a.timestamp);
  assert.equal(r.drawdownTo, c.timestamp);
  assert.equal(r.currentDrawdown, 0);
  // Losing from the first trade: the drop counts from flat 0, so there is no peak time.
  const down = tradeRecord([tr("BTC", "LONG", -5), tr("BTC", "LONG", -5)]);
  assert.equal(down.maxDrawdown, 10);
  assert.equal(down.drawdownFrom, null);
  assert.equal(down.currentDrawdown, 10);
});

test("one trade carrying the net is named", () => {
  const r = tradeRecord([tr("BTC", "LONG", 90), tr("BTC", "LONG", -20), tr("BTC", "LONG", 30)]);
  assert.equal(r.bestTradeShare, 0.9);
  assert.equal(tradeRecord([tr("BTC", "LONG", -1)]).bestTradeShare, null);
});

test("sampled from RECORD_MIN_TRADES trades", () => {
  const rows = Array.from({ length: RECORD_MIN_TRADES }, (_, i) => tr("BTC", "LONG", i % 2 ? 1 : -1));
  assert.equal(tradeRecord(rows).sampled, true);
  assert.equal(tradeRecord(rows).needMore, 0);
});

test("leaks: the costliest slice, against everything else, with its own label", () => {
  const rows = [
    ...Array.from({ length: 6 }, () => tr("ETH", "SHORT", -20)),
    ...Array.from({ length: 6 }, () => tr("BTC", "LONG", 15)),
    ...Array.from({ length: 2 }, () => tr("SOL", "LONG", -5)),
  ];
  const m = moneyLeaks(rows);
  assert.equal(m.trades, 14);
  assert.equal(m.net, -120 + 90 - 10);
  const top = m.leaks[0];
  // ETH, ETH shorts and Shorts are the same 6 trades: one finding, not three.
  assert.equal(m.leaks.filter((l) => l.net === -120).length, 1);
  assert.equal(top.trades, 6);
  assert.equal(top.net, -120);
  assert.equal(top.wins, 0);
  assert.equal(top.restTrades, 8);
  assert.equal(top.restNet, 80);
  assert.equal(sliceLine(top), "6 trades · 0 won · −$120 net. Everything else: +$80.00 over 8.");
  // SOL has 2 trades: under the floor, never named.
  assert.ok(!m.leaks.some((l) => l.key === "SOL"));
  assert.ok(m.strengths.some((s) => s.net === 90 && s.trades === 6));
});

test("a broad slice and a narrow one inside it are both kept when they are different trades", () => {
  const rows = [
    ...Array.from({ length: 5 }, () => tr("ETH", "SHORT", -30)),
    ...Array.from({ length: 10 }, () => tr("BTC", "SHORT", -2)),
    ...Array.from({ length: 5 }, () => tr("BTC", "LONG", 10)),
  ];
  const m = moneyLeaks(rows);
  const keys = m.leaks.map((l) => `${l.dim}|${l.key}`);
  assert.ok(keys.includes("side|SHORT")); // 15 trades, −170
  assert.ok(keys.some((k) => k === "market|ETH" || k === "marketSide|ETH:SHORT")); // 5 of those 15: a different finding
});

test("the whole record is never a slice; a record where every trade shares a label names nothing for it", () => {
  const rows = Array.from({ length: 8 }, (_, i) => tr("BTC", "LONG", i < 4 ? -10 : 5));
  const m = moneyLeaks(rows);
  assert.ok(!m.leaks.some((l) => l.trades === 8));
  assert.ok(!m.strengths.some((l) => l.trades === 8));
});

test("hold time, leverage and session slices read the trade's own fields; missing fields are skipped", () => {
  const quick = Array.from({ length: 5 }, () => tr("BTC", "LONG", -8, { openTimestamp: 0, leverage: 0 }));
  const slow = Array.from({ length: 5 }, () => tr("ETH", "LONG", 4, { leverage: 20 }));
  const m = moneyLeaks([...quick, ...slow]);
  // The quick ones have no open time and no leverage: no hold or leverage slice can hold them.
  assert.ok(![...m.leaks, ...m.strengths].some((s) => (s.dim === "hold" || s.dim === "leverage") && s.net < 0));

  // Leverage across coins: the 20x trades lose on both coins → the leverage slice is the finding.
  const mix = (lev, pnl) => ["BTC", "BTC", "BTC", "ETH", "ETH", "ETH"].map((c) => tr(c, "LONG", pnl, { leverage: lev }));
  const lev = moneyLeaks([...mix(20, -6), ...mix(2, 1)]);
  assert.equal(lev.leaks[0].label, "10–25x leverage");
  assert.equal(lev.leaks[0].net, -36);
  assert.ok(!lev.strengths.some((x) => x.label === "1–5x leverage")); // its mirror: everything else


  // Sessions are UTC: a trade opened 03:00 UTC is Asia hours on every device.
  const at = (iso, c, pnl) => { const open = Date.parse(iso); return { symbol: `PERP_${c}_USDC`, direction: "LONG", pnl, openTimestamp: open, timestamp: open + H, leverage: 3 }; };
  const asia = ["BTC", "BTC", "BTC", "ETH", "ETH", "ETH"].map((c, i) => at(`2026-11-0${i + 2}T03:00:00Z`, c, -4));
  const us = ["BTC", "BTC", "BTC", "ETH", "ETH", "ETH"].map((c, i) => at(`2026-11-0${i + 2}T14:00:00Z`, c, 1));
  const ses = moneyLeaks([...asia, ...us]);
  assert.equal(ses.leaks[0].key, "ASIA");
  assert.equal(ses.leaks[0].label, "Opened in Asia hours (00–08 UTC)");
  assert.ok(!ses.strengths.some((x) => x.key === "US")); // its mirror: everything else
});

test("a strength that is only a leak's mirror (everything else) is not named twice", () => {
  // Every ETH trade is a short and every other trade a long: "Longs win" is just "ETH shorts lose" turned over.
  const rows = [
    ...Array.from({ length: 6 }, () => tr("ETH", "SHORT", -20)),
    ...Array.from({ length: 6 }, (_, i) => tr("BTC", "LONG", i % 2 ? 20 : -2)),
    ...Array.from({ length: 6 }, (_, i) => tr("SOL", "LONG", i % 2 ? 6 : -1)),
  ];
  const m = moneyLeaks(rows);
  assert.equal(m.leaks[0].trades, 6);
  assert.ok(!m.strengths.some((s) => s.key === "LONG"), "Longs = everything but the leak");
  assert.equal(m.strengths[0].key, "BTC"); // a real finding inside the rest stays
});

test("money copy: a real minus sign, cents under $100", () => {
  assert.equal(signedUsd(-142.4), "−$142");
  assert.equal(signedUsd(12.5), "+$12.50");
  assert.equal(signedUsd(0), "$0.00");
  assert.equal(signedUsd(1234.6), "+$1,235");
  assert.equal(signedUsd(null), "—");
  assert.equal(SLICE_MIN_TRADES, 5);
});

test("the self-scored Trading Score is gone from the Stats tab", () => {
  const src = readFileSync(new URL("../pages/lab/AnalyticsView.tsx", import.meta.url), "utf8");
  assert.ok(!/TradingScore|COMPOSITE SCORE|RadarChart/.test(src));
});

test("Plan Adherence (calls vs trades) shows on the Stats tab itself, once, not inside the deep fold", () => {
  const src = readFileSync(new URL("../pages/lab/AnalyticsView.tsx", import.meta.url), "utf8");
  const card = src.indexOf("<PlanAdherenceCard");
  assert.ok(card > 0 && card < src.indexOf('title="Deeper breakdowns"'));
  const proc = readFileSync(new URL("../pages/lab/ProcessView.tsx", import.meta.url), "utf8");
  const section = proc.slice(proc.indexOf("export function ProcessSection"));
  assert.ok(!section.includes("<PlanAdherenceCard"), "not rendered twice");
});
