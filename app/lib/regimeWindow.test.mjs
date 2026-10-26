// regimeWindow: the signed page's numbers + the regime rule.
// Run: node --test app/lib/regimeWindow.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REGIME_WINDOW, btcDailyRegimes, regimeConditionMet, regimeLabel, regimeState, regimeFromMs, regimeLimitMs } from "./regimeWindow.mjs";

const page = readFileSync(new URL(`../../${REGIME_WINDOW.doc}`, import.meta.url), "utf8");
const DAY = 86_400_000;

test("every number is the signed page's", () => {
  assert.match(page, /`registeredAt` \(the next 00:00 UTC after signing\): \*\*2026-10-27T00:00:00Z\*\*/);
  assert.match(page, /Six-month limit \(`registeredAt` \+ six calendar months\): \*\*2027-04-27T00:00:00Z\*\*/);
  assert.equal(REGIME_WINDOW.registeredAt, "2026-10-27T00:00:00Z");
  assert.equal(REGIME_WINDOW.limitAt, "2027-04-27T00:00:00Z");
  assert.match(page, /\*\*UP\*\* = ≥ \+10% · \*\*DOWN\*\* = ≤ −10% · \*\*FLAT\*\* = anything between/);
  assert.match(page, /at least 14 days \(not necessarily in a row\) in each of two\s+different states, and one of the two is DOWN/);
  assert.match(page, /close 30 days\s+earlier − 1, on Orderly daily candles for `PERP_BTC_USDC` \(`\/tv\/history`, resolution `D`\)/);
  assert.match(page, /at least 30 counted trades/);
  assert.deepEqual([REGIME_WINDOW.upPct, REGIME_WINDOW.downPct, REGIME_WINDOW.minDays, REGIME_WINDOW.lookbackDays, REGIME_WINDOW.minTrades], [10, -10, 14, 30, 30]);
});

test("state boundaries are inclusive at ±10%", () => {
  assert.equal(regimeState(0.10), "UP");
  assert.equal(regimeState(0.0999), "FLAT");
  assert.equal(regimeState(-0.10), "DOWN");
  assert.equal(regimeState(-0.0999), "FLAT");
  assert.equal(regimeState(NaN), null);
});

// Daily candles from a list of closes, one per day, starting `startMs`.
const candles = (startMs, closes) => closes.map((c, i) => ({ t: (startMs + i * DAY) / 1000, c }));

test("counts closed days in the window from the close 30 days earlier; missing data is counted, never stated", () => {
  const from = regimeFromMs();
  const start = from - 30 * DAY;
  // 30 lookback days at 100, then 5 days at 120 (UP), 5 at 100 (FLAT), 5 at 85 (DOWN)
  const closes = [...Array(30).fill(100), ...Array(5).fill(120), ...Array(5).fill(100), ...Array(5).fill(85)];
  const r = btcDailyRegimes(candles(start, closes), { now: from + 15 * DAY });
  assert.deepEqual(r.counts, { UP: 5, DOWN: 5, FLAT: 5 });
  assert.equal(r.missing, 0);
  assert.equal(r.days[0].day, "2026-10-27");
  // a day still open is not counted
  assert.equal(btcDailyRegimes(candles(start, closes), { now: from + 15 * DAY - 1 }).counts.DOWN, 4);
  // a hole in the lookback is missing, not FLAT
  const holed = candles(start, closes).filter((_, i) => i !== 0);
  const h = btcDailyRegimes(holed, { now: from + 15 * DAY });
  assert.equal(h.missing, 1);
  assert.equal(h.counts.UP, 4);
  // nothing before the registration counts
  assert.deepEqual(btcDailyRegimes(candles(start, closes), { now: from }).counts, { UP: 0, DOWN: 0, FLAT: 0 });
});

test("the condition needs 14+ days in two states, one of them DOWN", () => {
  assert.equal(regimeConditionMet({ UP: 14, DOWN: 14, FLAT: 0 }), true);
  assert.equal(regimeConditionMet({ UP: 0, DOWN: 14, FLAT: 14 }), true);
  assert.equal(regimeConditionMet({ UP: 100, DOWN: 0, FLAT: 50 }), false, "no DOWN = not met");
  assert.equal(regimeConditionMet({ UP: 100, DOWN: 13, FLAT: 0 }), false);
  assert.equal(regimeConditionMet({ DOWN: 40 }), false, "one state only");
  assert.equal(regimeLabel({ UP: 140, DOWN: 0, FLAT: 42 }), "regime condition not met (no DOWN regime): UP 140 days, FLAT 42 days");
  assert.equal(regimeLabel({ UP: 140, DOWN: 3, FLAT: 10 }), "one regime only: UP 140 days, DOWN 3 days, FLAT 10 days");
  assert.match(regimeLabel({ UP: 20, DOWN: 20 }), /^regime condition met/);
});

test("the limit is six calendar months after the registration", () => {
  const a = new Date(regimeFromMs()), b = new Date(regimeLimitMs());
  assert.equal(b.getUTCFullYear() * 12 + b.getUTCMonth() - (a.getUTCFullYear() * 12 + a.getUTCMonth()), 6);
  assert.equal(b.getUTCDate(), a.getUTCDate());
});
