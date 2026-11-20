// Parity events for a REGISTERED_READ config (house paper runs): the events the scoreboard grades, from every series it
// loads, with BTC's set as context, as axisbt buildEvents calls the generator. Before 2026-11-20 parityEvents loaded only
// the series level_reclaim / oi_div_reversal_4h need, so a house run's parity would have seen no events and read DRIFT.
// Fake KV, synthetic tapes; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parityEvents } from "./parityEvents.mjs";
import { AXES, priceByHour, btcRegimeByHour, priceSeries, candlesByHour } from "./axisbt.mjs";
import { READ_SERIES } from "./registeredReadLive.mjs";
import { housePaperConfig } from "../../app/lib/housePaper.mjs";

const H = 3600000, T0 = Date.UTC(2026, 8, 1), N = 1100;
function tape(seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  let p = 100, oi = 1000, bx = 0;
  const out = { oiHist: [], candleHist: [], cvdHist: [], spotCvdHist: [], basisHist: [], smHist: [], liqHist: [] };
  for (let i = 0; i < N; i++) {
    const o = p; p *= 1 + (rnd() - 0.5) * 0.02 * (i % 300 < 60 ? 0.3 : 1.5);
    oi *= Math.floor(i / 24) % 5 === 0 ? 1 : 1 + (rnd() - 0.5) * 0.03;
    out.candleHist.push({ t: T0 + i * H, o, h: Math.max(o, p) * 1.003, l: Math.min(o, p) * 0.997, c: p, v: 50 + rnd() * 400 });
    out.oiHist.push({ t: T0 + i * H + 120000, price: p, oi, funding: (rnd() - 0.5) * 0.0006 });
    out.cvdHist.push({ t: T0 + i * H + 300000, buy: Math.round(rnd() * 100), sell: Math.round(rnd() * 100) });
    out.spotCvdHist.push({ t: T0 + i * H + 300000, buy: Math.round(rnd() * 100), sell: Math.round(rnd() * 100) });
    bx += (rnd() - 0.5) * 0.02; out.basisHist.push({ t: T0 + i * H + 300000, basisPct: bx });
    const long = Math.floor(rnd() * 8), short = Math.floor(rnd() * 8);
    if (Math.max(long, short) >= 2) out.smHist.push({ t: T0 + i * H + 600000, side: long >= short ? "LONG" : "SHORT", long, short });
  }
  return out;
}
const TAPES = { BTC: tape(1600), ETH: tape(7), SOL: tape(11) };
function fakeKV() {
  const m = new Map();
  for (const [coin, t] of Object.entries(TAPES)) for (const [k, keyOf] of Object.entries(READ_SERIES)) m.set(keyOf(coin), JSON.stringify(t[k]));
  return { get: async (k) => (m.has(k) ? m.get(k) : null) };
}
// the scoreboard's call on the same sets (axisbt buildEvents)
function referee(axis, coins) {
  const gen = AXES.find((a) => a.name === axis).gen;
  const btc = { coin: "BTC", ...TAPES.BTC };
  const bs = priceSeries(btc);
  const ctx = { btcMap: btcRegimeByHour(bs), btcPrice: priceByHour(bs), btcCandles: candlesByHour(btc.candleHist) };
  return coins.flatMap((coin) => (gen({ coin, ...TAPES[coin] }, priceByHour(TAPES[coin].oiHist), ctx) || []).map((e) => ({ coin, t: e.t, side: e.side })));
}
const key = (e) => `${e.coin}|${e.t}|${e.side}`;

test("a house run's parity events are the scoreboard's events, read by read", async () => {
  for (const axis of ["btc_lead_lag", "spot_absorb", "smart_consensus_2x", "funding_basis_split", "session_fade", "rsi_reset_deep"]) {
    const config = { ...housePaperConfig(axis), symbols: ["PERP_ETH_USDC", "PERP_SOL_USDC"] };
    const got = (await parityEvents(fakeKV(), config, axis)).map(key).sort();
    const want = referee(axis, ["ETH", "SOL"]).map(key).sort();
    assert.ok(want.length > 0, `${axis}: the tape must make it fire`);
    assert.deepEqual(got, want, axis);
  }
});

test("BTC is read as context even when it isn't traded, and never returned unless traded", async () => {
  const config = { ...housePaperConfig("btc_lead_lag"), symbols: ["PERP_ETH_USDC"] };
  const got = await parityEvents(fakeKV(), config, "btc_lead_lag");
  assert.ok(got.length > 0, "the alt needs BTC's tape to fire at all");
  assert.ok(got.every((e) => e.coin === "ETH"));
});
