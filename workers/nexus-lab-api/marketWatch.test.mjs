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

  const r1 = await runMarketWatch(env, notify, dispatch, { now: 1 });
  assert.equal(r1.events, 0);
  assert.ok(env.LAB_STORE.m.has(MARKET_SEEN_KEY));

  o = { stretched: true, fund: 21, L: 1, S: 12 };
  const r2 = await runMarketWatch(env, notify, dispatch, { now: 2 });
  assert.equal(r2.events, 2);
  assert.deepEqual(sent.map((x) => x[0]), ["0xaaa", "0xaaa"]);
  assert.ok(sent.every((x) => x[1] === "market_alert" && x[3] === "/lab?tab=intel&market=ETH"));
  assert.match(sent[0][2], /^ETH: funding stretched past its own range/);
  assert.match(sent[1][2], /^ETH: tracked traders now agree short/);

  sent.length = 0;
  await runMarketWatch(env, notify, dispatch, { now: 3 });
  assert.equal(sent.length, 0, "no repeat while nothing changes");
});

test("unread boards fire nothing; push off = nothing read at all", async () => {
  const env = await setup();
  const sent = [];
  await runMarketWatch(env, async (w) => sent.push(w), async (p) => ok(BOARD({})[p]), { now: 1 });
  await runMarketWatch(env, async (w) => sent.push(w), async () => new Response("x", { status: 503 }), { now: 2 });
  assert.equal(sent.length, 0);
  let asked = 0;
  const off = await runMarketWatch({ LAB_STORE: kv() }, async () => {}, async () => { asked++; return ok({}); });
  assert.equal(off.skipped, "off");
  assert.equal(asked, 0);
});

test("the cron runs it every 5th minute through the worker's own handler, with Telegram on", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /runMarketWatch\(env, \(w, n\) => appendNotification\(env, w, n\), dispatch\)/);
  assert.match(src, /const dispatch = \(path\) => worker\.fetch\(/);
});
