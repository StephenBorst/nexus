// The Wire's rules (app/lib/wire.mjs). Run: node --test app/lib/wire.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  newsRows, bellRows, walletRows, callRows, upcomingRows, wireStream, nextSeen, filterWire, wireWhen, coinOfTitle, myCallRows, withMine,
  WIRE_FILTERS, WIRE_KINDS, WIRE_MAX, WIRE_WINDOW_MS, HEADLINE_LINE, CALL_LINE, WALLET_LINE,
} from "./wire.mjs";

const NOW = Date.parse("2026-11-20T18:00:00Z");
const M = 60_000, H = 3600_000;

test("every row kind has a tag word and a filter", () => {
  for (const k of Object.keys(WIRE_KINDS)) assert.ok(WIRE_FILTERS.some((f) => f.kinds && f.kinds.includes(k)), k);
  assert.equal(WIRE_FILTERS[0].id, "all");
});

test("news: dated by the story, else first seen; tagged coin; the headline line; older than a day drops", () => {
  const rows = newsRows([
    { id: "a", title: "Bitcoin falls below $60K", source: "Cointelegraph", coins: ["BTC"], publishedAt: NOW - 35 * M, firstSeenAt: NOW, link: "https://x.test/a" },
    { id: "b", title: "Undated", source: "Yahoo Finance", coins: [], publishedAt: null, firstSeenAt: NOW - 2 * H, link: "" },
    { id: "c", title: "Old", source: "Decrypt", coins: [], publishedAt: NOW - WIRE_WINDOW_MS - 1, firstSeenAt: NOW },
  ], NOW);
  assert.deepEqual(rows.map((r) => [r.id, r.t, r.coin, r.graded]), [["news-a", NOW - 35 * M, "BTC", HEADLINE_LINE], ["news-b", NOW - 2 * H, null, HEADLINE_LINE]]);
  assert.equal(rows[1].link, null);
});

test("bell: a standing condition is dated when first seen, an event by its own time", () => {
  const list = [
    { id: "fund-RAY-LONG", kind: "FUNDING", ts: NOW, title: "RAY funding stretched -0.062%/8h", graded: "fade grade" },
    { id: "mom-ETH-SHORT", kind: "MOMENTUM", ts: NOW, title: "ETH is trending down, open interest rising", graded: "Not graded" },
    { id: "read-open-x", kind: "READ", ts: NOW - 2 * H, title: "SOL: a registered read opened a paper long", path: "/proof/paper/x", graded: "Stage LEAD" },
    { id: "fade-div-BTC", kind: "DIVERGENCE", ts: NOW, title: "BTC: funding and the graded callers point opposite ways" },
  ];
  const rows = bellRows(list, { "fund-RAY-LONG": NOW - 3 * H }, NOW);
  assert.deepEqual(rows.map((r) => [r.kind, r.t, r.coin]), [
    ["FUNDING", NOW - 3 * H, "RAY"], ["MOMENTUM", NOW, "ETH"], ["READ", NOW - 2 * H, "SOL"], ["FUNDING", NOW, "BTC"],
  ]);
  assert.equal(rows[2].path, "/proof/paper/x");
});

test("first-seen map: kept for what still stands, dropped once it stops, new ones at now", () => {
  assert.deepEqual(nextSeen({ a: 1, b: 2 }, ["a", "c"], 9), { a: 1, c: 9 });
});

test("coin from a bell title", () => {
  assert.equal(coinOfTitle("SOL: a registered read opened"), "SOL");
  assert.equal(coinOfTitle("RAY funding stretched"), "RAY");
  assert.equal(coinOfTitle("0x12ab…cd earned Sharp"), null);
});

test("wallets: size floor, newest first, at most six; the line says it is not a reason to follow", () => {
  const ev = (i, sz, type = "OPEN", src = "orderly") => ({ source: src, addr: "0xabcdef0000000000000000000000000000001234", coin: "PERP_ETH_USDC", side: "SHORT", type, szUsd: sz, closedPnl: type === "CLOSE" ? -1200 : null, ts: NOW - i * M });
  const rows = walletRows([ev(1, 676, "OPEN", "hl"), ev(2, 25_000), ev(3, 12_000, "CLOSE", "hl"), ...[4, 5, 6, 7, 8, 9].map((i) => ev(i, 50_000))], NOW);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].title, "ETH: a tracked wallet opened a $25k short");
  assert.equal(rows[1].title, "ETH: a tracked wallet closed a $12k short (−$1k)");
  assert.equal(rows[1].source, "0xabcd…1234 · Hyperliquid");
  assert.equal(rows[0].graded, WALLET_LINE);
  assert.match(WALLET_LINE, /not a reason to follow/);
});

test("calls: people and engines named apart, R signed, older than a day drops", () => {
  const pulse = {
    recentGraded: [{ symbol: "BTC", direction: "SHORT", path: "/feed/thesis/a/1", caller: "Banksy", outcome: "WIN", r: 1.13, at: NOW - H }],
    engines: { recentGraded: [{ symbol: "PERP_HYPE_USDC", direction: "SHORT", path: "/feed/thesis/b/2", caller: "Ember M", outcome: "LOSS", r: -1, at: NOW - 2 * H }, { symbol: "ZEC", direction: "LONG", path: "/x", outcome: "WIN", r: 1, at: NOW - 2 * WIRE_WINDOW_MS }] },
  };
  const rows = callRows(pulse, NOW);
  assert.deepEqual(rows.map((r) => [r.title, r.source]), [
    ["BTC short by Banksy graded WIN +1.13R", "Caller"],
    ["HYPE short by Ember M graded LOSS −1.00R", "Engine caller"],
  ]);
  assert.equal(rows[0].graded, CALL_LINE);
});

test("upcoming: the next 12h only, soonest first, with forecast / odds", () => {
  const rows = upcomingRows([
    { kind: "MACRO", at: NOW + 3 * H, title: "CPI m/m", impact: "High", forecast: "0.3%", previous: "0.4%" },
    { kind: "MARKET", at: NOW + H, title: "Fed hike in December?", yesPct: 86.5, coins: ["BTC"] },
    { kind: "MACRO", at: NOW + 13 * H, title: "Too far" },
    { kind: "MACRO", at: NOW - M, title: "Already out" },
  ], NOW);
  assert.deepEqual(rows.map((r) => [r.title, r.detail]), [["Fed hike in December?", "market closes then · yes 87%"], ["CPI m/m", "forecast 0.3% · previous 0.4%"]]);
});

test("stream: one row per id, newest first, inside the day, capped", () => {
  const a = { id: "a", t: NOW - H }, b = { id: "b", t: NOW - M }, old = { id: "o", t: NOW - WIRE_WINDOW_MS - 1 }, future = { id: "f", t: NOW + H };
  assert.deepEqual(wireStream([[a, b], [{ ...a, t: NOW }], [old, future]], NOW).map((r) => r.id), ["b", "a"]);
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, t: NOW - i * M }));
  assert.equal(wireStream([many], NOW).length, WIRE_MAX);
});

test("filters and times", () => {
  const rows = [{ kind: "NEWS" }, { kind: "READ" }, { kind: "FUNDING" }, { kind: "MOMENTUM" }, { kind: "TIER" }, { kind: "CALL" }];
  assert.equal(filterWire(rows, "all").length, 6);
  assert.deepEqual(filterWire(rows, "markets").map((r) => r.kind), ["FUNDING", "MOMENTUM"]);
  assert.deepEqual(filterWire(rows, "wallets").map((r) => r.kind), ["TIER"]);
  assert.equal(wireWhen(NOW - 30_000, NOW), "now");
  assert.equal(wireWhen(NOW - 4 * M, NOW), "4m");
  assert.equal(wireWhen(NOW - 2 * H, NOW), "2h");
  assert.equal(wireWhen(NOW + 35 * M, NOW), "in 35m");
  assert.equal(wireWhen(NOW + 119 * M, NOW), "in 2h");
});

test("no row says a direction to take: titles state what happened", () => {
  const all = [
    ...bellRows([{ id: "x", kind: "FUNDING", ts: NOW, title: "RAY funding stretched" }], {}, NOW),
    ...walletRows([{ source: "orderly", addr: "0x1", coin: "ETH", side: "LONG", type: "OPEN", szUsd: 20_000, ts: NOW }], NOW),
  ];
  for (const r of all) assert.doesNotMatch(r.title, /\b(buy|sell|go long|go short|should|signal to)\b/i);
});

test("your calls: a later fill, TP1 on a split, the grade; each at the grader's own stamp, in your words", () => {
  const W = "0xD9F7000000000000000000000000000000000B449";
  const status = {
    wallet: W.toLowerCase(),
    calls: [
      { id: "a", symbol: "PERP_ETH_USDC", direction: "SHORT", entryPrice: 1865, stopLoss: 1895, takeProfit1: 1805, plannedR: { tp1: 2 }, postedAt: NOW - 5 * H, filledAt: NOW - 2 * H, tp1HitAt: NOW - H, graded: null },
      { id: "b", symbol: "PERP_BTC_USDC", direction: "LONG", entryPrice: 60000, stopLoss: 59000, takeProfit1: 62000, postedAt: NOW - 3 * H, filledAt: NOW - 3 * H + 1000, graded: null }, // filled at the post: not news
      { id: "c", symbol: "PERP_SOL_USDC", direction: "LONG", postedAt: NOW - 3 * H, filledAt: null, graded: null },                                                   // still working: nothing
    ],
    recent: [
      { id: "d", symbol: "PERP_BTC_USDC", direction: "SHORT", exitReason: "TIME", postedAt: NOW - 30 * H, graded: { outcome: "WIN", r: 0.42, at: NOW - 10 * M, exitedAt: NOW - 12 * M } },
      { id: "e", symbol: "PERP_HYPE_USDC", direction: "LONG", postedAt: NOW - 60 * H, graded: { outcome: "LOSS", r: -1, at: NOW - 2 * WIRE_WINDOW_MS } },             // older than a day
    ],
  };
  const rows = myCallRows(status, NOW);
  assert.deepEqual(rows.map((r) => [r.id, r.title]), [
    ["mine-a-fill", "Your ETH short filled at 1865"],
    ["mine-a-tp1", "Your ETH short reached TP1 1805 · half closed +1.00R"],
    ["mine-d-graded", "Your BTC short graded WIN +0.42R"],
  ]);
  assert.equal(rows[2].t, NOW - 10 * M, "the time the grader stamped it");
  assert.equal(rows[2].detail, "Closed on the time stop");
  assert.equal(rows[0].path, `/feed/thesis/${W.toLowerCase()}/a`);
  for (const r of rows) { assert.equal(r.kind, "MINE"); assert.equal(r.source, "Your call"); assert.equal(r.graded, CALL_LINE); }
  assert.deepEqual(myCallRows(null, NOW), []);
  assert.deepEqual(myCallRows({ error: "rate_limited" }, NOW), []);
});

test("your rows merge into the shared stream once: the public row for your own graded call is dropped", () => {
  const W = "0xabc0000000000000000000000000000000000001";
  const mine = myCallRows({ wallet: W, calls: [], recent: [{ id: "d", symbol: "BTC", direction: "SHORT", graded: { outcome: "WIN", r: 1, at: NOW - M } }] }, NOW);
  const shared = [
    { id: "call-x", kind: "CALL", t: NOW - M, path: `/feed/thesis/${W.toUpperCase().replace("0X", "0x")}/d`, title: "BTC short by you graded WIN" },
    { id: "n1", kind: "NEWS", t: NOW - 2 * M, title: "headline" },
  ];
  const merged = withMine(shared, mine, NOW);
  assert.deepEqual(merged.map((r) => r.id), ["mine-d-graded", "n1"]);
  assert.deepEqual(withMine(shared, [], NOW), shared, "no wallet = the shared stream as it was");
  assert.deepEqual(filterWire(merged, "mine").map((r) => r.id), ["mine-d-graded"]);
  assert.deepEqual(filterWire(merged, "calls").map((r) => r.id), ["mine-d-graded"]);
  assert.equal(WIRE_FILTERS.find((f) => f.id === "mine").wallet, true, "the Mine chip shows only with a wallet");
});

test("your calls on the Wire are read in the browser from your own status, never through the shared route", () => {
  const ui = readFileSync(new URL("../pages/lab/TheWire.tsx", import.meta.url), "utf8");
  assert.match(ui, /theses\/status\//);
  assert.match(ui, /myCallRows\(/);
  assert.match(ui, /withMine\(/);
  const route = readFileSync(new URL("../../workers/nexus-lab-api/routes-wire.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(route, /theses\/status|myCallRows/);
});

test("your calls: +0.5R reached and an order that expired, in the alerts' own words; an expiry is not a grade", async () => {
  const { wireSeenSplit } = await import("./wire.mjs");
  const status = {
    wallet: "0xabc0000000000000000000000000000000000001",
    calls: [{ id: "h", symbol: "PERP_ETH_USDC", direction: "LONG", entryPrice: 100, stopLoss: 98, takeProfit1: 103, postedAt: NOW - 5 * H, filledAt: NOW - 5 * H, halfRAt: NOW - 20 * M }],
    recent: [],
    expired: [
      { id: "x1", symbol: "PERP_SOL_USDC", direction: "SHORT", entryPrice: 150, stopLoss: 155, expiredAt: NOW - 2 * H, expiredReason: "WINDOW", fillWithinH: 4 },
      { id: "x2", symbol: "BTC", direction: "LONG", entryPrice: 61000, stopLoss: 60000, expiredAt: NOW - 3 * H, expiredReason: "STOP_FIRST" },
      { id: "x3", symbol: "BTC", direction: "LONG", expiredAt: NOW - 3 * WIRE_WINDOW_MS },
    ],
  };
  const rows = myCallRows(status, NOW);
  assert.deepEqual(rows.map((r) => [r.id, r.title, r.detail]), [
    ["mine-h-halfr", "Your ETH long reached +0.5R (101)", "Still open: graded at TP1 103 or the stop 98"],
    ["mine-x1-expired", "Your SOL short order expired", "The entry 150 didn't trade within 4h"],
    ["mine-x2-expired", "Your BTC long order expired", "The stop 60000 traded before the entry"],
  ]);
  assert.match(rows[1].graded, /Not a win, not a loss/);

  // new since your last look: rows newer than the baseline, newest first; no baseline = no split
  const stream = [{ t: NOW - M }, { t: NOW - 2 * M }, { t: NOW - H }, { t: NOW - 2 * H }];
  assert.deepEqual(wireSeenSplit(stream, NOW - 30 * M), { newCount: 2, at: NOW - 30 * M });
  assert.deepEqual(wireSeenSplit(stream, NOW), { newCount: 0, at: NOW });
  assert.equal(wireSeenSplit(stream, null), null);
});
