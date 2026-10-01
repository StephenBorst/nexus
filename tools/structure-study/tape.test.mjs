import test from "node:test";
import assert from "node:assert/strict";
import { orderlySymbol, planPages, parseTvHistory, countGaps, fourHourBars, fetchTape, ORDERLY, HOUR_MS } from "./tape.mjs";
import { classifyAgainstStructure, completedBars, normalizeBars } from "../../app/lib/structure.mjs";
import { mulberry32 } from "./study.mjs";

const H4 = 4 * 3600;
const T0 = Date.UTC(2026, 0, 5); // a Monday, 00:00 UTC

test("orderlySymbol: bare tickers and canonical ids only", () => {
  assert.equal(orderlySymbol("eth"), "PERP_ETH_USDC");
  assert.equal(orderlySymbol("NAS100"), "PERP_NAS100_USDC");
  assert.equal(orderlySymbol("PERP_SOL_USDC"), "PERP_SOL_USDC");
  for (const bad of ["ETH/USDT", "", null, "PERP_SOL_USDT", "A".repeat(16)]) assert.equal(orderlySymbol(bad), null);
});

test("planPages: contiguous, oldest first, last page clipped", () => {
  const pages = planPages(1000, 1000 + 2.5 * 100, 100);
  assert.deepEqual(pages, [{ from: 1000, to: 1100 }, { from: 1100, to: 1200 }, { from: 1200, to: 1250 }]);
  assert.deepEqual(planPages(5, 5, 100), []);
});

test("parseTvHistory: seconds → ms; no_data is empty; anything else unusable throws", () => {
  const bars = parseTvHistory({ s: "ok", t: [10, 20], o: [1, 2], h: [3, 4], l: [0, 1], c: [2, 3], v: [9, 9] });
  assert.deepEqual(bars, [{ t: 10000, o: 1, h: 3, l: 0, c: 2 }, { t: 20000, o: 2, h: 4, l: 1, c: 3 }]);
  assert.deepEqual(parseTvHistory({ s: "no_data" }), []);
  assert.throws(() => parseTvHistory({ s: "error", errmsg: "x" }), /unusable/);
  assert.throws(() => parseTvHistory({ s: "ok", t: [1], h: [1], l: [1], c: [1] }), /unusable/);
  assert.throws(() => parseTvHistory(null), /unusable/);
});

test("countGaps: consecutive bars more than one bar apart", () => {
  const t = (i) => ({ t: i * H4 * 1000 });
  assert.equal(countGaps([t(0), t(1), t(2), t(4), t(5), t(9)]), 2);
  assert.equal(countGaps([]), 0);
});

test("fourHourBars: UTC 00/04/08/… windows, first open · max high · min low · last close", () => {
  const hour = (i, o, h, l, c) => ({ t: T0 + i * HOUR_MS, o, h, l, c });
  const bars = fourHourBars([
    hour(0, 10, 12, 9, 11), hour(1, 11, 15, 10, 14), hour(2, 14, 14, 8, 9), hour(3, 9, 10, 7, 10),
    hour(4, 10, 11, 10, 11), hour(6, 11, 13, 11, 12),            // 04:00 window: hours 4 and 6 only
    hour(12, 20, 21, 19, 20),                                      // 08:00 window: no candles → no bar
  ]);
  assert.deepEqual(bars, [
    { t: T0, o: 10, h: 15, l: 7, c: 10, n: 4 },
    { t: T0 + 4 * HOUR_MS, o: 10, h: 13, l: 10, c: 12, n: 2 },
    { t: T0 + 12 * HOUR_MS, o: 20, h: 21, l: 19, c: 20, n: 1 },
  ]);
  assert.equal(countGaps(bars), 1);
  // Windows start on 4-hour UTC boundaries, wherever the hourly series starts.
  const late = fourHourBars([hour(5, 1, 2, 0, 1), hour(6, 1, 3, 1, 2)]);
  assert.deepEqual(late.map((b) => new Date(b.t).toISOString()), ["2026-01-05T04:00:00.000Z"]);
  assert.deepEqual(fourHourBars([]), []);
});

// A fake /tv/history: one hourly bar per hour over [from, to] (inclusive `to`: pages overlap by one bar).
function fakeGet(calls, { failOn, empty } = {}) {
  return async (url, opts) => {
    calls.push({ url, opts });
    const q = new URL(url).searchParams;
    if (failOn && calls.length === failOn) throw new Error("orderly rate_limited (HTTP 429) /tv/history?…");
    if (empty || q.get("resolution") !== "60") return { s: "no_data" };
    const from = Number(q.get("from")), to = Number(q.get("to"));
    const t = [];
    for (let s = Math.ceil(from / 3600) * 3600; s <= to; s += 3600) t.push(s);
    return { s: "ok", t, o: t.map(() => 1), h: t.map(() => 2), l: t.map(() => 0.5), c: t.map(() => 1.5) };
  };
}

test("fetchTape: 1H candles in 20-day pages, paced, stitched without duplicates, built into 4H bars", async () => {
  const calls = [], slept = [];
  const from = T0, to = T0 + 100 * 86400000;
  const r = await fetchTape("eth", from, to, { get: fakeGet(calls), sleep: async (ms) => { slept.push(ms); } });
  assert.equal(r.error, undefined);
  assert.equal(r.orderly, "PERP_ETH_USDC");
  assert.equal(calls.length, 5);
  assert.equal(slept.length, 4);
  for (const c of calls) {
    assert.ok(c.url.startsWith(`${ORDERLY}/tv/history?symbol=PERP_ETH_USDC&resolution=60&from=`));
    assert.equal(c.opts.tries, 4);
  }
  assert.equal(r.bars1h, 100 * 24 + 1);                 // every hour, page boundaries not doubled
  assert.equal(r.bars.length, 100 * 6 + 1);             // the last hour opens a new 4H window
  assert.ok(r.bars.slice(0, -1).every((b) => b.n === 4));
  assert.deepEqual(r.bars[0], { t: T0, o: 1, h: 2, l: 0.5, c: 1.5, n: 4 });
  assert.equal(r.gaps, 0);
});

test("fetchTape: an empty tape is a failed market (run 1: every page answered no_data)", async () => {
  const calls = [];
  const r = await fetchTape("ETH", T0, T0 + 100 * 86400000, { get: fakeGet(calls, { empty: true }), sleep: async () => {} });
  assert.match(r.error, /no candles/);
  assert.deepEqual(r.bars, []);
  assert.equal(r.pages, 5);
  assert.equal(calls.length, 5);
});

test("fetchTape: a failed page fails the market; bad ids and other resolutions never hit the network", async () => {
  const calls = [];
  const r = await fetchTape("SOL", T0, T0 + 100 * 86400000, { get: fakeGet(calls, { failOn: 2 }), sleep: async () => {} });
  assert.match(r.error, /rate_limited/);
  assert.deepEqual(r.bars, []);
  assert.equal(r.pages, 1);
  const none = [];
  assert.equal((await fetchTape("ETH/USDT", T0, T0 + 86400000, { get: fakeGet(none) })).error, "not an Orderly market id");
  assert.match((await fetchTape("ETH", T0, T0 + 86400000, { get: fakeGet(none), resolution: "240" })).error, /resolution 240 is not supported/);
  assert.equal(none.length, 0);
});

test("NO LOOKAHEAD through the build: hourly candles after the post change nothing", () => {
  // 12 weeks of seeded hourly candles, a call 2h into a 4H window, then poisoned hours from the call's
  // own hour on (inside the open 4H window and beyond).
  const rnd = mulberry32(11);
  const hourly = [];
  let px = 100;
  for (let i = 0; i < 12 * 7 * 24; i++) {
    const o = px;
    px = Math.max(1, px * (1 + (rnd() - 0.5) * 0.02));
    hourly.push({ t: T0 + i * HOUR_MS, o, h: Math.max(o, px) * (1 + rnd() * 0.004), l: Math.min(o, px) * (1 - rnd() * 0.004), c: px });
  }
  const asOf = T0 + (10 * 7 * 24 + 2) * HOUR_MS + 17 * 60 * 1000; // 02:17 into a 00:00 window
  const known = hourly.filter((b) => b.t + HOUR_MS <= asOf);
  const poison = hourly.filter((b) => b.t + HOUR_MS > asOf).map((b, i) => ({ ...b, h: i % 2 ? 1e6 : b.h, l: i % 2 ? 1e-6 : b.l, c: i % 2 ? 1e5 : 1e-3 }));
  for (const direction of ["LONG", "SHORT"]) {
    const entry = known[known.length - 1].c;
    const clean = classifyAgainstStructure({ direction, entry, asOfMs: asOf }, fourHourBars(normalizeBars(known)));
    const dirty = classifyAgainstStructure({ direction, entry, asOfMs: asOf }, fourHourBars(normalizeBars([...known, ...poison])));
    assert.equal(clean.classified, true);
    assert.deepEqual(dirty, clean);
  }
  // The 4H window holding the post is never read, even though its first hours closed before the post.
  const open = Math.floor(asOf / (H4 * 1000)) * H4 * 1000;
  assert.ok(completedBars(fourHourBars(normalizeBars(known)), asOf).every((b) => b.t < open));
});
