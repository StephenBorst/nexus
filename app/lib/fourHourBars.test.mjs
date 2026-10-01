import test from "node:test";
import assert from "node:assert/strict";
import { fourHourBars, hourlyBarsFromTv, dedupeBars, planPages, fetchFourHourBars, H4_MS, HOUR_MS } from "./fourHourBars.mjs";
import { fakeTvHistory } from "./__fixtures__/fakeTvHistory.mjs";

const T0 = Date.UTC(2026, 8, 1); // a Tuesday 00:00 UTC, on a 4H window boundary
const hour = (i, o, h, l, c) => ({ t: T0 + i * HOUR_MS, o, h, l, c });

test("fourHourBars: UTC 00/04/08/… windows, first open · max high · min low · last close", () => {
  const bars = fourHourBars([
    hour(0, 10, 12, 9, 11), hour(1, 11, 15, 10, 14), hour(2, 14, 14, 8, 9), hour(3, 9, 10, 9, 10),
    hour(4, 10, 11, 10, 11), hour(5, 11, 13, 7, 12),
  ]);
  assert.deepEqual(bars, [
    { t: T0, o: 10, h: 15, l: 8, c: 10, n: 4 },
    { t: T0 + H4_MS, o: 10, h: 13, l: 7, c: 12, n: 2 },
  ]);
  // A window whose first hours are missing still starts on the boundary, with what it has.
  const late = fourHourBars([hour(5, 1, 2, 0, 1), hour(6, 1, 3, 1, 2)]);
  assert.deepEqual(late, [{ t: T0 + H4_MS, o: 1, h: 3, l: 0, c: 2, n: 2 }]);
  // A window with no hourly bar is no bar (never filled).
  assert.deepEqual(fourHourBars([hour(0, 1, 1, 1, 1), hour(9, 2, 2, 2, 2)]).map((b) => b.t), [T0, T0 + 2 * H4_MS]);
  assert.deepEqual(fourHourBars([]), []);
});

test("hourlyBarsFromTv: no_data is an empty page, a bad body throws, junk rows drop", () => {
  assert.deepEqual(hourlyBarsFromTv({ s: "no_data" }), []);
  assert.throws(() => hourlyBarsFromTv({ s: "error" }), /unusable/);
  assert.throws(() => hourlyBarsFromTv(null), /unusable/);
  const bars = hourlyBarsFromTv({ s: "ok", t: [1, 2], o: [1, "x"], h: [2, 2], l: [0, 0], c: [1, 1] });
  assert.deepEqual(bars, [{ t: 1000, o: 1, h: 2, l: 0, c: 1 }]);
});

test("dedupeBars + planPages: a shared edge hour is kept once; pages are contiguous", () => {
  assert.deepEqual(dedupeBars([{ t: 2, c: 1 }, { t: 1, c: 1 }, { t: 2, c: 3 }]), [{ t: 1, c: 1 }, { t: 2, c: 3 }]);
  assert.deepEqual(planPages(0, 30 * 86400), [{ from: 0, to: 20 * 86400 }, { from: 20 * 86400, to: 30 * 86400 }]);
});

test("Orderly's 240 answers no_data; the same range built from 60 gives real 4H bars", async () => {
  const { get, calls } = fakeTvHistory();
  const toSec = T0 / 1000 + 30 * 86400, fromSec = toSec - 30 * 86400;
  // The old request: resolution 240 → nothing.
  assert.deepEqual(get(`https://api-evm.orderly.org/tv/history?symbol=PERP_BTC_USDC&resolution=240&from=${fromSec}&to=${toSec}`), { s: "no_data" });
  calls.length = 0;
  const { bars, hourly, pages } = await fetchFourHourBars("PERP_BTC_USDC", fromSec, toSec, { getJson: get });
  assert.equal(pages, 2, "30 days = two 20-day pages");
  assert.ok(calls.every((u) => u.includes("resolution=60")), "never asks for 240");
  assert.equal(hourly, 30 * 24 + 1, "every hour once, the shared page edge not doubled");
  assert.equal(bars.length, 30 * 6 + 1);
  assert.ok(bars.slice(0, -1).every((b) => b.n === 4 && b.t % H4_MS === 0));
  for (let i = 1; i < bars.length; i++) assert.equal(bars[i].t - bars[i - 1].t, H4_MS, "contiguous 4H tape");
});

test("a failed page fails the whole read, never a tape with a hole", async () => {
  let n = 0;
  const { get } = fakeTvHistory({ fail: () => ++n === 2 });
  await assert.rejects(fetchFourHourBars("PERP_BTC_USDC", 0, 30 * 86400, { getJson: get }), /page failed/);
  await assert.rejects(fetchFourHourBars("PERP_BTC_USDC", 0, 86400, {}), /getJson/);
});
