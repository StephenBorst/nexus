// app/lib/excursion.mjs + its two users (grading.mjs callExcursion, paperRun). Run: node --test app/lib/excursion.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { excursionR, paperExcursion, excursionLine } from "./excursion.mjs";

test("MAE / MFE in R over the bars after the fill; the exit bar only up to the levels", () => {
  // LONG from 100, risk 10 (stop 90). Bars: low 95 / high 108, low 97 / high 112, exit bar low 80 / high 130.
  const base = { long: true, entry: 100, risk: 10, highs: [108, 112, 130], lows: [95, 97, 80] };
  assert.deepEqual(excursionR(base), { maeR: 2, mfeR: 3 }, "open: every bar counts in full");
  assert.deepEqual(excursionR({ ...base, exitBar: 2, maxAdverse: 1, maxFavor: 1.5 }), { maeR: 1, mfeR: 1.5 }, "the exit bar stops at the stop and the target");
  assert.deepEqual(excursionR({ long: false, entry: 100, risk: 10, highs: [104], lows: [93] }), { maeR: 0.4, mfeR: 0.7 }, "a short reads the other way");
  assert.equal(excursionR({ ...base, risk: 0 }), null);
  assert.equal(excursionR({ ...base, highs: [], lows: [] }), null);
  assert.equal(excursionLine({ maeR: 0.4, mfeR: 1.25 }), "Went 0.40R against · 1.25R for, while open");
  assert.equal(excursionLine(null), null);
});

test("paper: hourly tape after the entry hour, risk from sl_percent, a TP exit capped at its target", () => {
  const H = 3600000, t0 = Date.parse("2026-11-16T10:20:00Z"), hour = (k) => Math.floor(t0 / H) * H + k * H;
  const tape = [
    { t: hour(0), h: 150, l: 50 },            // the entry hour: left out (prints before the fill)
    { t: hour(1), h: 101, l: 99 },
    { t: hour(2), h: 102.5, l: 98.5 },
    { t: hour(3), h: 110, l: 99 },            // the exit hour: capped at the target (+1.5R = 103)
    { t: hour(4), h: 200, l: 1 },             // after the exit: never read
  ];
  const row = { entry_price: 100, exit_price: 103, direction: "LONG", sl_percent: 2, tp_percent: 3, reason: "TP", opened_at: new Date(t0).toISOString(), closed_at: new Date(hour(3) + 600000).toISOString() };
  assert.deepEqual(paperExcursion(row, tape), { maeR: 0.75, mfeR: 1.5 });
  assert.equal(paperExcursion({ ...row, sl_percent: undefined }, tape), null, "no stop on the row = no R = nothing");
  assert.equal(paperExcursion(row, null), null);
  // A stop exit that slipped past its level: the exit bar may go as far as the fill did, no further.
  const sl = { ...row, exit_price: 97.8, reason: "SL", closed_at: new Date(hour(2) + 600000).toISOString() };
  assert.deepEqual(paperExcursion(sl, tape), { maeR: 0.75, mfeR: 0.5 }, "-1.1R fill: the 98.5 low is inside it; no favour past the exit's own R (≤0) in the exit bar");
});

test("calls: the grader stamps maeR / mfeR from the same fill and exit it graded on", async () => {
  const { callExcursion, stampExcursion, GRADE_FIELDS } = await import("../../workers/nexus-lab-api/grading.mjs");
  const { SERVER_FIELDS } = await import("../../workers/nexus-lab-api/callLock.mjs");
  assert.ok(GRADE_FIELDS.includes("maeR") && GRADE_FIELDS.includes("mfeR"), "the grader owns them");
  assert.ok(SERVER_FIELDS.includes("maeR") && SERVER_FIELDS.includes("mfeR"), "a client can never write them");
  const T = 1_800_000_000;
  // LONG at 100 (the market at the post), stop 90, TP1 115. Bars after the post: dip to 94, then up through 115.
  const cd = { step: 3600, t: [T, T + 3600, T + 7200, T + 10800], h: [101, 103, 108, 130], l: [99, 94, 100, 105], c: [100, 101, 107, 120] };
  const t = { direction: "LONG", entryPrice: 100, stopLoss: 90, takeProfit1: 115, createdAt: T * 1000 + 60000, publishMark: { px: 100 } };
  const x = callExcursion(t, { outcome: "WIN", r: 1.5, exitAt: T + 10800 }, cd);
  assert.deepEqual(x, { maeR: 0.6, mfeR: 1.5 }, "−6 against, and the exit bar's 130 stops at the 115 target");
  const open = callExcursion(t, { outcome: "PENDING", r: 0 }, cd);
  assert.deepEqual(open, { maeR: 0.6, mfeR: 3 }, "open: the latest bar counts in full");
  assert.equal(callExcursion({ ...t, entryPrice: 80, publishMark: { px: 100 } }, { outcome: "PENDING" }, cd), null, "an entry that never traded has no path");
  const call = { ...t };
  assert.equal(stampExcursion(call, { outcome: "PENDING", r: 0 }, cd), true);
  assert.deepEqual([call.maeR, call.mfeR], [0.6, 3]);
  assert.equal(stampExcursion(call, { outcome: "PENDING", r: 0 }, cd), false, "unchanged = no write");
});

test("wired: the paper run carries it per trade, never summed; the page and the call page print it", () => {
  const run = readFileSync(new URL("./paperRun.mjs", import.meta.url), "utf8");
  assert.match(run, /paperExcursion\(t, candles\[coinOf\(t\.symbol\)\]\)/);
  assert.doesNotMatch(run, /maeR\s*\+|sum.*maeR|avg.*maeR/i, "no total or average of excursions on the paper run");
  assert.match(readFileSync(new URL("../../workers/nexus-lab-api/routes-paperrun.mjs", import.meta.url), "utf8"), /candle:hist:PERP_\$\{coin\}_USDC/);
  assert.match(readFileSync(new URL("../pages/proof/PaperRun.tsx", import.meta.url), "utf8"), /Against \/ for/);
  assert.match(readFileSync(new URL("../pages/thesis/index.tsx", import.meta.url), "utf8"), /excursionLine\(thesis\)/);
  assert.match(readFileSync(new URL("../../workers/nexus-lab-api/grading.mjs", import.meta.url), "utf8"), /if \(stampExcursion\(t, g, cd\)\) changed = true;/);
});
