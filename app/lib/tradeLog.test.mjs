// The Trading Log's rules (tradeLog.mjs). Run: node --test app/lib/tradeLog.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayStats, dayPasses, monthStats, matchesSearch, fmtPrice, holdText, coverageLine, wonLine, outcome } from "./tradeLog.mjs";

const t = (symbol, pnl, extra = {}) => ({ symbol, pnl, timestamp: 0, ...extra });

test("one rule for a win: P&L > 0; a $0 trade or day is flat, never a win", () => {
  assert.equal(outcome(0.01), "WIN");
  assert.equal(outcome(0), "FLAT");
  assert.equal(outcome(-3), "LOSS");
  assert.equal(dayPasses("wins", 0), false, "the filter used to count a $0 day as a win");
  assert.equal(dayPasses("losses", 0), false);
  assert.equal(dayPasses("all", 0), true);
  assert.equal(dayPasses("wins", 5), true);
  assert.equal(dayPasses("losses", -5), true);
});

test("a day counted: wins, losses, flat, best and worst trade, net per coin (biggest first)", () => {
  const st = dayStats([t("PERP_ETH_USDC", 12), t("PERP_BTC_USDC", -30), t("PERP_ETH_USDC", 5), t("PERP_SOL_USDC", 0)]);
  assert.equal(st.pnl, -13);
  assert.deepEqual([st.wins, st.losses, st.flat, st.trades, st.winRate], [2, 1, 1, 4, 50]);
  assert.equal(st.best.pnl, 12);
  assert.equal(st.worst.pnl, -30);
  assert.deepEqual(st.coins.map((c) => [c.coin, c.pnl, c.trades]), [["BTC", -30, 1], ["ETH", 17, 2], ["SOL", 0, 1]]);
  assert.equal(wonLine(st), "2 of 4 won · 1 flat");
  const none = dayStats([]);
  assert.equal(none.winRate, null);
  assert.equal(wonLine(none), "no trades");
  assert.equal(dayStats([t("PERP_ETH_USDC", -1)]).best, null, "no winning trade = no best, never the least-bad loss");
});

test("the calendar's numbers are the month on screen, not the whole history", () => {
  const g = { "2026-11-3": { pnl: 40, trades: 2 }, "2026-11-20": { pnl: -10, trades: 1 }, "2026-10-31": { pnl: 500, trades: 9 } };
  assert.deepEqual(monthStats(g, 10, 2026), { pnl: 30, days: 2, winDays: 1, trades: 3 });
  assert.deepEqual(monthStats(g, 9, 2026), { pnl: 500, days: 1, winDays: 1, trades: 9 });
  assert.deepEqual(monthStats(g, 0, 2027), { pnl: 0, days: 0, winDays: 0, trades: 0 });
});

test("search: a coin, a day in any common form, or a month", () => {
  const trades = [t("PERP_ETH_USDC", 1)];
  for (const q of ["eth", "ETH", "2026-11-5", "2026-11-05", "nov 5", "nov 05", "11/5", "11/05", "nov", "November", "2026-11"]) {
    assert.equal(matchesSearch("2026-11-5", trades, q), true, q);
  }
  for (const q of ["btc", "nov 15", "2026-11-15", "oct", "11/15"]) assert.equal(matchesSearch("2026-11-5", trades, q), false, q);
  assert.equal(matchesSearch("2026-11-5", trades, "  "), true);
});

test("prices: never $0.00 for a real price; small coins keep 4 significant figures", () => {
  assert.equal(fmtPrice(61234.5), "$61,234.50");
  assert.equal(fmtPrice(1.23456), "$1.2346");
  assert.equal(fmtPrice(0.00041234), "$0.0004123");
  assert.equal(fmtPrice(0), "—");
  assert.equal(fmtPrice(undefined), "—");
});

test("hold time and the 500-position cap", () => {
  const M = 60_000;
  assert.equal(holdText(0, 45 * M), null, "no open time = no hold");
  assert.equal(holdText(1, 1 + 45 * M), "45m");
  assert.equal(holdText(1, 1 + 200 * M), "3h 20m");
  assert.equal(holdText(1, 1 + 120 * M), "2h");
  assert.equal(holdText(1, 1 + (2 * 1440 + 240) * M), "2d 4h");
  assert.equal(coverageLine(499), null);
  assert.match(coverageLine(500), /^Your last 500 closed positions\. Orderly returns at most 500/);
});

test("the log screen uses these rules, wires TODAY, and paints direction in ink (green/red = money only)", () => {
  const src = readFileSync(new URL("../pages/lab/TradeLog.tsx", import.meta.url), "utf8");
  for (const fn of ["dayStats(", "dayPasses(", "monthStats(", "matchesSearch(", "fmtPrice(", "holdText(", "coverageLine("]) assert.ok(src.includes(fn), fn);
  assert.match(src, /onClick=\{onToday\}/, "the TODAY button used to do nothing");
  assert.doesNotMatch(src, /toFixed\(2\) \?\? "—"/);
  assert.doesNotMatch(src, /direction === "SHORT" \? "#f7525f"/, "direction is not money");
  assert.doesNotMatch(src, /background: "#fbbf24"/, "the decorative traffic-light dots are gone");
  assert.doesNotMatch(src, /height: `\$\{winRate\}%`/, "no filling bar");
  const lab = readFileSync(new URL("../pages/lab/index.tsx", import.meta.url), "utf8");
  assert.match(lab, /onToday/);
});
