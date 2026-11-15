// GET /intel/funding-venues (routes-venues.mjs). Run: node --test workers/nexus-lab-api/routes-venues.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleVenues, composeVenues, VENUES_CACHE_KEY } from "./routes-venues.mjs";

const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const req = (p) => new Request(`https://og.nexustradinglabs.com${p}`);
const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
const T0 = 1_700_000_000_000;
const dispatch = async (p) => (p === "/intel/mispriced" ? ok({ markets: [{ coin: "ETH", fundingAnnualPct: 11 }, { coin: "XAU", fundingAnnualPct: -149 }] }) : new Response("x", { status: 404 }));
const fetchImpl = async (url) => {
  if (url.includes("hyperliquid")) return ok([{ universe: [{ name: "ETH" }] }, [{ funding: "0.00001" }]]);
  if (url.includes("instId=ETH-USDT-SWAP")) return ok({ code: "0", data: [{ fundingRate: "0.0001", fundingTime: String(T0), nextFundingTime: String(T0 + 8 * 3.6e6) }] });
  return ok({ code: "51001", data: [] });
};

test("composes Orderly, Hyperliquid and OKX; OKX only for coins Orderly lists and we record", async () => {
  const asked = [];
  const b = await composeVenues({ dispatch, fetchImpl: async (u, i) => { asked.push(u); return fetchImpl(u, i); }, sleep: async () => {} });
  const eth = b.rows.find((r) => r.coin === "ETH");
  assert.deepEqual(eth, { coin: "ETH", orderly: 11, hyperliquid: 8.76, okx: 10.95, gap: 1.14 });
  assert.equal(b.rows.find((r) => r.coin === "XAU").gap, null);
  assert.ok(!asked.some((u) => u.includes("XAU")), "never asks OKX for a coin outside the recorded universe");
  assert.deepEqual(b.unread, []);
});

test("a dead venue is named unread, its column null; served per coin; cached 5 min", async () => {
  const env = { LAB_STORE: kv() };
  const dead = async (u, i) => (u.includes("hyperliquid") ? new Response("x", { status: 500 }) : fetchImpl(u, i));
  const r = await handleVenues(["intel", "funding-venues", "eth"], req("/intel/funding-venues/eth"), env, { dispatch, fetchImpl: dead, sleep: async () => {}, now: 10 });
  const body = await r.json();
  assert.equal(body.row.hyperliquid, null);
  assert.deepEqual(body.unread, ["hyperliquid"]);
  assert.ok(env.LAB_STORE.m.has(VENUES_CACHE_KEY));
  let called = 0;
  await handleVenues(["intel", "funding-venues"], req("/intel/funding-venues"), env, { dispatch: async () => { called++; return ok({}); }, fetchImpl: async () => { called++; return ok({}); }, now: 60_000 });
  assert.equal(called, 0, "served from the cache");
  assert.equal(await handleVenues(["intel", "market"], req("/intel/market"), env, {}), null);
});

test("index.js routes it through the worker's own handler", () => {
  assert.match(readFileSync(new URL("./index.js", import.meta.url), "utf8"), /handleVenues\(parts, request, env, \{\s*dispatch: \(path\) => worker\.fetch\(/);
});
