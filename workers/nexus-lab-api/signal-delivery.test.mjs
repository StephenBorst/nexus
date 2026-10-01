// The regime snapshot's 4H EMA8/EMA21, end to end: Orderly answers resolution 240 with no_data (it
// serves no 4H candles), so the levels must come from 1H candles built into 4H bars. Fake fetch +
// fake KV; never the network.
import test from "node:test";
import assert from "node:assert/strict";
import { snapshotTrendRegimes, computeSignalRows } from "./signal-delivery.mjs";
import { buildSignals } from "../../app/lib/signals.mjs";
import { fakeTvHistory } from "../../app/lib/__fixtures__/fakeTvHistory.mjs";

function fakeKV(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, map: m };
}

// A steady uptrend (+0.1%/h) so classifyRegime reads TREND_UP and the EMAs sit below the mark.
const price = (t) => 50000 * Math.exp(0.001 * (t / 3600 - 490000));

function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = handler(String(url));
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  };
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = real; });
}

test("regime snapshot: 4H EMA8/EMA21 are non-null while Orderly answers 240 with no_data", async () => {
  const tv = fakeTvHistory({ price });
  const KV = fakeKV({ "market:prev:PERP_BTC_USDC": JSON.stringify({ price: 1, oi: 1000 }) });
  const env = { NEXUS_AGENT: KV };
  const nowSec = Math.floor(Date.now() / 1000);
  // Futures rows for /signals (the proxy path), with the mark at the latest hourly close.
  const futures = { data: { rows: ["BTC", "ETH", "SOL", "ARB", "HYPE", "XRP", "DOGE"].map((c) => ({
    symbol: `PERP_${c}_USDC`, mark_price: price(Math.floor(nowSec / 3600) * 3600), last_funding_rate: 0.00001, open_interest: 1000,
  })) } };
  await withFetch((url) => (url.includes("/tv/history") ? tv.get(url) : futures), async () => {
    assert.equal(await snapshotTrendRegimes(env), 7);
    // Second hourly run with OI up 5%: the momentum signal needs a rising-OI delta.
    await KV.put("market:prev:PERP_BTC_USDC", JSON.stringify({ price: 1, oi: 1050 }));
    assert.equal(await snapshotTrendRegimes(env), 7);
  });
  assert.ok(tv.calls.length > 0 && tv.calls.every((u) => !u.includes("resolution=240")), "nothing asks Orderly for 240");

  const reg = JSON.parse(KV.map.get("regime:BTC"));
  assert.equal(reg.trend, "TREND_UP");
  assert.ok(Number.isFinite(reg.ema8) && reg.ema8 > 0, `ema8 ${reg.ema8}`);
  assert.ok(Number.isFinite(reg.ema21) && reg.ema21 > 0, `ema21 ${reg.ema21}`);
  assert.ok(reg.ema8 > reg.ema21, "in an uptrend the fast EMA sits above the slow one");
  assert.equal(reg.oiChangePct, 5);

  // …and they reach the /signals row and the MOMENTUM signal's level note.
  const rows = await withFetch((url) => (url.includes("/tv/history") ? tv.get(url) : futures), () => computeSignalRows(env));
  const btc = rows.find((r) => r.symbol === "BTC");
  assert.equal(btc.ema8_4h, reg.ema8);
  assert.equal(btc.ema21_4h, reg.ema21);
  const mom = buildSignals({ signals: rows }).find((s) => s.kind === "MOMENTUM");
  assert.ok(mom, "a momentum signal");
  assert.match(mom.detail, /4H EMA8 \(\$[\d,]+\)/);
});

test("regime snapshot: a failed hourly page leaves the levels null, the trend still stored", async () => {
  // Fail only the EMA read (its 240-hour window); the 80-hour trend read still works.
  const isEmaRead = (u) => Number(u.searchParams.get("to")) - Number(u.searchParams.get("from")) === 240 * 3600;
  const tv = fakeTvHistory({ price, fail: isEmaRead });
  const KV = fakeKV();
  await withFetch((url) => tv.get(url), () => snapshotTrendRegimes({ NEXUS_AGENT: KV }));
  const reg = JSON.parse(KV.map.get("regime:BTC"));
  assert.equal(reg.trend, "TREND_UP");
  assert.equal(reg.ema8, null);
  assert.equal(reg.ema21, null);
});
