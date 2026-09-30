import test from "node:test";
import assert from "node:assert/strict";
import { orderlySymbol, planPages, parseTvHistory, countGaps, fetchTape, ORDERLY } from "./tape.mjs";

const H4 = 4 * 3600;

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

// A fake /tv/history: one bar every 4h over [from, to), from a price function of time.
function fakeGet(calls, { failOn } = {}) {
  return async (url, opts) => {
    calls.push({ url, opts });
    const q = new URL(url).searchParams;
    if (failOn && calls.length === failOn) throw new Error("orderly rate_limited (HTTP 429) /tv/history?…");
    const from = Number(q.get("from")), to = Number(q.get("to"));
    const t = [];
    for (let s = Math.ceil(from / H4) * H4; s <= to; s += H4) t.push(s); // inclusive `to`: pages overlap by one bar
    return { s: "ok", t, o: t.map(() => 1), h: t.map(() => 2), l: t.map(() => 0.5), c: t.map(() => 1.5) };
  };
}

test("fetchTape: paged, paced, stitched without duplicates, 4H resolution", async () => {
  const calls = [], slept = [];
  const from = Date.UTC(2026, 0, 5), to = from + 100 * 86400000;
  const r = await fetchTape("eth", from, to, { get: fakeGet(calls), sleep: async (ms) => { slept.push(ms); }, pageDays: 40 });
  assert.equal(r.error, undefined);
  assert.equal(r.orderly, "PERP_ETH_USDC");
  assert.equal(calls.length, 3);
  assert.equal(slept.length, 2);
  for (const c of calls) {
    assert.ok(c.url.startsWith(`${ORDERLY}/tv/history?symbol=PERP_ETH_USDC&resolution=240&from=`));
    assert.equal(c.opts.tries, 4);
  }
  assert.equal(r.bars.length, 100 * 6 + 1); // every 4h over 100 days, boundaries not doubled
  assert.equal(new Set(r.bars.map((b) => b.t)).size, r.bars.length);
  assert.equal(r.gaps, 0);
});

test("fetchTape: a failed page fails the market (no partial tape), and bad ids never hit the network", async () => {
  const calls = [];
  const from = Date.UTC(2026, 0, 5);
  const r = await fetchTape("SOL", from, from + 100 * 86400000, { get: fakeGet(calls, { failOn: 2 }), sleep: async () => {} });
  assert.match(r.error, /rate_limited/);
  assert.deepEqual(r.bars, []);
  assert.equal(r.pages, 1);
  const none = [];
  const bad = await fetchTape("ETH/USDT", from, from + 86400000, { get: fakeGet(none) });
  assert.equal(bad.error, "not an Orderly market id");
  assert.equal(none.length, 0);
});
