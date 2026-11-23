// Market alerts runner (marketWatch.mjs). Run: node --test workers/nexus-lab-api/marketWatch.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runMarketWatch, watchersByCoin, MARKET_SEEN_KEY } from "./marketWatch.mjs";
import { saveSubscription } from "./push.mjs";

// A real-shaped P-256 JWK so pushEnabled(env) is true (the runner never sends a push itself: notify is injected).
const JWK = JSON.stringify({ kty: "EC", crv: "P-256", x: "MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4", y: "4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM", d: "870MB6gfuTJ4HtUnUvYMyJpr5eUZNP4Bk43bVdj3eAE" });
const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; };
const sub = (n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/dev${n}`, keys: { p256dh: "BP".padEnd(87, "a"), auth: "auth".padEnd(22, "b") } });
const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
// No real network in tests: bars are injected (no bars = no lines = no move alert).
const noBars = { getBars: async () => [], mapOpts: { gapMs: 0 } };

const BOARD = (o) => ({
  "/intel/mispriced": { markets: [{ coin: "ETH", fundingAnnualPct: o.fund ?? 10, stretched: o.stretched ?? false }, { coin: "BTC", fundingAnnualPct: 5, stretched: false }] },
  "/smart/consensus": { consensus: { ETH: { long: o.L ?? 7, short: o.S ?? 10 } } },
  "/intel/forecasts": { markets: [] },
});

async function setup() {
  const env = { LAB_STORE: kv(), VAPID_PRIVATE_JWK: JWK };
  await saveSubscription(env, "0xaaa", sub(1), { markets: true }, ["eth"]);
  await saveSubscription(env, "0xbbb", sub(2), { markets: true }, ["BTC"]);
  await saveSubscription(env, "0xccc", sub(3), { markets: false }, ["ETH"]); // switch off: never told
  return env;
}

test("only devices with the markets switch on and a coin picked are watched", async () => {
  const env = await setup();
  const by = await watchersByCoin(env.LAB_STORE);
  assert.deepEqual(Object.fromEntries([...by].map(([c, w]) => [c, w])), { ETH: ["0xaaa"], BTC: ["0xbbb"] });
});

test("first run is a baseline; a change tells only the coin's watchers, once", async () => {
  const env = await setup();
  const sent = [];
  const notify = async (w, n) => { sent.push([w, n.type, n.message, n.url]); };
  let o = {};
  const dispatch = async (p) => ok(BOARD(o)[p] ?? {});

  const r1 = await runMarketWatch(env, notify, dispatch, { now: 1, ...noBars });
  assert.equal(r1.events, 0);
  assert.ok(env.LAB_STORE.m.has(MARKET_SEEN_KEY));

  o = { stretched: true, fund: 21, L: 1, S: 12 };
  const r2 = await runMarketWatch(env, notify, dispatch, { now: 2, ...noBars });
  assert.equal(r2.events, 2);
  assert.deepEqual(sent.map((x) => x[0]), ["0xaaa", "0xaaa"]);
  assert.ok(sent.every((x) => x[1] === "market_alert" && x[3] === "/lab?tab=intel&market=ETH"));
  assert.match(sent[0][2], /^ETH: funding stretched past its own range/);
  assert.match(sent[1][2], /^ETH: tracked traders now agree short/);

  sent.length = 0;
  await runMarketWatch(env, notify, dispatch, { now: 3, ...noBars });
  assert.equal(sent.length, 0, "no repeat while nothing changes");
});

test("unread boards fire nothing; push off = nothing read at all", async () => {
  const env = await setup();
  const sent = [];
  await runMarketWatch(env, async (w) => sent.push(w), async (p) => ok(BOARD({})[p]), { now: 1, ...noBars });
  await runMarketWatch(env, async (w) => sent.push(w), async () => new Response("x", { status: 503 }), { now: 2, ...noBars });
  assert.equal(sent.length, 0);
  let asked = 0;
  const off = await runMarketWatch({ LAB_STORE: kv() }, async () => {}, async () => { asked++; return ok({}); }, noBars);
  assert.equal(off.skipped, "off");
  assert.equal(asked, 0);
});

test("an unusual move by the coin's own lines: baseline first, then once per side per window", async () => {
  const env = await setup();
  const H = 3600_000, T = Date.parse("2026-11-23T12:00:00Z");
  let tail = [100, 100.2, 100.1, 100.3, 100.2];
  const getBars = async (_c, from, to) => {
    const out = [];
    for (let t = Math.floor(from / H) * H; t <= to - 4 * H; t += H) out.push({ t, c: 100 * (1 + 0.01 * Math.sin(t / H * 1.7)) });
    const base = Math.floor(to / H) * H - 4 * H;
    tail.forEach((c, k) => out.push({ t: base + k * H, c }));
    return out;
  };
  const sent = [];
  const notify = async (w, n) => { sent.push([w, n.message]); };
  const dispatch = async (p) => ok(BOARD({})[p] ?? {});
  await runMarketWatch(env, notify, dispatch, { now: T, getBars, mapOpts: { gapMs: 0 } });
  tail = [100, 102, 104, 106, 109];
  await runMarketWatch(env, notify, dispatch, { now: T + 5 * 60_000, getBars, mapOpts: { gapMs: 0 } });
  const moves = sent.filter((x) => /A move, not a signal\.$/.test(x[1]));
  assert.ok(moves.length >= 1, "the 9% jump fires");
  assert.match(moves[0][1], /^(ETH|BTC) rose 9\.0% in 4 hours: higher than \d+% of its 4-hour moves in the last 90 days/);
  const n = moves.length;
  await runMarketWatch(env, notify, dispatch, { now: T + 10 * 60_000, getBars, mapOpts: { gapMs: 0 } });
  assert.equal(sent.filter((x) => /A move, not a signal\.$/.test(x[1])).length, n, "same side inside the window: no repeat");
});

test("the cron runs it every 5th minute through the worker's own handler, with Telegram on", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /runMarketWatch\(env, \(w, n\) => appendNotification\(env, w, n\), dispatch\)/);
  assert.match(src, /const dispatch = \(path\) => worker\.fetch\(/);
});
