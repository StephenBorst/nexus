// The crowd's odds vs the coin's own history (forecastOdds.mjs). Run: node --test app/lib/forecastOdds.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { oddsKind, daysLeft, dailyBars, historyOdds, crowdVsHistory, historyLine, gapLine, GAP_PTS, MIN_WINDOWS } from "./forecastOdds.mjs";

const DAY = 86_400_000;
// A flat tape at 100 with one spike: day 50's high reaches 115.
const flat = (n, spikeAt = -1, spikeHigh = 115) =>
  Array.from({ length: n }, (_, i) => ({ t: i * DAY, h: i === spikeAt ? spikeHigh : 101, l: 99, c: 100 }));

test("what kind of market: a touch (reach / hit / dip to) or a close (above / below at the end)", () => {
  assert.equal(oddsKind("Will Bitcoin reach $70,000 in November?"), "touch");
  assert.equal(oddsKind("Will BTC dip to $55k by Nov 30?"), "touch");
  assert.equal(oddsKind("Will ETH fall to $2,000 this month?"), "touch");
  assert.equal(oddsKind("Will Bitcoin be above $60,000 on November 30?"), "close");
  assert.equal(oddsKind("Will ETH close below $3,000 on Dec 31?"), "close");
});

test("days left: whole days, at least 1; past or missing = null", () => {
  const now = Date.parse("2026-11-23T00:00:00Z");
  assert.equal(daysLeft("2026-11-30T00:00:00Z", now), 7);
  assert.equal(daysLeft("2026-11-23T05:00:00Z", now), 1);
  assert.equal(daysLeft("2026-11-22T00:00:00Z", now), null);
  assert.equal(daysLeft(null, now), null);
});

test("daily bars: completed days only, bad rows dropped, oldest first", () => {
  const now = 3 * DAY + 1000;
  const tv = { s: "ok", t: [2 * 86400, 0, 86400, 3 * 86400], h: [2, 2, 0, 2], l: [1, 1, 1, 1], c: [1.5, 1.5, 1.5, 1.5] };
  const b = dailyBars(tv, now);
  assert.deepEqual(b.map((x) => x.t), [0, 2 * DAY], "the zero-high row and the still-open day are dropped");
  assert.deepEqual(dailyBars({ s: "no_data" }), []);
});

test("touch odds count every start day whose window reached the level", () => {
  const bars = flat(200, 50);
  // A +10% level from a close of 100 = 110: only the spike day's high (115) gets there.
  const o = historyOdds(bars, { distancePct: 10, days: 7, kind: "touch" });
  assert.equal(o.windows, 193);
  assert.equal(o.hits, 7, "start days 43..49 each see day 50 inside their 7 days");
  assert.equal(o.pct, Math.round((7 / 193) * 1000) / 10);
  assert.equal(historyOdds(bars, { distancePct: 20, days: 7, kind: "touch" }).hits, 0, "115 never reaches 120");
});

test("close odds read only the close at the end; drops are counted on lows / closes below", () => {
  const bars = flat(200, 50);
  assert.equal(historyOdds(bars, { distancePct: 10, days: 7, kind: "close" }).hits, 0, "the spike was an intraday high, not a close");
  const dip = Array.from({ length: 200 }, (_, i) => ({ t: i * DAY, h: 101, l: i === 80 ? 85 : 99, c: 100 }));
  assert.equal(historyOdds(dip, { distancePct: -10, days: 3, kind: "touch" }).hits, 3);
});

test("too little history = null, never a guess", () => {
  assert.equal(historyOdds(flat(MIN_WINDOWS), { distancePct: 5, days: 7, kind: "touch" }), null);
  assert.equal(historyOdds(flat(300), { distancePct: 0, days: 7, kind: "touch" }), null);
  assert.equal(historyOdds(flat(300), { distancePct: 5, days: 0, kind: "touch" }), null);
  assert.equal(historyOdds(null, { distancePct: 5, days: 7, kind: "touch" }), null);
  assert.equal(historyOdds(flat(800), { distancePct: 5, days: 7, kind: "touch" }).lookbackDays, 365, "reads the last year only");
});

test("the crowd vs history: a low YES on a far strike is NOT bearish (the old fold's bug)", () => {
  // The screenshot case: 12% that BTC reaches $70k (+14.4%) in 7 days, history 9%: about the same, no lean.
  assert.deepEqual(crowdVsHistory({ yesPct: 12, direction: "UP", historyPct: 9 }), { gapPts: 3, lean: null });
  // Crowd far MORE confident in the rise than history → leans UP; far LESS → DOWN.
  assert.equal(crowdVsHistory({ yesPct: 40, direction: "UP", historyPct: 15 }).lean, "UP");
  assert.equal(crowdVsHistory({ yesPct: 5, direction: "UP", historyPct: 30 }).lean, "DOWN");
  // A drop strike: more confident in the drop → DOWN; less → UP.
  assert.equal(crowdVsHistory({ yesPct: 50, direction: "DOWN", historyPct: 20 }).lean, "DOWN");
  assert.equal(crowdVsHistory({ yesPct: 2, direction: "DOWN", historyPct: 25 }).lean, "UP");
  assert.equal(crowdVsHistory({ yesPct: 30, direction: "UP", historyPct: 30 - GAP_PTS + 0.1 }).lean, null, "under the gap = no lean");
  assert.deepEqual(crowdVsHistory({ yesPct: 30, direction: null, historyPct: 10 }), { gapPts: null, lean: null });
});

test("the plain lines", () => {
  const o = { pct: 9.2, days: 7, kind: "touch", lookbackDays: 365 };
  assert.equal(historyLine("BTC", 14.42, o), "In BTC’s last 365 days, a 14.4% rise within 7 days happened from 9% of start days.");
  assert.equal(historyLine("ETH", -8, { ...o, kind: "close", days: 1 }), "In ETH’s last 365 days, a close 8.0% lower 1 day later happened from 9% of start days.");
  assert.equal(historyLine("BTC", 5, null), null);
  assert.equal(gapLine("BTC", 3), "The crowd’s odds are close to BTC’s own history.");
  assert.equal(gapLine("BTC", 21.4), "The crowd rates it 21 points more likely than BTC’s own history does.");
  assert.equal(gapLine("BTC", -15), "The crowd rates it 15 points less likely than BTC’s own history does.");
  assert.equal(gapLine("BTC", null), null);
});
