// GET /intel/market/:coin (routes-market.mjs). Run: node --test workers/nexus-lab-api/routes-market.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleMarket, MARKET_CACHE_PREFIX, MARKET_SOURCES } from "./routes-market.mjs";

const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const req = (path) => new Request(`https://og.nexustradinglabs.com${path}`, { headers: { origin: "https://trade.nexustradinglabs.com" } });
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const BOARDS = {
  "/intel/mispriced": { markets: [{ coin: "ETH", fundingAnnualPct: 10.97, change24hPct: -5.5, markPrice: 1852.3 }] },
  "/signals": { signals: [] },
  "/smart/consensus": { consensus: { ETH: { long: 7, short: 10 } } },
  "/theses/consensus": { consensus: {} },
  "/intel/forecasts/ETH": { markets: [] },
  "/intel/catalysts-board": { catalysts: [] },
  "/calls/pulse": { openCalls: [], engines: { openCalls: [] } },
  "/intel/funding-venues/ETH": { row: { coin: "ETH", orderly: 10.97, hyperliquid: 9.2, okx: 10.1, gap: 1.32 }, unread: [] },
  "/intel/axis-backtest": { axes: [{ name: "smart_follow", verdict: "PROMISING", r: { samples: 12032 }, random: { pooled: { verdict: "BEATS_RANDOM" } } }] },
};

test("not our route → null; a bad coin → 400", async () => {
  const env = { LAB_STORE: kv() };
  assert.equal(await handleMarket(["intel", "forecasts"], req("/intel/forecasts"), env, { dispatch: async () => ok({}) }), null);
  const bad = await handleMarket(["intel", "market", "../x"], req("/intel/market/../x"), env, { dispatch: async () => ok({}) });
  assert.equal(bad.status, 400);
});

test("composes every board in one response, reads each through dispatch, then serves the cache for 60 s", async () => {
  const env = { LAB_STORE: kv() };
  const asked = [];
  const dispatch = async (path) => { asked.push(path); return BOARDS[path] ? ok(BOARDS[path]) : new Response("no", { status: 404 }); };
  const r = await handleMarket(["intel", "market", "eth"], req("/intel/market/eth"), env, { dispatch, now: 1_000_000 });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.coin, "ETH");
  assert.deepEqual(asked.sort(), Object.values(MARKET_SOURCES("ETH")).sort());
  assert.equal(body.lenses.find((l) => l.id === "smart").line, "10 short · 7 long among tracked traders: split, no clear agreement.");
  assert.deepEqual(body.unread, []);
  assert.match(body.lenses.find((l) => l.id === "smart").graded, /^Nearest graded rule: following the recorded smart-money lean \(any margin\) grades PROMISING/);
  assert.ok(env.LAB_STORE.m.has(MARKET_CACHE_PREFIX + "ETH"));

  asked.length = 0;
  await handleMarket(["intel", "market", "ETH"], req("/intel/market/ETH"), env, { dispatch, now: 1_000_000 + 59_000 });
  assert.equal(asked.length, 0, "served from cache");
  await handleMarket(["intel", "market", "ETH"], req("/intel/market/ETH"), env, { dispatch, now: 1_000_000 + 61_000 });
  assert.ok(asked.length > 0, "rebuilt after 60 s");
});

test("a failing or slow board drops its lens and is named unread; the drawer still answers", async () => {
  const env = { LAB_STORE: kv() };
  const dispatch = async (path) => {
    if (path === "/smart/consensus") throw new Error("boom");
    if (path === "/intel/mispriced") return new Promise(() => {}); // never settles
    return ok(BOARDS[path] ?? {});
  };
  const r = await handleMarket(["intel", "market", "ETH"], req("/intel/market/ETH"), env, { dispatch, timeoutMs: 20, now: 5 });
  const body = await r.json();
  assert.deepEqual(body.unread.sort(), ["mispriced", "smart"]);
  assert.equal(body.lenses.find((l) => l.id === "funding").line, "Unread right now.");
});

test("index.js routes /intel/market through the worker's own handler, in-process", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /const worker = \{/);
  assert.match(src, /export default worker;/);
  assert.match(src, /handleMarket\(parts, request, env, \{\s*dispatch: \(path\) => worker\.fetch\(/);
});

test("/intel/fade-grade returns only the fade's grade, from the stored scoreboard, through the worker's own handler", async () => {
  const { handleFadeGrade } = await import("./routes-market.mjs");
  const board = { axes: [{ name: "funding_fade", verdict: "NOISE", r: { samples: 3905 }, random: { pooled: { verdict: "BELOW_RANDOM" } } }, { name: "other", verdict: "PREDICTIVE" }] };
  const asked = [];
  const r = await handleFadeGrade(["intel", "fade-grade"], req("/intel/fade-grade"), { dispatch: async (p) => { asked.push(p); return ok(board); } });
  const body = await r.json();
  assert.deepEqual(asked, ["/intel/axis-backtest"]);
  assert.equal(body.grade.tier, "NOISE");
  assert.equal(body.grade.samples, 3905);
  assert.equal(r.headers.get("Cache-Control"), "public, max-age=300");
  assert.ok(JSON.stringify(body).length < 200, "a few bytes, not the 200 KB board");
  const down = await handleFadeGrade(["intel", "fade-grade"], req("/intel/fade-grade"), { dispatch: async () => new Response("x", { status: 503 }) });
  assert.deepEqual(await down.json(), { grade: null });
  assert.equal(await handleFadeGrade(["intel", "market"], req("/intel/market"), { dispatch: async () => ok({}) }), null);
});

test("Lab home reads the slim grade, not the whole scoreboard", () => {
  const hook = readFileSync(new URL("../../app/pages/lab/useFadeFamilyGrade.ts", import.meta.url), "utf8");
  assert.match(hook, /\/intel\/fade-grade/);
  assert.doesNotMatch(hook, /axis-backtest"/);
});

test("/intel/markets: the watchlist in one request, three boards read once, cached 60 s", async () => {
  const { handleMarkets, MARKETS_SOURCES } = await import("./routes-market.mjs");
  const env = { LAB_STORE: kv() };
  const asked = [];
  const boards = {
    "/intel/mispriced": { markets: [{ coin: "ETH", markPrice: 1852.3, change24hPct: -5.5, stretched: true, fundingAnnualPct: 21 }] },
    "/smart/consensus": { consensus: { ETH: { long: 2, short: 9 } } },
    "/intel/forecasts": { markets: [{ id: "m1", coin: "ETH", forecastProbPct: 58, question: "q", volumeUsd: 5 }] },
  };
  const dispatch = async (p) => { asked.push(p); return ok(boards[p]); };
  const r = await handleMarkets(["intel", "markets"], req("/intel/markets?coins=eth,BTC,eth"), env, { dispatch, now: 10 });
  const body = await r.json();
  assert.deepEqual(asked.sort(), Object.values(MARKETS_SOURCES).sort());
  assert.deepEqual(body.coins.map((c) => c.coin), ["ETH", "BTC"]);
  assert.equal(body.coins[0].price, 1852.3);
  assert.equal(body.coins[0].snap.stretched, true);
  assert.equal(body.coins[0].snap.smartSide, "SHORT");
  assert.equal(body.coins[1].price, null, "a coin the boards don't carry reads null, never invented");
  asked.length = 0;
  await handleMarkets(["intel", "markets"], req("/intel/markets?coins=BTC,ETH"), env, { dispatch, now: 50_000 });
  assert.equal(asked.length, 0, "same coin set, either order, served from cache");
  const bad = await handleMarkets(["intel", "markets"], req("/intel/markets"), env, { dispatch });
  assert.equal(bad.status, 400);
  assert.equal(await handleMarkets(["intel", "market", "ETH"], req("/intel/market/ETH"), env, { dispatch }), null);
});
