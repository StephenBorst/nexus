// House paper runs: the brain's REGISTERED_READ mode runs the scoreboard's OWN generator for a read. Parity, read by
// read: ticked through the tape on only what the brain has stored by each tick, it fires exactly the newest event the
// scoreboard grades in the hour before the tick (the same call shape as axisbt buildEvents), and nothing else.
// Synthetic tapes only; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  registeredReadLive, registeredReadRefusal, seenAt, BRAIN_READS, BRAIN_GENS, READ_LIVE, READ_SERIES, REGISTERED_READ_MODE,
} from "./registeredReadLive.mjs";
import { rsiResetDeepEvents, rsiResetDeepAtStamp } from "../../app/lib/rsiReset.mjs";
import { EXPLORER_GENS } from "./explorerReads.mjs";
import { AXES, btcRegimeByHour, priceSeries, candlesByHour } from "./axisbt.mjs";
import { priceByHour } from "../../app/lib/basisStack.mjs";
import { REGISTERED_READS } from "../../app/lib/readPipeline.mjs";
import { deriveSignal, signalSourceT } from "../nexus-agent-brain/logic.mjs";
import { brainSignalKey } from "../nexus-agent-exec/logic.mjs";
import { axisForConfig } from "../../app/lib/paperParity.mjs";

const H = 3600000;
const T0 = Date.UTC(2026, 8, 1); // a Tuesday, UTC midnight
const N = 1100; // hours: past the 30-day windows, with ~15 days of events after them

// Every series a coin set carries, seeded. `drift` < 0.5 tilts the tape down; volume spikes a quarter of the bars,
// so the shelf breakdown (a down-tape read on 1.5× volume) can fire too.
function tape(seed, drift = 0.5) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  let p = 100, oi = 1000;
  const oiHist = [], candleHist = [], cvdHist = [], spotCvdHist = [], basisHist = [], smHist = [], liqHist = [];
  let bx = 0;
  for (let i = 0; i < N; i++) {
    const o = p;
    p *= 1 + (rnd() - drift) * 0.02 * (i % 300 < 60 ? 0.3 : 1.5);
    oi *= Math.floor(i / 24) % 5 === 0 ? 1 : 1 + (rnd() - 0.5) * 0.03;
    const hi = Math.max(o, p) * (1 + rnd() * 0.006), lo = Math.min(o, p) * (1 - rnd() * 0.006);
    candleHist.push({ t: T0 + i * H, o, h: hi, l: lo, c: p, v: 50 + rnd() * 100 * (rnd() < 0.25 ? 5 : 1) });
    oiHist.push({ t: T0 + i * H + 120000, price: p, oi, funding: (rnd() - 0.5) * 0.0006 });
    cvdHist.push({ t: T0 + i * H + 300000, buy: Math.round(rnd() * 100), sell: Math.round(rnd() * 100) });
    spotCvdHist.push({ t: T0 + i * H + 300000, buy: Math.round(rnd() * 100), sell: Math.round(rnd() * 100) });
    bx += (rnd() - 0.5) * 0.02;
    basisHist.push({ t: T0 + i * H + 300000, basisPct: bx });
    const long = Math.floor(rnd() * 8), short = Math.floor(rnd() * 8);
    if (Math.max(long, short) >= 2) smHist.push({ t: T0 + i * H + 600000, side: long >= short ? "LONG" : "SHORT", long, short });
  }
  return { oiHist, candleHist, cvdHist, spotCvdHist, basisHist, smHist, liqHist };
}
// A quiet falling tape (explorerReads.test.mjs's shelf tape, cut to N hours) for the shelf breakdown, which is rare by
// design (four gates, down regime only); its OI rows ride the same closes so the coin has a price spine.
function shelfCoin(seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  let p = 100;
  const candleHist = Array.from({ length: N }, (_, i) => {
    const o = p; p *= 1 + (rnd() - 0.55) * 0.02;
    return { t: T0 + i * H, o, h: Math.max(o, p) * (1 + rnd() * 0.003), l: Math.min(o, p) * (1 - rnd() * 0.003), c: p, v: 50 + rnd() * 100 * (rnd() < 0.25 ? 5 : 1) };
  });
  const base = tape(seed);
  return { ...base, candleHist, oiHist: base.oiHist.map((r, i) => ({ ...r, price: candleHist[i].c })) };
}
const SETS = [
  { coin: "BTC", ...tape(1600) },
  { coin: "ETH", ...tape(7) },
  { coin: "SOL", ...tape(11, 0.55) },
  { coin: "ARB", ...tape(2026, 0.45) },
  { coin: "DOGE", ...shelfCoin(11) },
];

// The referee: the scoreboard's call (axisbt buildEvents) on the FULL tape: a coin with an OI price spine, the
// generator given (coinSet, priceByHour(oiHist), ctx) with BTC's context exactly as buildEvents builds it.
function graded(gen, sets) {
  const btc = sets.find((c) => c.coin === "BTC");
  const btcSeries = priceSeries(btc);
  const ctx = { btcMap: btcRegimeByHour(btcSeries), btcPrice: priceByHour(btcSeries), btcCandles: candlesByHour(btc.candleHist) };
  const out = {};
  for (const cs of sets) {
    const pmap = priceByHour(cs.oiHist);
    out[cs.coin] = pmap.size < 2 ? [] : (gen(cs, pmap, ctx) || []).filter((e) => e.side === "LONG" || e.side === "SHORT");
  }
  return out;
}
// What the live gate must say at `now` for one coin: the newest graded event in the hour up to now, else none.
function expected(events, now) {
  const fresh = events.filter((e) => e.t <= now && now - e.t < READ_LIVE.maxAgeMs);
  if (!fresh.length) return null;
  const e = fresh.reduce((a, b) => (b.t >= a.t ? b : a));
  return { side: e.side, t: e.t };
}
const verdict = (v) => (v && v.side ? { side: v.side, t: v.t } : null);

test("the mode runs every registered read, each on the body the scoreboard grades", () => {
  const registered = new Set(REGISTERED_READS.map((r) => r.axis));
  assert.deepEqual([...BRAIN_READS].sort(), [...registered].sort(), "every registered read, nothing else");
  for (const r of BRAIN_READS) {
    if (r === "rsi_reset_deep") {
      // the shared rule (app/lib/rsiReset.mjs), at each event's own row (rsiReset.test.mjs)
      assert.equal(AXES.find((a) => a.name === r)?.gen, rsiResetDeepEvents);
      assert.equal(BRAIN_GENS[r], rsiResetDeepAtStamp);
      continue;
    }
    assert.equal(AXES.find((a) => a.name === r)?.gen, EXPLORER_GENS[r], `${r}: the scoreboard grades this very body`);
    assert.equal(BRAIN_GENS[r], EXPLORER_GENS[r]);
  }
});

test("the coin set carries every series the scoreboard loads, under the same KV keys", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const load = src.slice(src.indexOf("async function buildAxisScorecard"), src.indexOf("// Main card: the twelve"));
  assert.match(load, /coinSets\.push\(\{ coin, oiHist, cvdHist, smHist, candleHist, basisHist, liqHist, spotCvdHist \}\)/);
  for (const [k, keyOf] of Object.entries(READ_SERIES)) {
    const key = keyOf("ETH").replace("ETH", "${coin}");
    assert.ok(load.includes(`readJson(AGENT_KV, \`${key}\`)`), `${k}: ${key}`);
  }
  // the referee above copies buildEvents's call: pin that call so a change there fails here
  const ax = readFileSync(new URL("./axisbt.mjs", import.meta.url), "utf8");
  // (2026-11-21: the build caches each coin's maps, the BTC context and each read's run; the call itself is unchanged)
  const be = ax.slice(ax.indexOf("const _coinMaps = new WeakMap();"), ax.indexOf("export function eventsWithR"));
  assert.match(be, /const pmapOf = \(cs\) => \(coinMaps\(cs\)\.pmap \?\?= priceByHour\(cs\.oiHist\)\);/);
  assert.match(be, /c = \{ btcMap: btcRegimeByHour\(btcSeries\), btcPrice: priceByHour\(btcSeries\), btcCandles: candlesByHour\(btcCs\.candleHist\) \};/);
  assert.match(be, /const btcSeries = priceSeries\(btcCs\);/);
  assert.match(be, /gen\(cs, pmapOf\(cs\), btcCtxOf\(btcCs\)\)/);
  assert.match(be, /const pmap = pmapOf\(cs\);\s+if \(pmap\.size < 2\) return;/);
  assert.match(be, /genEventsOf\(signalGen, cs, btcCs\)/);
  // the brain passes BTC's candles only: no shared body reads the other two context fields
  const er = readFileSync(new URL("./explorerReads.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(er, /btcMap|btcPrice/);
});

test("parity, read by read: ticked hour by hour on what the brain has stored, it fires exactly the graded events", () => {
  for (const read of BRAIN_READS) {
    const ref = graded(AXES.find((a) => a.name === read).gen, SETS); // what the scoreboard grades
    const all = Object.entries(ref).flatMap(([coin, ev]) => ev.map((e) => ({ ...e, coin })));
    assert.ok(all.length > 0, `${read}: the tape must make it fire`);
    // ticks: 3 minutes after up to 40 events (spread across the tape), plus 25 hours spread across the tape
    const step = Math.max(1, Math.floor(all.length / 40));
    // (from hour 72 on: two whole-history guards decide on a coin's TOTAL row count, not the rows up to the event: the
    // OI spine needs 2 rows (buildEvents) and rsi_reset_deep 69, so on the full tape the scoreboard can stamp an event
    // in the first hours that the brain, holding fewer rows then, can't yet; a real coin has months of history)
    const WARM = T0 + 72 * H;
    const ticks = new Set(all.filter((e) => e.t + 3 * 60000 >= WARM).filter((_, i) => i % step === 0).map((e) => e.t + 3 * 60000));
    for (let k = 0; k < 25; k++) ticks.add(T0 + Math.floor(((k + 0.5) / 25) * N) * H + 5 * 60000);
    let fired = 0;
    for (const now of ticks) {
      const live = registeredReadLive(read, SETS, now);
      for (const cs of SETS) {
        const want = expected(ref[cs.coin], now);
        assert.deepEqual(verdict(live[cs.coin]), want, `${read} ${cs.coin} at +${(now - T0) / H}h`);
        if (want) { fired++; assert.ok(live[cs.coin].reason.startsWith(`${read} · `)); }
        else assert.ok(typeof live[cs.coin].reason === "string" && live[cs.coin].reason.length > 0);
      }
    }
    assert.ok(fired > 0, `${read}: some tick fired`);
  }
});

test("only what the brain has by now counts: a bar still forming and any later row are ignored", () => {
  const now = T0 + 500 * H + 10 * 60000;
  const cs = seenAt(SETS[1], now);
  assert.equal(Math.max(...cs.candleHist.map((c) => c.t)), T0 + 499 * H, "the 500h bar is still forming");
  assert.ok(cs.oiHist.every((r) => r.t <= now) && cs.oiHist.some((r) => r.t === T0 + 500 * H + 120000));
  for (const k of Object.keys(READ_SERIES)) assert.ok(Array.isArray(cs[k]), k);
  // poison everything after now: the verdict is unchanged
  const poisoned = SETS.map((s) => ({
    ...s,
    candleHist: s.candleHist.map((c) => (c.t + H > now ? { ...c, o: c.o * 3, h: c.h * 3, l: c.l * 0.2, c: c.c * 0.3 } : c)),
    oiHist: s.oiHist.map((r) => (r.t > now ? { ...r, price: r.price * 3, oi: r.oi * 0.1 } : r)),
  }));
  for (const read of BRAIN_READS) assert.deepEqual(registeredReadLive(read, poisoned, now), registeredReadLive(read, SETS, now), read);
});

test("no OI spine, stale history and an unknown read sit out with the reason", () => {
  const now = T0 + 800 * H + 5 * 60000;
  const noOi = registeredReadLive("level_reclaim", [{ coin: "ETH", candleHist: SETS[1].candleHist }], now);
  assert.deepEqual(noOi.ETH, { side: null, t: null, reason: "no OI history recorded" });
  const later = T0 + N * H + 5 * H;
  assert.match(registeredReadLive("session_fade", SETS, later).ETH.reason, /^history stale \(\d+h\)$/);
  assert.throws(() => registeredReadLive("vol_breakout", SETS, now), /not a registered read/);
});

test("paper only, no inverted read, no unknown read", () => {
  const paper = { mode: "PAPER", signalMode: REGISTERED_READ_MODE, read: "session_fade" };
  assert.equal(registeredReadRefusal(paper), null);
  assert.match(registeredReadRefusal({ ...paper, mode: "AUTONOMOUS" }), /paper only/);
  assert.match(registeredReadRefusal({ ...paper, mode: "ASSISTED" }), /paper only/);
  assert.match(registeredReadRefusal({ ...paper, invertSignal: true }), /new read/);
  assert.match(registeredReadRefusal({ ...paper, read: "basis_extreme" }), /not a registered read/);
  assert.match(registeredReadRefusal({ ...paper, read: undefined }), /^no read /);
  assert.equal(registeredReadRefusal({ mode: "AUTONOMOUS", signalMode: "CONFLUENCE" }), null, "other modes are not this rule's");
});

test("the brain trades the verdict as given, takes each event once, and refuses anything but paper", () => {
  const cfg = { mode: "PAPER", signalMode: "REGISTERED_READ", read: "session_fade", symbols: ["PERP_ETH_USDC"] };
  const t = T0 + 900 * H;
  const raw = { symbol: "PERP_ETH_USDC", price: 100, registeredReads: { session_fade: { side: "SHORT", t, reason: "session_fade · NY open drive (13–15 UTC), faded" } } };
  const sig = deriveSignal(raw, cfg);
  assert.equal(sig.direction, "SHORT");
  assert.equal(signalSourceT(raw, cfg), t, "sourceT = the event's time");
  assert.equal(brainSignalKey({ symbol: "PERP_ETH_USDC", direction: "SHORT", sourceT: t }), brainSignalKey({ symbol: "PERP_ETH_USDC", direction: "SHORT", sourceT: t }));
  assert.notEqual(brainSignalKey({ symbol: "PERP_ETH_USDC", direction: "SHORT", sourceT: t }), brainSignalKey({ symbol: "PERP_ETH_USDC", direction: "SHORT", sourceT: t + H }));
  // another read's verdict on the same market is not this config's
  assert.equal(deriveSignal(raw, { ...cfg, read: "level_reclaim_tight" }).direction, "NONE");
  assert.equal(deriveSignal(raw, { ...cfg, mode: "AUTONOMOUS" }).direction, "NONE");
  assert.match(deriveSignal(raw, { ...cfg, mode: "AUTONOMOUS" }).reason || "", /paper only/);
  assert.equal(deriveSignal(raw, { ...cfg, invertSignal: true }).direction, "NONE");
  assert.match(deriveSignal({ ...raw, registeredReads: undefined }, cfg).reason || "", /not computed — sat out/);
  const quiet = { ...raw, registeredReads: { session_fade: { side: null, t: null, reason: "no session_fade event this hour" } } };
  assert.equal(deriveSignal(quiet, cfg).direction, "NONE");
  assert.equal(signalSourceT(quiet, cfg), null);
  // parity explains a paper wallet on this mode against the read it names
  assert.equal(axisForConfig(cfg), "session_fade");
  assert.equal(axisForConfig({ ...cfg, read: "../x" }), null);
  assert.equal(axisForConfig({ ...cfg, invertSignal: true }), null);
});

test("the brain computes it only behind REGISTERED_READ_PAPER, for paper configs, once a tick per read", () => {
  const src = readFileSync(new URL("../nexus-agent-brain/index.js", import.meta.url), "utf8");
  assert.match(src, /env\.REGISTERED_READ_PAPER === "true"/);
  assert.match(src, /config\.signalMode === REGISTERED_READ_MODE && !registeredReadRefusal\(config\)/);
  assert.match(src, /for \(const read of readsInUse\) \{[\s\S]{0,80}registeredReadLive\(read, readable\)/);
  const toml = readFileSync(new URL("../nexus-agent-brain/wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /^REGISTERED_READ_PAPER = "true"$/m);
  // no live lift for this mode: the module never names one
  const mod = readFileSync(new URL("./registeredReadLive.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(mod, /import[^;]*liveLift/);
});
