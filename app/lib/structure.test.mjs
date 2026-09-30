import test from "node:test";
import assert from "node:assert/strict";
import {
  H4_MS, WEEK_MS, DAY_MS, STRUCTURE_DEFAULTS, normalizeBars, weekStart, completedBars, weeklyBars,
  isSwingHigh, isSwingLow, weeklyBias, atr, nearestLevels, classifyAgainstStructure,
} from "./structure.mjs";

const T0 = Date.UTC(2026, 0, 5); // a Monday

// 42 closed 4H bars that trace o → h → l → c with no wicks, so the week aggregates to exactly
// {o,h,l,c} and the 4H tape has no strict fractal anywhere (each bar opens at the last close).
function weekOfBars(weekIdx, { o, h, l, c }) {
  const pts = [o, h, l, c];
  const out = [];
  let prev = o;
  for (let j = 0; j < 42; j++) {
    const s = Math.floor(j / 14), f = ((j % 14) + 1) / 14;
    const close = pts[s] + (pts[s + 1] - pts[s]) * f;
    out.push({ t: T0 + weekIdx * WEEK_MS + j * H4_MS, o: prev, h: Math.max(prev, close), l: Math.min(prev, close), c: close });
    prev = close;
  }
  return out;
}
const tapeFromWeeks = (weeks) => weeks.flatMap((w, i) => weekOfBars(i, w));

// Weekly bias fixture: a swing high at w2 (13) confirmed by w4, broken by w6's close (14) → BULL.
const BULL_WEEKS = [
  { o: 9, h: 10, l: 8, c: 9 },
  { o: 9, h: 11, l: 9, c: 10 },
  { o: 10, h: 13, l: 10, c: 12 },
  { o: 12, h: 12, l: 9, c: 10 },
  { o: 10, h: 11, l: 8, c: 9 },
  { o: 9, h: 12, l: 9, c: 11 },
  { o: 11, h: 15, l: 11, c: 14 },
  { o: 14, h: 16, l: 13, c: 15 },
];
const mirror = (w) => ({ o: 30 - w.o, h: 30 - w.l, l: 30 - w.h, c: 30 - w.c });
const BEAR_WEEKS = BULL_WEEKS.map(mirror);

// Hand-made 4H bars in the (unfinished) week 8: a swing high at 16.5 (j2) that j4 confirms.
const W8 = T0 + 8 * WEEK_MS;
const LOCAL = [
  { o: 15.0, h: 15.2, l: 14.8, c: 15.0 },
  { o: 15.0, h: 15.5, l: 14.9, c: 15.4 },
  { o: 15.4, h: 16.5, l: 15.3, c: 16.0 },
  { o: 16.0, h: 16.1, l: 15.5, c: 15.6 },
  { o: 15.6, h: 15.8, l: 15.2, c: 15.4 },
  { o: 15.4, h: 15.6, l: 15.1, c: 15.3 },
].map((b, j) => ({ t: W8 + j * H4_MS, ...b }));
const AS_OF = W8 + 6 * H4_MS; // all six local bars closed, week 8 not
const BULL_TAPE = [...tapeFromWeeks(BULL_WEEKS), ...LOCAL];

test("weekStart: Monday 00:00 UTC", () => {
  assert.equal(weekStart(T0), T0);
  assert.equal(weekStart(T0 + WEEK_MS - 1), T0);
  assert.equal(weekStart(T0 + WEEK_MS), T0 + WEEK_MS);
  assert.equal(weekStart(0), -3 * DAY_MS); // 1970-01-01 (Thu) → Mon 1969-12-29
  assert.equal(new Date(weekStart(Date.UTC(2026, 8, 30, 13))).getUTCDay(), 1);
});

test("normalizeBars: sorted, deduped (last copy wins), non-finite rows dropped", () => {
  const out = normalizeBars([
    { t: 2, o: 1, h: 1, l: 1, c: 1 },
    { t: 1, o: 1, h: 1, l: 1, c: 1 },
    { t: 2, o: 9, h: 9, l: 9, c: 9 },
    { t: 3, o: 1, h: NaN, l: 1, c: 1 },
  ]);
  assert.deepEqual(out.map((b) => [b.t, b.c]), [[1, 1], [2, 9]]);
});

test("completedBars: a bar counts only once it has closed", () => {
  const bars = Array.from({ length: 20 }, (_, i) => ({ t: T0 + i * H4_MS, o: 1, h: 1, l: 1, c: 1 }));
  assert.equal(completedBars(bars, T0 + 10 * H4_MS).length, 10);
  assert.equal(completedBars(bars, T0 + 10 * H4_MS - 1).length, 9);
  assert.equal(completedBars(bars, T0).length, 0);
});

test("weeklyBars: completed weeks only, aggregated exactly", () => {
  const tape = tapeFromWeeks(BULL_WEEKS);
  const weeks = weeklyBars(tape, T0 + 8 * WEEK_MS);
  assert.equal(weeks.length, 8);
  weeks.forEach((w, i) => {
    assert.equal(w.t, T0 + i * WEEK_MS);
    assert.equal(w.n, 42);
    for (const k of ["o", "h", "l", "c"]) assert.ok(Math.abs(w[k] - BULL_WEEKS[i][k]) < 1e-9, `week ${i} ${k}`);
  });
  // Mid-week 7: week 7 is not complete yet, so it is not a bar.
  assert.equal(weeklyBars(tape, T0 + 7 * WEEK_MS + 3 * DAY_MS).length, 7);
});

test("fractal swings are strict and need k bars on both sides", () => {
  const b = [1, 2, 5, 2, 1, 5].map((h, i) => ({ t: i, o: h, h, l: h - 1, c: h }));
  assert.equal(isSwingHigh(b, 2, 2), true);
  assert.equal(isSwingHigh(b, 5, 2), false); // no bars to its right
  const flat = [3, 3, 3, 3, 3].map((h, i) => ({ t: i, o: h, h, l: h, c: h }));
  assert.equal(isSwingHigh(flat, 2, 2), false);
  assert.equal(isSwingLow(flat, 2, 2), false);
});

test("weeklyBias: BULL on a close above the confirmed swing high, BEAR on the mirror", () => {
  const bull = weeklyBias(weeklyBars(tapeFromWeeks(BULL_WEEKS), T0 + 8 * WEEK_MS));
  assert.equal(bull.bias, "BULL");
  assert.equal(bull.lastBreakAt, T0 + 6 * WEEK_MS);
  const bear = weeklyBias(weeklyBars(tapeFromWeeks(BEAR_WEEKS), T0 + 8 * WEEK_MS));
  assert.equal(bear.bias, "BEAR");
  assert.equal(bear.lastBreakAt, T0 + 6 * WEEK_MS);
});

test("weeklyBias: no break = NEUTRAL; too few weeks = null; only the last 26 weeks count", () => {
  const flat = Array.from({ length: 10 }, () => ({ o: 10, h: 11, l: 9, c: 10 }));
  assert.equal(weeklyBias(weeklyBars(tapeFromWeeks(flat), T0 + 10 * WEEK_MS)).bias, "NEUTRAL");
  assert.equal(weeklyBias(weeklyBars(tapeFromWeeks(BULL_WEEKS.slice(0, 7)), T0 + 7 * WEEK_MS)), null);
  // The BULL break happens in weeks 0–7, then 26 flat weeks: the window no longer sees it.
  const flatAfter = Array.from({ length: 26 }, () => ({ o: 15, h: 15.5, l: 14.5, c: 15 }));
  const weeks = weeklyBars(tapeFromWeeks([...BULL_WEEKS, ...flatAfter]), T0 + 34 * WEEK_MS);
  assert.equal(weeks.length, 34);
  assert.equal(weeklyBias(weeks).bias, "NEUTRAL");
  assert.equal(weeklyBias(weeks, { weeklyWindow: 40 }).bias, "BULL");
});

test("atr: mean true range, gaps counted against the previous close", () => {
  const b = [
    { t: 0, o: 10, h: 10, l: 10, c: 10 },
    { t: 1, o: 12, h: 13, l: 12, c: 12 }, // gap up: TR = 13 − 10 = 3
    { t: 2, o: 12, h: 13, l: 11, c: 12 }, // TR = 2
  ];
  assert.equal(atr(b, 2), 2.5);
  assert.equal(atr(b, 3), null);
});

test("nearestLevels: the nearest unbroken, confirmed 4H swing on each side", () => {
  const closed = completedBars(BULL_TAPE, AS_OF);
  const { supply, demand } = nearestLevels(closed, 15.3);
  assert.equal(supply.price, 16.5);
  assert.equal(supply.t, W8 + 2 * H4_MS);
  assert.equal(demand, null); // the generated tape has no strict swing lows
  // A later close above 16.5 breaks it.
  const broken = [...closed, { t: AS_OF, o: 15.3, h: 16.8, l: 15.3, c: 16.6 }];
  assert.equal(nearestLevels(broken, 15.3).supply, null);
  // Not yet confirmed: with only j0..j3 closed, the swing at j2 has one bar on its right.
  assert.equal(nearestLevels(completedBars(BULL_TAPE, W8 + 4 * H4_MS), 15.3).supply, null);
  // Older than the lookback: gone.
  assert.equal(nearestLevels(closed, 15.3, { zoneLookbackBars: 3 }).supply, null);
});

test("nearestLevels: the lowest supply above and the highest demand below", () => {
  const hs = [10, 11, 14, 11, 10, 11, 12, 11, 10, 9, 6, 9, 10, 9, 9.5];
  const bars = hs.map((x, i) => ({ t: i, o: x, h: x + 0.1, l: x - 0.1, c: x }));
  // swing highs 14.1 (i2), 12.1 (i6), 10.1 (i12); swing lows 9.9 (i4), 5.9 (i10)
  const lv = nearestLevels(bars, 11.5, { zoneLookbackBars: 50 });
  assert.equal(lv.supply.price, 12.1); // 12.1 and 14.1 both unbroken: the nearer one
  assert.equal(lv.demand.price, 5.9);  // 9.9 was broken by the close at 9 (i9)
  const lv2 = nearestLevels(bars, 9.2, { zoneLookbackBars: 50 });
  assert.equal(lv2.demand.price, 5.9);
  assert.equal(lv2.supply.price, 10.1);
});

test("classify: a LONG right under 4H supply is counter-cycle (into a level)", () => {
  const k = classifyAgainstStructure({ direction: "LONG", entry: 16.4, asOfMs: AS_OF }, BULL_TAPE);
  assert.equal(k.classified, true);
  assert.equal(k.weeklyBias, "BULL");
  assert.equal(k.againstWeekly, false);
  assert.equal(k.supply.price, 16.5);
  assert.equal(k.intoZone, true);
  assert.equal(k.counterCycle, true);
});

test("classify: a LONG well below supply, with a BULL week, fights nothing", () => {
  const k = classifyAgainstStructure({ direction: "LONG", entry: 15.3, asOfMs: AS_OF }, BULL_TAPE);
  assert.equal(k.intoZone, false);
  assert.ok(k.zoneDistAtr > 1);
  assert.equal(k.counterCycle, false);
});

test("classify: a SHORT under a BULL weekly bias is counter-cycle; a LONG under BEAR too", () => {
  const s = classifyAgainstStructure({ direction: "SHORT", entry: 15.3, asOfMs: AS_OF }, BULL_TAPE);
  assert.equal(s.againstWeekly, true);
  assert.equal(s.counterCycle, true);
  const bearTape = tapeFromWeeks(BEAR_WEEKS);
  const l = classifyAgainstStructure({ direction: "LONG", entry: 15, asOfMs: T0 + 8 * WEEK_MS + H4_MS }, bearTape);
  assert.equal(l.weeklyBias, "BEAR");
  assert.equal(l.againstWeekly, true);
  assert.equal(l.counterCycle, true);
});

test("classify: never on too little history, a flat tape or a malformed call", () => {
  assert.equal(classifyAgainstStructure({ direction: "LONG", entry: 10, asOfMs: T0 + 50 * H4_MS }, BULL_TAPE).reason, "h4_insufficient");
  assert.equal(classifyAgainstStructure({ direction: "LONG", entry: 10, asOfMs: T0 + 5 * WEEK_MS }, BULL_TAPE).reason, "weekly_insufficient");
  const flat = tapeFromWeeks(Array.from({ length: 9 }, () => ({ o: 10, h: 10, l: 10, c: 10 })));
  assert.equal(classifyAgainstStructure({ direction: "LONG", entry: 10, asOfMs: T0 + 9 * WEEK_MS }, flat).reason, "flat_tape");
  for (const bad of [{ direction: "UP", entry: 1, asOfMs: AS_OF }, { direction: "LONG", entry: 0, asOfMs: AS_OF }, { direction: "LONG", entry: 1 }]) {
    assert.equal(classifyAgainstStructure(bad, BULL_TAPE).reason, "bad_call");
  }
});

test("classify: NO LOOKAHEAD — bars after the post, and the unfinished bar, change nothing", () => {
  const calls = [
    { direction: "LONG", entry: 16.4, asOfMs: AS_OF + 3600 * 1000 },
    { direction: "SHORT", entry: 15.3, asOfMs: AS_OF + 1 },
    { direction: "LONG", entry: 15.3, asOfMs: AS_OF },
  ];
  const poison = [];
  for (let j = 0; j < 400; j++) {
    const px = j % 2 ? 1000 : 0.001; // absurd prints that would break every level and every week
    poison.push({ t: AS_OF + j * H4_MS, o: px, h: px * 2, l: px / 2, c: px });
  }
  for (const call of calls) {
    const clean = classifyAgainstStructure(call, completedBars(BULL_TAPE, call.asOfMs));
    const dirty = classifyAgainstStructure(call, normalizeBars([...BULL_TAPE, ...poison]));
    assert.deepEqual(dirty, clean);
    assert.equal(clean.classified, true);
  }
});

test("classify: an explicit undefined param never erases a default", () => {
  const call = { direction: "LONG", entry: 16.4, asOfMs: AS_OF };
  assert.deepEqual(
    classifyAgainstStructure(call, BULL_TAPE, { zoneAtrMult: undefined, weeklyWindow: undefined }),
    classifyAgainstStructure(call, BULL_TAPE),
  );
  assert.equal(STRUCTURE_DEFAULTS.zoneAtrMult, 1);
});
