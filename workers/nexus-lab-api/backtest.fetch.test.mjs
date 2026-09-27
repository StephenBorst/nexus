// Run: node --test workers/nexus-lab-api/backtest.fetch.test.mjs
// Orderly's edge sometimes answers a Worker with an HTML challenge page. One such page used to
// fail a whole PRO backtest ("Unexpected token '<'"). These pin the retry, the headers, and the
// rule that a page we couldn't read FAILS the run instead of leaving a silent gap in the candles.
import test from "node:test";
import assert from "node:assert/strict";
import { orderlyJson, fetchCandles, fetchFundingAt } from "./backtest.mjs";

const HTML = "<!doctype html><html><title>Just a moment...</title></html>";
// Same contract as a real Response: .json() throws on a body that isn't JSON (an HTML page).
const res = (body, status = 200) => ({ status, json: async () => JSON.parse(body) });

function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = real; });
}

// Hourly bars for [from, to) in the tv/history shape.
function tvBars(url) {
  const q = new URL(url).searchParams;
  const from = Number(q.get("from")), to = Number(q.get("to"));
  const t = [];
  for (let x = Math.ceil(from / 3600) * 3600; x < to; x += 3600) t.push(x);
  return JSON.stringify({ s: "ok", t, o: t.map(() => 1), h: t.map(() => 1), l: t.map(() => 1), c: t.map(() => 1) });
}

test("a challenge page is retried, and the retry's JSON is used", () => withFetch((() => {
  let n = 0;
  return async (url, init) => {
    n += 1;
    assert.match(init.headers["User-Agent"], /Mozilla/, "browser-like headers on every call");
    assert.match(init.headers.Accept, /application\/json/);
    return n === 1 ? res(HTML, 403) : res(JSON.stringify({ ok: n }));
  };
})(), async () => {
  assert.deepEqual(await orderlyJson("https://api-evm.orderly.org/x", { waitMs: 0 }), { ok: 2 });
}));

test("a network error is retried too", () => withFetch((() => {
  let n = 0;
  return async () => { n += 1; if (n === 1) throw new Error("socket hang up"); return res("{\"fine\":true}"); };
})(), async () => {
  assert.deepEqual(await orderlyJson("https://api-evm.orderly.org/x", { waitMs: 0 }), { fine: true });
}));

test("still a challenge after the retries → a readable error, not \"Unexpected token '<'\"", () => withFetch(async () => res(HTML, 403), async () => {
  await assert.rejects(orderlyJson("https://api-evm.orderly.org/x", { waitMs: 0 }), (e) => {
    assert.match(e.message, /Orderly didn't return market data \(HTTP 403, not JSON\)\. Try again in a minute\./);
    assert.doesNotMatch(e.message, /Unexpected token/);
    return true;
  });
}));

test("fetchCandles: one challenged page is retried, and the series has no gap", () => withFetch((() => {
  let challenged = false;
  return async (url) => {
    const from = Number(new URL(url).searchParams.get("from"));
    // Challenge the SECOND 20-day page once.
    if (!challenged && from > Math.floor(Date.now() / 1000) - 45 * 86400) { challenged = true; return res(HTML, 403); }
    return res(tvBars(url));
  };
})(), async () => {
  const candles = await fetchCandles("PERP_BTC_USDC", 30);
  assert.ok(candles.length >= 30 * 24 - 2, `≈ every hour of 30 days (${candles.length})`);
  for (let i = 1; i < candles.length; i++) assert.equal(candles[i].t - candles[i - 1].t, 3600, "no hole where the challenged page was");
}));

test("fetchCandles: a page that never comes back fails the run instead of returning a gapped series", () => withFetch((() => {
  return async (url) => {
    const from = Number(new URL(url).searchParams.get("from"));
    return from > Math.floor(Date.now() / 1000) - 25 * 86400 ? res(HTML, 403) : res(tvBars(url));
  };
})(), async () => {
  await assert.rejects(fetchCandles("PERP_BTC_USDC", 30), /Orderly didn't return market data/);
}));

test("fetchFundingAt goes through the same guard", () => withFetch((() => {
  let n = 0;
  return async () => { n += 1; return n === 1 ? res(HTML, 403) : res(JSON.stringify({ data: { rows: [{ funding_rate_timestamp: 1000, funding_rate: 0.0001 }] } })); };
})(), async () => {
  const f = await fetchFundingAt("PERP_BTC_USDC");
  assert.equal(f.rows.length, 1);
  assert.equal(f.at(2), 0.0001);
}));
