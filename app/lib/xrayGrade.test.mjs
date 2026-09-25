import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tradesInWindow, windowComplete, gradeWindow, gradeAllWindows, defaultWindow, decayRow,
  edgeGate, watchedWindow, liqDistancePct, fmtPf, hlCoinToOrderly,
} from "./xrayGrade.mjs";

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 25, 12);
const tr = (daysAgo, pnl) => ({ timestamp: NOW - daysAgo * DAY, pnl });
const many = (n, daysAgo, pnl) => Array.from({ length: n }, () => tr(daysAgo, pnl));

test("tradesInWindow filters by close time; ALL keeps everything", () => {
  const t = [tr(0.5, 1), tr(3, 1), tr(20, 1), tr(90, 1)];
  assert.equal(tradesInWindow(t, "24H", NOW).length, 1);
  assert.equal(tradesInWindow(t, "7D", NOW).length, 2);
  assert.equal(tradesInWindow(t, "30D", NOW).length, 3);
  assert.equal(tradesInWindow(t, "ALL", NOW).length, 4);
});

test("below the minimum a window is ACCRUING — no grade fields at all", () => {
  const g = gradeWindow(many(3, 0.1, 50), "24H");
  assert.equal(g.status, "ACCRUING");
  assert.equal(g.need, 2);
  assert.equal(g.pf, undefined);
  assert.equal(g.winRate, undefined);
  // minimums: 5 / 10 / 20 / 20
  assert.equal(gradeWindow(many(5, 0, 1), "24H").status, "GRADED");
  assert.equal(gradeWindow(many(9, 0, 1), "7D").status, "ACCRUING");
  assert.equal(gradeWindow(many(10, 0, 1), "7D").status, "GRADED");
  assert.equal(gradeWindow(many(19, 0, 1), "30D").status, "ACCRUING");
  assert.equal(gradeWindow(many(19, 0, 1), "ALL").status, "ACCRUING");
});

test("graded window components: win rate, PF, expectancy", () => {
  const g = gradeWindow([...many(12, 1, 30), ...many(8, 1, -15)], "30D");
  assert.equal(g.status, "GRADED");
  assert.equal(g.trades, 20);
  assert.equal(g.winRate, 60);
  assert.equal(g.pf, 360 / 120);
  assert.equal(g.net, 240);
  assert.equal(g.expectancy, 12);
  assert.equal(fmtPf(gradeWindow(many(20, 1, 5), "30D").pf), "∞");
});

test("zero-pnl trades count as losses (same rule as the Lab)", () => {
  const g = gradeWindow([...many(10, 1, 10), ...many(10, 1, 0)], "30D");
  assert.equal(g.wins, 10);
  assert.equal(g.losses, 10);
});

test("default window: 30D when graded, ALL fallback, else 30D accruing", () => {
  const recent = many(25, 2, 5);
  assert.deepEqual(defaultWindow(gradeAllWindows(recent, NOW)), { key: "30D", fellBack: false });
  const old = many(25, 60, 5);
  assert.deepEqual(defaultWindow(gradeAllWindows(old, NOW)), { key: "ALL", fellBack: true });
  assert.deepEqual(defaultWindow(gradeAllWindows(many(3, 60, 5), NOW)), { key: "30D", fellBack: false });
});

test("decay row reads ALL → 30D → 7D, accruing windows carry no PF", () => {
  const t = [...many(30, 60, 10), ...many(20, 10, -5), ...many(5, 1, 1)];
  const row = decayRow(gradeAllWindows(t, NOW));
  assert.deepEqual(row.map((r) => r.key), ["ALL", "30D", "7D"]);
  assert.equal(row[0].status, "GRADED");
  assert.equal(row[1].status, "GRADED");
  assert.equal(row[2].status, "ACCRUING");
  assert.equal(row[2].pf, null);
  assert.ok(row[0].pf > row[1].pf);
});

test("windowComplete: a truncated tape only covers windows it reaches back to", () => {
  assert.equal(windowComplete("30D", NOW, { truncated: false }), true);
  assert.equal(windowComplete("ALL", NOW, { truncated: true, oldestTs: NOW - 400 * DAY }), false);
  assert.equal(windowComplete("30D", NOW, { truncated: true, oldestTs: NOW - 10 * DAY }), false);
  assert.equal(windowComplete("7D", NOW, { truncated: true, oldestTs: NOW - 10 * DAY }), true);
});

const g30 = (wins, losses, w = 30, l = -15) => gradeWindow([...many(wins, 1, w), ...many(losses, 1, l)], "30D");

test("gate: passes on a positive graded 30D HL window", () => {
  const gate = edgeGate({ hl30: g30(14, 8) });
  assert.equal(gate.pass, true);
  assert.equal(gate.evidence[0].source, "HL30");
  assert.deepEqual(gate.reasons, []);
});

test("gate: an accruing 30D window never passes on its own", () => {
  const gate = edgeGate({ hl30: gradeWindow(many(3, 1, 500), "30D") });
  assert.equal(gate.pass, false);
  assert.match(gate.reasons[0], /3 closed trades, needs 20/);
});

test("gate: negative or PF<=1 graded 30D is a veto", () => {
  const neg = edgeGate({ hl30: g30(5, 15), watched: { netRealized: 5000, gradedWindows: 40, daysTracked: 40 } });
  assert.equal(neg.pass, false, "a good watched record does not outvote a losing 30D");
  assert.match(neg.reasons.join(" "), /net negative/);
});

test("gate: watched Orderly record can carry an Orderly-only wallet", () => {
  assert.equal(edgeGate({ watched: { netRealized: 900, gradedWindows: 25, daysTracked: 26 } }).pass, true);
  const short = edgeGate({ watched: { netRealized: 900, gradedWindows: 6, daysTracked: 6 } });
  assert.equal(short.pass, false);
  assert.match(short.reasons[0], /6 graded days, needs 20/);
  const under = edgeGate({ hl30: g30(14, 8), watched: { netRealized: -1, gradedWindows: 3, daysTracked: 3 } });
  assert.equal(under.pass, false, "watched record underwater is a veto even when HL passes");
});

test("gate: nothing to grade → locked with a reason", () => {
  const gate = edgeGate({});
  assert.equal(gate.pass, false);
  assert.equal(gate.reasons.length, 1);
  assert.equal(edgeGate({ watched: { building: true, points: 1 } }).pass, false);
});

test("watchedWindow needs a baseline at/before the window start", () => {
  const series = Array.from({ length: 10 }, (_, i) => ({ t: NOW - (9 - i) * DAY, realized: i * 100 }));
  const w7 = watchedWindow(series, "7D", NOW);
  assert.equal(w7.covered, true);
  assert.equal(w7.net, 700);
  const w24 = watchedWindow(series, "24H", NOW);
  assert.equal(w24.covered, true);
  assert.equal(w24.net, 100);
  const w30 = watchedWindow(series, "30D", NOW);
  assert.equal(w30.covered, false, "9 days watched can't speak for 30");
  assert.equal(Math.round(w30.coveredDays), 9);
  assert.equal(watchedWindow(series, "ALL", NOW).net, 900);
  assert.equal(watchedWindow(series, "7D", NOW + 5 * DAY).stale, true);
  assert.equal(watchedWindow([], "7D", NOW).covered, false);
});

test("liqDistancePct: only from a reported liq price, by side", () => {
  assert.equal(liqDistancePct("LONG", 100, 80), 20);
  assert.equal(liqDistancePct("SHORT", 100, 125), 25);
  assert.equal(liqDistancePct("LONG", 100, null), null);
  assert.equal(liqDistancePct("LONG", 100, 0), null);
  assert.equal(liqDistancePct("LONG", 0, 80), null);
  assert.equal(liqDistancePct("LONG", 79, 80), 0, "past liq clamps to 0, never negative");
});

test("hlCoinToOrderly mirrors the worker mapping", () => {
  assert.equal(hlCoinToOrderly("BTC"), "BTC");
  assert.equal(hlCoinToOrderly("kPEPE"), "1000PEPE");
  assert.equal(hlCoinToOrderly("xyz:TSLA"), null);
  assert.equal(hlCoinToOrderly(""), null);
});
