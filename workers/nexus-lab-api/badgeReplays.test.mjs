// The v2 badge's random replays (badgeReplays.mjs). Run: node --test workers/nexus-lab-api/badgeReplays.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { randomEntryCheck, replayTrade, barsFromCandleHist } from "./badgeReplays.mjs";
import { BADGE_BAR } from "../../app/lib/badgeBar.mjs";

const H = 3600_000;
const T0 = Date.parse("2026-11-01T00:00:00Z");

// A recorded hourly tape: a slow wave, so stops and targets both get hit somewhere. `drift` tilts it.
function tape(hours, { base = 100, amp = 0.02, drift = 0 } = {}) {
  const out = [];
  for (let i = 0; i < hours; i++) {
    const mid = base * (1 + amp * Math.sin(i / 9) + drift * i);
    const o = mid * (1 - 0.001), c = mid * (1 + 0.001);
    out.push({ t: T0 + i * H, o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c });
  }
  return out;
}
const judged = (net, n = 30, side = "LONG", symbol = "PERP_BTC_USDC") => Array.from({ length: n }, (_, i) => ({ n: i + 1, symbol, side, exactPriceNetBps: net }));
const WINDOW = { since: T0 + 100 * H, until: T0 + 600 * H };

test("candle:hist rows (ms) become one bar per hour (s), sorted, broken rows dropped", () => {
  const bars = barsFromCandleHist([{ t: T0 + H, o: 2, h: 3, l: 1, c: 2 }, { t: T0, o: 1, h: 2, l: 1, c: 1.5 }, { t: T0 + 2 * H, c: NaN }, { t: T0 + H + 60_000, o: 2, h: 4, l: 1, c: 3 }]);
  assert.deepEqual(bars.map((b) => [b.t, b.c]), [[T0 / 1000, 1.5], [(T0 + H) / 1000, 3]]);
});

test("one replay trade walks the graded exit and pays the fees; no exit before the tape ends = null", () => {
  const bars = barsFromCandleHist(tape(900));
  const net = replayTrade(bars, 200, "LONG");
  assert.ok(Number.isFinite(net));
  assert.equal(replayTrade(bars, bars.length - 2, "LONG"), null, "no room left to reach an exit");
  assert.equal(replayTrade(bars, 10, "LONG"), null, "no H4 ATR yet: the graded exit can't size a stop");
});

test("deterministic: the same inputs give the same 300 means and the same verdict", () => {
  const input = { trades: judged(40), candlesByCoin: { BTC: tape(1200) }, ...WINDOW };
  const a = randomEntryCheck(input), b = randomEntryCheck(input);
  assert.deepEqual(a, b);
  assert.equal(a.runs, BADGE_BAR.runs);
  assert.equal(a.seed, BADGE_BAR.seed);
  assert.equal(a.means.length, 300);
  assert.equal(a.window.hours, 501);
  assert.equal(a.usable, 300 - a.leftOut);
});

test("a run far above every random replay beats them; one far below doesn't", () => {
  const candlesByCoin = { BTC: tape(1200) };
  const hi = randomEntryCheck({ trades: judged(5000), candlesByCoin, ...WINDOW });
  assert.equal(hi.verdict, "BEAT");
  assert.equal(hi.pctBeaten, 100);
  const lo = randomEntryCheck({ trades: judged(-5000), candlesByCoin, ...WINDOW });
  assert.equal(lo.verdict, "DIDNT_BEAT");
  assert.equal(lo.pctBeaten, 0);
});

test("the judged side's mean is price and fees only, from the trades' own numbers", () => {
  const trades = [...judged(10, 15), ...judged(30, 15).map((t) => ({ ...t, n: t.n + 15 }))];
  assert.equal(randomEntryCheck({ trades, candlesByCoin: { BTC: tape(1200) }, ...WINDOW }).judgedMeanBps, 20);
});

test("a tape too short to finish the replays = UNREAD (the badge waits), never a guess", () => {
  const short = randomEntryCheck({ trades: judged(50), candlesByCoin: { BTC: tape(120) }, ...WINDOW });
  assert.equal(short.verdict, "UNREAD");
  assert.equal(short.pctBeaten, null);
  assert.ok(short.usable < BADGE_BAR.minUsable);
  const none = randomEntryCheck({ trades: judged(50), candlesByCoin: {}, ...WINDOW });
  assert.equal(none.verdict, "UNREAD");
});

test("each replay trade keeps its coin and side", () => {
  // ETH tape trends up hard: random LONGS there win, random SHORTS lose. A short-only run at +0 beats shorts, not longs.
  const candlesByCoin = { ETH: tape(1200, { amp: 0.005, drift: 0.0004 }) };
  const shorts = randomEntryCheck({ trades: judged(0.01, 30, "SHORT", "PERP_ETH_USDC"), candlesByCoin, ...WINDOW });
  const longs = randomEntryCheck({ trades: judged(0.01, 30, "LONG", "PERP_ETH_USDC"), candlesByCoin, ...WINDOW });
  assert.ok(shorts.pctBeaten > longs.pctBeaten, `${shorts.pctBeaten} vs ${longs.pctBeaten}`);
});
