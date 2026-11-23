// Daily bars for the forecast board's base rates (forecastBars.mjs). Run: node --test workers/nexus-lab-api/forecastBars.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { loadForecastBars, forecastBarsKey, FORECAST_BARS_TTL_MS } from "./forecastBars.mjs";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const kvOf = (m = new Map()) => ({ m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } });
const tv = (days) => ({ s: "ok", t: Array.from({ length: days }, (_, i) => Math.floor((NOW - (days - i) * 86400000) / 1000)),
  h: Array(days).fill(101), l: Array(days).fill(99), c: Array(days).fill(100) });
const noWait = { mapOpts: { gapMs: 0 } };

test("reads each coin once, caches it, and serves the cache inside 6h", async () => {
  const kv = kvOf(); const calls = [];
  const get = async (url) => { calls.push(url); return tv(400); };
  const a = await loadForecastBars(kv, ["BTC", "btc", "ETH"], { now: NOW, get, ...noWait });
  assert.deepEqual(Object.keys(a).sort(), ["BTC", "ETH"]);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /resolution=D/);
  const b = await loadForecastBars(kv, ["BTC"], { now: NOW + FORECAST_BARS_TTL_MS - 1, get, ...noWait });
  assert.equal(calls.length, 2, "cached");
  assert.equal(b.BTC.length, a.BTC.length);
  await loadForecastBars(kv, ["BTC"], { now: NOW + FORECAST_BARS_TTL_MS + 1, get, ...noWait });
  assert.equal(calls.length, 3, "stale after 6h");
});

test("a failed or empty read leaves the coin out (no lean), never throws", async () => {
  const kv = kvOf();
  const out = await loadForecastBars(kv, ["BTC", "ETH", "bad coin!"], {
    now: NOW, ...noWait, get: async (url) => { if (url.includes("BTC")) throw new Error("429"); return { s: "no_data" }; },
  });
  assert.deepEqual(out, {});
  assert.equal(kv.m.get(forecastBarsKey("ETH")), undefined, "nothing cached on an empty read");
});
