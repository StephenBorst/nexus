// The market table (app/lib/marketTable.mjs). Run: node --test app/lib/marketTable.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  yourCoinsFirst, marketTable, sortTable, sortValue, nextSort, smartLean, TABLE_COLUMNS, TABLE_MIN_OI_USD, TABLE_MAX, DEFAULT_SORT,
  fundingCell, oiVolCell, gapCell, smartCell, forecastCell, newsCell, readsCell, usdShort,
} from "./marketTable.mjs";

const NOW = Date.parse("2026-11-20T18:00:00Z");
const fut = (coin, { mark = 100, oi = 10_000, vol = 2_000_000, open = 100, f = 0.0001 } = {}) =>
  ({ symbol: `PERP_${coin}_USDC`, mark_price: mark, open_interest: oi, "24h_amount": vol, "24h_open": open, last_funding_rate: f });
const FUT = [
  fut("BTC", { mark: 60_000, oi: 250, vol: 14_000_000, open: 64_000, f: 0.0001 }),   // OI $15M
  fut("RAY", { mark: 1.28, oi: 115_000, vol: 150_000, open: 1.38, f: -0.000624 }),   // OI $147k, shorts pay past the line
  fut("XAU", { mark: 3530, oi: 25, vol: 50_000, open: 3680, f: 0.0001126 }),         // OI $88k
  fut("DUST", { mark: 1, oi: 1000, vol: 500 }),                                       // OI $1k: left out
  { symbol: "SPOT_X_USDC", mark_price: 1 },
];
const SOURCES = {
  venues: { rows: [{ coin: "BTC", gap: 12.4 }, { coin: "RAY", gap: -40 }] },
  smart: { consensus: { BTC: { long: 1, short: 12 }, RAY: { long: 1, short: 1 } } },
  forecasts: { markets: [{ coin: "BTC", divergence: true }, { coin: "BTC", divergence: false }] },
  news: { items: [{ coins: ["BTC", "NAS100"], publishedAt: NOW - 3600_000 }, { coins: ["BTC"], publishedAt: null, firstSeenAt: NOW - 600_000 }, { coins: ["BTC"], publishedAt: NOW - 2 * 86400_000 }] },
  paperRuns: { spot_absorb: { open: { coin: "SOL", side: "SHORT" } }, oi_div_reversal_4h: { open: { coin: "BTC", side: "LONG" } }, x: { open: null } },
};

test("one row per perp over the OI floor, biggest first; the thin and the non-perp are left out and counted", () => {
  const t = marketTable({ futures: FUT, ...SOURCES, now: NOW });
  assert.deepEqual(t.rows.map((r) => r.coin), ["BTC", "RAY", "XAU"]);
  assert.equal(t.leftOut, 1);
  assert.deepEqual(t.others.map((r) => r.coin), ["DUST"], "the thin ones are kept for pins, not shown");
  assert.deepEqual(t.unread, []);
  assert.ok(TABLE_MIN_OI_USD === 30_000 && TABLE_MAX === 40);
});

test("each input in its own column, with the stated lines marked", () => {
  const [btc, ray] = marketTable({ futures: FUT, ...SOURCES, now: NOW }).rows;
  assert.equal(btc.change24hPct, -6.25);
  assert.equal(btc.funding8hPct, 0.01);
  assert.equal(btc.fundingPast, null);
  assert.equal(ray.fundingPast, "SHORTS");
  assert.equal(btc.oiVol, 1.07);
  assert.equal(ray.oiVol, 0.98);
  assert.equal(btc.gap, 12.4);
  assert.deepEqual(btc.smart, { long: 1, short: 12, side: "SHORT" });
  assert.deepEqual(ray.smart, { long: 1, short: 1, side: "NONE" });
  assert.deepEqual(btc.forecast, { divergent: 1, total: 2 });
  assert.equal(ray.forecast, null);
  assert.equal(btc.news, 2, "a story older than a day doesn't count; an undated one counts by when it was first seen");
  assert.equal(ray.news, 0);
  assert.deepEqual(btc.reads, [{ axis: "oi_div_reversal_4h", side: "LONG" }]);
});

test("OI vs volume is marked only on a market that trades", () => {
  const t = marketTable({ futures: [fut("A", { oi: 1000, vol: 50_000 }), fut("B", { oi: 2000, vol: 120_000 })], ...SOURCES, now: NOW });
  const a = t.rows.find((r) => r.coin === "A"), b = t.rows.find((r) => r.coin === "B");
  assert.equal(a.oiVol, 2);
  assert.equal(a.oiVolPast, false);
  assert.equal(b.oiVolPast, true);
});

test("a failed source = its column unread (null) and named, never 0", () => {
  const t = marketTable({ futures: FUT, now: NOW });
  assert.deepEqual(t.unread, ["venues", "smart", "forecasts", "news", "reads"]);
  const btc = t.rows[0];
  for (const k of ["gap", "smart", "forecast", "news", "reads"]) assert.equal(btc[k], null, k);
  assert.equal(newsCell(btc), "unread");
  assert.equal(readsCell(btc), "unread");
  assert.deepEqual(marketTable({ futures: null }), { rows: [], others: [], leftOut: 0, unread: ["markets"] });
});

test("the 2× smart rule", () => {
  assert.equal(smartLean({ long: 1, short: 2 }).side, "SHORT");
  assert.equal(smartLean({ long: 3, short: 5 }).side, "NONE");
  assert.equal(smartLean({ long: 0, short: 1 }).side, "NONE");
  assert.equal(smartLean(null), null);
});

test("sorting: by size either way for funding and the gap; nulls last both ways; ties by OI", () => {
  const rows = marketTable({ futures: FUT, ...SOURCES, now: NOW }).rows;
  assert.deepEqual(sortTable(rows, "funding", "desc").map((r) => r.coin), ["RAY", "XAU", "BTC"]);
  assert.deepEqual(sortTable(rows, "gap", "desc").map((r) => r.coin), ["RAY", "BTC", "XAU"]);
  assert.deepEqual(sortTable(rows, "gap", "asc").map((r) => r.coin), ["BTC", "RAY", "XAU"]);
  assert.deepEqual(sortTable(rows, "coin", "asc").map((r) => r.coin), ["BTC", "RAY", "XAU"]);
  assert.deepEqual(sortTable(rows).map((r) => r.coin), ["BTC", "RAY", "XAU"]);
  assert.deepEqual(DEFAULT_SORT, { col: "oi", dir: "desc" });
  assert.equal(sortValue(rows[0], "nope"), null);
});

test("header taps: a new column biggest first (coin A→Z), the same column flips", () => {
  assert.deepEqual(nextSort({ col: "oi", dir: "desc" }, "funding"), { col: "funding", dir: "desc" });
  assert.deepEqual(nextSort({ col: "funding", dir: "desc" }, "funding"), { col: "funding", dir: "asc" });
  assert.deepEqual(nextSort({ col: "oi", dir: "desc" }, "coin"), { col: "coin", dir: "asc" });
});

test("cells in words", () => {
  const [btc, ray] = marketTable({ futures: FUT, ...SOURCES, now: NOW }).rows;
  assert.equal(fundingCell(ray), "−0.0624%");
  assert.equal(fundingCell(btc), "+0.0100%");
  assert.equal(oiVolCell(btc), "1.1×");
  assert.equal(gapCell(ray), "−40 pts");
  assert.equal(smartCell(btc), "12S · 1L");
  assert.equal(forecastCell(btc), "1 of 2");
  assert.equal(forecastCell(ray), "—");
  assert.equal(newsCell(ray), "—");
  assert.equal(usdShort(14_611_816), "$14.6M");
});

test("no combined score: no column sums others, and no copy ranks a coin", () => {
  assert.deepEqual(TABLE_COLUMNS.map((c) => c.id), ["coin", "funding", "oiVol", "gap", "smart", "forecast", "news", "reads", "oi"]);
  const src = readFileSync(new URL("./marketTable.mjs", import.meta.url), "utf8") + readFileSync(new URL("../pages/lab/MarketTable.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\bscore\s*[:=(]|conviction|top pick|signal strength|best (coin|trade)/i);
});

test("your coins first: watched coins stay on top whatever the sort; the rest sort normally underneath", () => {
  const t = marketTable({ futures: FUT, ...SOURCES, now: NOW });
  // by OI: BTC, RAY, XAU. Watching XAU keeps it on top.
  let v = yourCoinsFirst(t, ["xau"]);
  assert.deepEqual(v.pinned.map((r) => r.coin), ["XAU"]);
  assert.deepEqual(v.rest.map((r) => r.coin), ["BTC", "RAY"]);
  assert.equal(v.pinned[0].pinned, true);
  // re-sorted by funding (size): RAY leads the rest, the pins still lead the table, sorted among themselves
  v = yourCoinsFirst(t, ["BTC", "XAU"], "funding", "desc");
  assert.deepEqual(v.pinned.map((r) => r.coin), ["XAU", "BTC"]);
  assert.deepEqual(v.rest.map((r) => r.coin), ["RAY"]);
  // a watched thin market still pins (marked thin); a coin Orderly doesn't list is named, not invented
  v = yourCoinsFirst(t, ["DUST", "NOPE", "$BTC"]);
  assert.deepEqual(v.pinned.map((r) => [r.coin, !!r.thin]), [["BTC", false], ["DUST", true]]);
  assert.deepEqual(v.missing, ["NOPE"]);
  // nothing watched = the table as it was
  v = yourCoinsFirst(t, []);
  assert.deepEqual(v.pinned, []);
  assert.deepEqual(v.rest.map((r) => r.coin), ["BTC", "RAY", "XAU"]);
});

test("the table reads the device watchlist (no new data, no new source)", () => {
  const ui = readFileSync(new URL("../pages/lab/MarketTable.tsx", import.meta.url), "utf8");
  assert.match(ui, /readWatch\(\)/);
  assert.match(ui, /WATCH_EVENT/);
  assert.match(ui, /yourCoinsFirst\(/);
});

test("activity dots: YOUR open call and YOUR open position, watched coins only, nothing guessed", async () => {
  const { yourMarks, openCallCoins } = await import("./marketTable.mjs");
  const openCalls = openCallCoins({ calls: [{ symbol: "PERP_BTC_USDC" }, { symbol: "SOL" }] });
  assert.deepEqual([...openCalls], ["BTC", "SOL"]);
  const positions = [{ symbol: "PERP_XAU_USDC", position_qty: -0.5 }, { symbol: "PERP_ETH_USDC", position_qty: 0 }, { symbol: "PERP_SOL_USDC", position_qty: 3 }];
  assert.deepEqual(yourMarks(["BTC", "XAU", "ETH", "$SOL"], { openCalls, positions }), {
    BTC: { call: true, position: false }, XAU: { call: false, position: true }, SOL: { call: true, position: true },
  });
  assert.deepEqual(yourMarks(["DOGE"], { openCalls, positions }), {}, "a coin you don't watch gets no dot, even with a call");
  assert.deepEqual(yourMarks(["BTC"], {}), {}, "no wallet / unread = no dots");
  assert.equal(openCallCoins(null), null);
  assert.equal(openCallCoins({ error: "x" }), null);
});

test("moved since you last looked: the Watching panel's baseline to the table's price, read only", async () => {
  const { sinceLook, sinceLookCell } = await import("./marketTable.mjs");
  const s = sinceLook({ price: 102.5 }, { price: 100, at: NOW - 3 * 3600_000, snap: {} });
  assert.deepEqual(s, { pct: 2.5, at: NOW - 3 * 3600_000 });
  assert.deepEqual(sinceLookCell(s, NOW), { move: "+2.50%", ago: "3h ago", dir: 1 });
  assert.deepEqual(sinceLookCell(sinceLook({ price: 80 }, { price: 100, at: NOW - 30 * 60_000 }), NOW), { move: "−20.0%", ago: "30m ago", dir: -1 });
  assert.equal(sinceLook({ price: 100 }, undefined), null, "never looked = no number, not 0");
  assert.equal(sinceLook({ price: 100 }, { price: null, at: NOW }), null);
  assert.equal(sinceLookCell(null, NOW), null);
  // the table never moves the baseline: no markSeen / writeWatch in it
  const ui = readFileSync(new URL("../pages/lab/MarketTable.tsx", import.meta.url), "utf8");
  assert.match(ui, /sinceLook\(/);
  assert.doesNotMatch(ui, /markSeen|writeWatch/);
});
