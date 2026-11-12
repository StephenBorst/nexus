// The five explorer reads as borst defined them (2026-10-16). Behaviour on hand-built tapes, plus
// the no-lookahead property on a random tape: changing anything after time T never changes the
// events at or before T. Run: node --test workers/nexus-lab-api/explorerReads.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  oiDivReversalEvents, sessionMomentumEvents, levelReclaimEvents, confluenceFollowEvents,
  oiDivReversal4hEvents, oiCoilBreakEvents, EXPLORER_GENS, OI_DIV, OI_DIV_4H, OI_COIL, CONFLUENCE,
  sessionFadeEvents, levelReclaimTightEvents, spotAbsorbEvents, LEVEL_TIGHT, SPOT_ABSORB, SESSION,
  btcLeadLagEvents, LEAD_LAG, fundingBasisSplitEvents, SPLIT,
} from "./explorerReads.mjs";
import { hourBucket } from "../../app/lib/basisStack.mjs";
import { AXES } from "./axisbt.mjs";
import { REGISTERED_READS } from "../../app/lib/readPipeline.mjs";
import { powerCheck } from "../../tools/explorers/powerCheck.mjs";

const H = 3600000;
const T0 = Date.UTC(2026, 6, 1, 0, 0, 0);
const candle = (i, o, h, l, c) => ({ t: T0 + i * H, o, h, l, c, v: 1 });

test("an explorer is on the scoreboard only once registered, and every registration is graded", () => {
  const graded = new Set(AXES.map((a) => a.name));
  const registered = new Set(REGISTERED_READS.map((r) => r.axis));
  for (const n of Object.keys(EXPLORER_GENS)) assert.ok(!graded.has(n) || registered.has(n), `${n} is graded but not registered`);
  for (const n of registered) assert.ok(graded.has(n), `${n} is registered but not on the scoreboard`);
  assert.deepEqual(Object.keys(EXPLORER_GENS).sort(), ["confluence_follow", "level_reclaim", "level_reclaim_tight", "oi_coil_break", "oi_div_reversal", "oi_div_reversal_4h", "session_fade", "session_momentum", "spot_absorb"].concat("btc_lead_lag", "funding_basis_split").sort());
  assert.ok(!("vol_breakout" in EXPLORER_GENS), "dropped for v1");
});

test("oi_div_reversal: an extreme rally on falling OI → SHORT; the same rally on rising OI → nothing", () => {
  const n = 800;
  const mk = (oiEnd) => Array.from({ length: n }, (_, i) => {
    const last = i >= n - 24;                       // the final 24h: a +8% rally
    const price = last ? 100 * (1 + 0.08 * (i - (n - 25)) / 24) : 100 + Math.sin(i / 5) * 0.5;
    const oi = last ? 1000 * (1 + (oiEnd - 1) * (i - (n - 25)) / 24) : 1000;
    return { t: T0 + i * H, price, oi, funding: 0 };
  });
  const down = oiDivReversalEvents({ oiHist: mk(0.95) });
  assert.ok(down.length >= 1);
  assert.equal(down[down.length - 1].side, "SHORT");
  const up = oiDivReversalEvents({ oiHist: mk(1.05) }).filter((e) => e.t > T0 + (n - 24) * H);
  assert.equal(up.length, 0, "rising OI against the move does not fire");
});

test("oi_div_reversal: a drop on falling OI → LONG, and the 24h cooldown holds", () => {
  const n = 800;
  const rows = Array.from({ length: n }, (_, i) => {
    const k = i - (n - 48);
    const price = k >= 0 ? 100 * (1 - 0.1 * Math.min(k, 30) / 30) : 100 + Math.sin(i / 5) * 0.5;
    const oi = k >= 0 ? 1000 * (1 - 0.1 * Math.min(k, 30) / 30) : 1000;
    return { t: T0 + i * H, price, oi, funding: 0 };
  });
  const ev = oiDivReversalEvents({ oiHist: rows });
  assert.ok(ev.length >= 1 && ev.every((e) => e.side === "LONG"));
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].t - ev[i - 1].t >= OI_DIV.cooldownH * H);
});

test("session_momentum: a NY open drive bigger than its usual → that side at 15:00 UTC; a small one → nothing", () => {
  const days = 32, bars = [];
  for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++) {
    const i = d * 24 + h;
    let o = 100, c = 100;
    if (h === 13) { o = 100; c = d === days - 1 ? 101 : 100.1; }       // 13:00 bar
    if (h === 14) { o = c = d === days - 1 ? 102 : 100.2; }            // 14:00 bar closes at 15:00
    bars.push(candle(i, o, Math.max(o, c) + 0.1, Math.min(o, c) - 0.1, c));
  }
  const ev = sessionMomentumEvents({ candleHist: bars });
  const lastDay = ev.filter((e) => e.t >= T0 + (days - 1) * 24 * H);
  assert.equal(lastDay.length, 1);
  assert.equal(lastDay[0].side, "LONG");
  assert.equal(new Date(lastDay[0].t).getUTCHours(), 15);
  // every earlier day had the same +0.2% drive = the median, and "larger than" is strict
  assert.equal(ev.filter((e) => e.t < T0 + (days - 1) * 24 * H).length, 0);
});

test("level_reclaim: a sweep ≥0.4 H4 ATR under the prior-day low, closed back above within 6h → LONG", () => {
  // day 0..4: range 99..101 each day (H4 ATR ≈ 2%); day 5: sweep to 98.0 (PDL 99, 1.0 below ≈ 0.5 ATR) then reclaim
  const bars = [];
  for (let i = 0; i < 5 * 24; i++) bars.push(candle(i, 100, 101, 99, 100));
  const d5 = 5 * 24;
  bars.push(candle(d5, 100, 100.2, 98.0, 98.4));   // breach + sweep, closes below
  bars.push(candle(d5 + 1, 98.4, 99.5, 98.3, 99.3)); // closes back above 99 → reclaim
  for (let i = d5 + 2; i < d5 + 24; i++) bars.push(candle(i, 99.3, 99.6, 99.1, 99.3));
  const ev = levelReclaimEvents({ candleHist: bars });
  const day5 = ev.filter((e) => e.t >= T0 + d5 * H);
  assert.equal(day5.length, 1);
  assert.equal(day5[0].side, "LONG");
  assert.equal(day5[0].t, T0 + (d5 + 2) * H, "entry at the reclaim bar's close");
  // a shallow sweep (0.1 below) does not count
  const shallow = bars.map((c) => (c.t === T0 + d5 * H ? { ...c, l: 98.9 } : c));
  assert.equal(levelReclaimEvents({ candleHist: shallow }).filter((e) => e.t >= T0 + d5 * H).length, 0);
  // a reclaim 7h after the first breach is too late
  const late = bars.map((c, i) => (i === d5 + 1 ? { ...c, c: 98.5, h: 98.8 } : i > d5 && i < d5 + 7 ? { ...c, o: 98.5, h: 98.8, l: 98.3, c: 98.5 } : c));
  assert.equal(levelReclaimEvents({ candleHist: late }).filter((e) => e.t >= T0 + d5 * H).length, 0);
});

test("confluence_follow: funding and the OI rule agree → trade the other way; disagree → nothing", () => {
  const row = (i, price, oi, funding) => ({ t: T0 + i * H, price, oi, funding });
  // funding +0.02% (crowd long → CONFLUENCE says SHORT); price up + OI down → OI rule SHORT → agree → follow LONG
  const agree = confluenceFollowEvents({ oiHist: [row(0, 100, 1000, 0.0002), row(1, 101, 990, 0.0002)] });
  assert.deepEqual(agree.map((e) => e.side), ["LONG"]);
  // price up + OI up → OI rule LONG ≠ funding SHORT → nothing
  assert.equal(confluenceFollowEvents({ oiHist: [row(0, 100, 1000, 0.0002), row(1, 101, 1010, 0.0002)] }).length, 0);
  // funding under the default threshold → nothing
  assert.equal(confluenceFollowEvents({ oiHist: [row(0, 100, 1000, 0.00005), row(1, 101, 990, 0.00005)] }).length, 0);
  // a gap is not "the previous snapshot"
  assert.equal(confluenceFollowEvents({ oiHist: [row(0, 100, 1000, 0.0002), row(5, 101, 990, 0.0002)] }).length, 0);
  // the frozen 24h cooldown keeps only the first of consecutive hours (one funding episode = one event)
  const run = Array.from({ length: 6 }, (_, i) => row(i, 100 + i, 1000 - i, 0.0002));
  assert.equal(CONFLUENCE.cooldownH, 24);
  assert.equal(confluenceFollowEvents({ oiHist: run }).length, 1);
  assert.equal(confluenceFollowEvents({ oiHist: run }, null, null, { ...CONFLUENCE, cooldownH: 0 }).length, 5);
});

// a seeded random tape with funding/OI/candles, for the lookahead property
function tape(n, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  let p = 100, oi = 1000;
  const oiHist = [], candleHist = [];
  for (let i = 0; i < n; i++) {
    const o = p;
    p *= 1 + (rnd() - 0.5) * 0.02 * (i % 300 < 60 ? 0.3 : 1.5);
    oi *= 1 + (rnd() - 0.5) * 0.03;
    const hi = Math.max(o, p) * (1 + rnd() * 0.006), lo = Math.min(o, p) * (1 - rnd() * 0.006);
    candleHist.push({ t: T0 + i * H, o, h: hi, l: lo, c: p, v: 1 });
    oiHist.push({ t: T0 + i * H + 120000, price: p, oi, funding: (rnd() - 0.5) * 0.0006 });
  }
  // perp + spot CVD rows on their own generator, so the tape the older reads see is unchanged; OI is
  // flattened on every fifth day so spot_absorb's "OI flat" condition can occur.
  let f = (seed * 7919) >>> 0;
  const frnd = () => { f = (f * 1103515245 + 12345) >>> 0; return f / 2 ** 32; };
  const cvdHist = [], spotCvdHist = [];
  for (let i = 0; i < n; i++) {
    cvdHist.push({ t: T0 + i * H + 300000, buy: Math.round(frnd() * 100), sell: Math.round(frnd() * 100) });
    spotCvdHist.push({ t: T0 + i * H + 300000, buy: Math.round(frnd() * 100), sell: Math.round(frnd() * 100) });
  }
  for (const r of oiHist) if (Math.floor((r.t - T0) / H / 24) % 5 === 0) r.oi = 1000;
  // basis rows on their own generator too (funding_basis_split), so the older reads' tape is unchanged
  let g = (seed * 104729) >>> 0;
  const grnd = () => { g = (g * 22695477 + 1) >>> 0; return g / 2 ** 32; };
  const basisHist = [];
  let bx = 0;
  for (let i = 0; i < n; i++) { bx += (grnd() - 0.5) * 0.02; basisHist.push({ t: T0 + i * H + 300000, basisPct: bx }); }
  return { oiHist, candleHist, cvdHist, spotCvdHist, basisHist };
}

test("no lookahead: for every read, the future never changes past events", () => {
  // the alt under test is "ETH"; BTC's own tape (another seed) is the context btc_lead_lag reads, and it is
  // poisoned past the cut too. Reads that don't read BTC ignore the context.
  const full = { coin: "ETH", ...tape(1600) };
  const btcTape = tape(1600, 3);
  const ctxOf = (candles) => ({ btcCandles: new Map(candles.map((c) => [hourBucket(c.t), c])) });
  const ctx = ctxOf(btcTape.candleHist);
  for (const [name, gen] of Object.entries(EXPLORER_GENS)) {
    const all = gen(full, null, ctx);
    assert.ok(all.length > 0, `${name}: the tape must make it fire`);
    for (const cutH of [900, 1200, 1500]) {
      const cut = T0 + cutH * H;
      // poison everything after the cut, then compare events stamped at or before it
      const poisoned = {
        coin: "ETH",
        oiHist: full.oiHist.map((r) => (r.t > cut ? { ...r, price: r.price * 3, oi: r.oi * 0.1, funding: -r.funding } : r)),
        candleHist: full.candleHist.map((c) => (c.t + H > cut ? { ...c, o: c.o * 3, h: c.h * 3, l: c.l * 0.2, c: c.c * 0.3 } : c)),
        cvdHist: full.cvdHist.map((r) => (r.t > cut ? { ...r, buy: r.sell * 9, sell: r.buy } : r)),
        spotCvdHist: full.spotCvdHist.map((r) => (r.t > cut ? { ...r, buy: r.sell, sell: r.buy * 9 } : r)),
        basisHist: full.basisHist.map((r) => (r.t > cut ? { ...r, basisPct: -r.basisPct * 9 } : r)),
      };
      const before = (evs) => evs.filter((e) => e.t <= cut).map((e) => `${e.t}|${e.side}`);
      const pctx = ctxOf(btcTape.candleHist.map((c) => (c.t + H > cut ? { ...c, o: c.o * 3, h: c.h * 3, l: c.l * 0.2, c: c.c * 0.3 } : c)));
      assert.deepEqual(before(gen(poisoned, null, pctx)), before(all), `${name} looked past ${cutH}h`);
    }
  }
});

test("the power check counts and nothing else: no returns, rates of success or R", () => {
  const t = tape(1600);
  const res = powerCheck([{ coin: "BTC", ...t }], { days: 30, now: T0 + 1600 * H });
  for (const per of Object.values(res)) {
    for (const row of Object.values(per)) {
      for (const k of Object.keys(row)) assert.ok(["events", "gradeable", "longs", "coveredDays"].includes(k), `unexpected field ${k}`);
    }
  }
});

test("oi_div_reversal_4h (registered 2026-10-27): the 24h read's own code, only window, OI drop and cooldown differ", () => {
  assert.deepEqual({ windowH: OI_DIV_4H.windowH, oiDrop: OI_DIV_4H.oiDrop, cooldownH: OI_DIV_4H.cooldownH }, { windowH: 4, oiDrop: 0.02, cooldownH: 12 });
  for (const k of ["lookbackH", "pct", "minHistory"]) assert.equal(OI_DIV_4H[k], OI_DIV[k], k);
  const t = tape(1600);
  assert.deepEqual(oiDivReversal4hEvents(t, null, {}), oiDivReversalEvents(t, null, {}, OI_DIV_4H));
  assert.ok(oiDivReversal4hEvents(t, null, {}).length > 0);
});

// A tape with a steady wobble (so 24h returns have a spread), then a flat final day.
function coilTape({ oiBuild, breakUp }) {
  const n = 800, oiHist = [], candleHist = [];
  for (let i = 0; i < n; i++) {
    const flat = i >= n - 30;
    const p = flat ? 100 : 100 + Math.sin(i / 9) * 3;
    const oi = flat && i >= n - 24 ? 1000 * (1 + oiBuild * (i - (n - 25)) / 24) : 1000;
    oiHist.push({ t: T0 + i * H + 60000, price: p, oi, funding: 0 });
    candleHist.push({ t: T0 + i * H, o: p, h: p * 1.001, l: p * 0.999, c: p, v: 1 });
  }
  // the hour after the coil: a close outside the 24h range
  const px = breakUp ? 101 : 99;
  candleHist.push({ t: T0 + n * H, o: 100, h: Math.max(100, px) * 1.001, l: Math.min(100, px) * 0.999, c: px, v: 1 });
  return { oiHist, candleHist, coilEnd: T0 + (n - 1) * H };
}

test("oi_coil_break (registered 2026-10-27, OI +3%): OI builds into a flat tape, the range break is followed; no OI build → nothing", () => {
  const up = oiCoilBreakEvents(coilTape({ oiBuild: 0.06, breakUp: true }));
  assert.equal(up.at(-1)?.side, "LONG");
  const down = oiCoilBreakEvents(coilTape({ oiBuild: 0.06, breakUp: false }));
  assert.equal(down.at(-1)?.side, "SHORT");
  const t = coilTape({ oiBuild: 0.0, breakUp: true });
  assert.equal(oiCoilBreakEvents(t).filter((e) => e.t > t.coilEnd).length, 0, "no OI build, no coil");
  assert.deepEqual({ oiBuild: OI_COIL.oiBuild, flatPct: OI_COIL.flatPct, breakWithinH: OI_COIL.breakWithinH, cooldownH: OI_COIL.cooldownH }, { oiBuild: 0.03, flatPct: 0.3, breakWithinH: 12, cooldownH: 24 });
});


// ── Batch 3 (registered 2026-11-06) ───────────────────────────────────────────────────────────

test("session_fade (registered 2026-11-06): session_momentum's exact events, the other side, one code path", () => {
  const t = tape(1600);
  const mom = sessionMomentumEvents(t), fade = sessionFadeEvents(t);
  assert.ok(mom.length > 0);
  assert.deepEqual(fade.map((e) => e.t), mom.map((e) => e.t));
  assert.ok(fade.every((e, i) => e.side !== mom[i].side && ["LONG", "SHORT"].includes(e.side)));
  assert.deepEqual(SESSION, { openUtcH: 13, spanH: 2, lookbackDays: 30, minDays: 20 }, "the signed window is session_momentum's");
});

// level_reclaim's hand-built LONG (explorerReads.test above), after `days` days of `prefix` bars
function reclaimAfter(prefixDays, prefix) {
  const bars = [];
  const P = prefixDays * 24;
  for (let i = 0; i < P; i++) bars.push(candle(i, ...prefix));
  for (let i = P; i < P + 5 * 24; i++) bars.push(candle(i, 100, 101, 99, 100));
  const d5 = P + 5 * 24;
  bars.push(candle(d5, 100, 100.2, 98.0, 98.4));
  bars.push(candle(d5 + 1, 98.4, 99.5, 98.3, 99.3));
  for (let i = d5 + 2; i < d5 + 24; i++) bars.push(candle(i, 99.3, 99.6, 99.1, 99.3));
  return { bars, entryT: T0 + (d5 + 2) * H };
}

test("level_reclaim_tight (registered 2026-11-06): the reclaim is taken when the coin is calm for itself, not when it's wild", () => {
  assert.deepEqual(LEVEL_TIGHT, { maxRank: 0.5, lookbackH: 30 * 24, stepH: 6, minSamples: 60 });
  // after a wild month the 2% range is calm for this coin → taken
  const calmNow = reclaimAfter(30, [100, 110, 90, 100]);
  const base = levelReclaimEvents({ candleHist: calmNow.bars }).filter((e) => e.t === calmNow.entryT);
  assert.equal(base.length, 1);
  assert.deepEqual(levelReclaimTightEvents({ candleHist: calmNow.bars }).filter((e) => e.t === calmNow.entryT), base);
  // after a dead-flat month the same 2% range is wild for this coin → left out
  const wildNow = reclaimAfter(30, [100, 100.05, 99.95, 100]);
  assert.equal(levelReclaimEvents({ candleHist: wildNow.bars }).filter((e) => e.t === wildNow.entryT).length, 1);
  assert.equal(levelReclaimTightEvents({ candleHist: wildNow.bars }).filter((e) => e.t === wildNow.entryT).length, 0);
  // too little history to compare with → nothing (needs 60 samples, 15 days at 6h)
  const young = reclaimAfter(5, [100, 110, 90, 100]);
  assert.equal(levelReclaimTightEvents({ candleHist: young.bars }).filter((e) => e.t === young.entryT).length, 0);
});

test("level_reclaim_tight is always a subset of level_reclaim, same time and side", () => {
  const t = tape(1600);
  const all = new Set(levelReclaimEvents(t).map((e) => `${e.t}|${e.side}`));
  const tight = levelReclaimTightEvents(t);
  assert.ok(tight.length > 0 && tight.length < all.size, "the tape fires both, and the filter removes some");
  for (const e of tight) assert.ok(all.has(`${e.t}|${e.side}`));
});

// 14 days of quiet history, then a 4h window shaped by `last` ({ ret, perp: [buy, sell], spot: [buy, sell], oiCh })
function absorbTape(last, { hours = 14 * 24 + 24 } = {}) {
  let s = 11;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const oiHist = [], cvdHist = [], spotCvdHist = [];
  for (let i = 0; i < hours; i++) {
    const k = i - (hours - 4); // 0..3 = the final four hours
    const inLast = k >= 0;
    const price = inLast ? 100 * (1 + last.ret * (k + 1) / 4) : 100 + (rnd() - 0.5) * 0.2;
    const oi = inLast ? 1000 * (1 + last.oiCh) : 1000; // the OI change lands with the window
    oiHist.push({ t: T0 + i * H + 120000, price, oi, funding: 0 });
    const pb = inLast ? last.perp : [45 + rnd() * 10, 45 + rnd() * 10];
    const sb = inLast ? last.spot : [50, 50]; // spot exactly balanced before the window: nothing can fire there
    cvdHist.push({ t: T0 + i * H + 300000, buy: pb[0], sell: pb[1] });
    spotCvdHist.push({ t: T0 + i * H + 300000, buy: sb[0], sell: sb[1] });
  }
  return { oiHist, cvdHist, spotCvdHist, lastT: oiHist[hours - 1].t };
}

test("spot_absorb (registered 2026-11-06): a perp-led dip that spot buys, OI flat → LONG; the mirror → SHORT", () => {
  assert.deepEqual(SPOT_ABSORB, { windowH: 4, minRows: 3, lookbackH: 14 * 24, minHistory: 120, pct: 0.2, oiFlat: 0.01, cooldownH: 12 });
  // the window shows the dip before its last hour, so the read fires once inside the final 4h (then the 12h cooldown)
  const inWindow = (x) => spotAbsorbEvents(x).filter((e) => e.t > x.lastT - 4 * H);
  const longCase = absorbTape({ ret: -0.02, perp: [10, 90], spot: [60, 40], oiCh: 0.002 });
  assert.deepEqual(inWindow(longCase).map((e) => e.side), ["LONG"]);
  const shortCase = absorbTape({ ret: 0.02, perp: [90, 10], spot: [40, 60], oiCh: -0.002 });
  assert.deepEqual(inWindow(shortCase).map((e) => e.side), ["SHORT"]);
  // nothing in the quiet 14 days before it
  assert.equal(spotAbsorbEvents(longCase).filter((e) => e.t <= longCase.lastT - 4 * H).length, 0);
});

test("spot_absorb: spot agreeing with perp, OI building, or no spot series → nothing", () => {
  const at = (x) => spotAbsorbEvents(x).filter((e) => e.t > x.lastT - 4 * H).length;
  assert.equal(at(absorbTape({ ret: -0.02, perp: [10, 90], spot: [40, 60], oiCh: 0.002 })), 0, "spot sold too: no absorption");
  assert.equal(at(absorbTape({ ret: -0.02, perp: [10, 90], spot: [60, 40], oiCh: 0.03 })), 0, "OI built: positions are being added");
  assert.equal(at(absorbTape({ ret: 0.02, perp: [10, 90], spot: [60, 40], oiCh: 0.002 })), 0, "price rose: perp didn't lead the dip");
  const noSpot = absorbTape({ ret: -0.02, perp: [10, 90], spot: [60, 40], oiCh: 0.002 });
  assert.deepEqual(spotAbsorbEvents({ ...noSpot, spotCvdHist: [] }), []);
  assert.equal(at(absorbTape({ ret: -0.02, perp: [10, 90], spot: [60, 40], oiCh: 0.002 }, { hours: 100 })), 0, "under 120 hours of perp history: nothing");
});

test("batch 3 registrations: future-dated docs, spot_absorb waits for 14 days of spot data, the holdout's spot series stays off the main card", async () => {
  const reg = (a) => REGISTERED_READS.find((r) => r.axis === a);
  assert.equal(reg("session_fade").registeredAt, "2026-11-08T00:00:00Z");
  assert.equal(reg("level_reclaim_tight").registeredAt, "2026-11-08T00:00:00Z");
  assert.equal(reg("spot_absorb").registeredAt, "2026-11-20T00:00:00Z");
  for (const a of ["session_fade", "level_reclaim_tight", "spot_absorb"]) assert.ok(reg(a).holdout && reg(a).gradedExit && !reg(a).paperWallet);
  const { withoutHoldoutFlow } = await import("./axisbt.mjs");
  const [kept, emptied] = withoutHoldoutFlow([{ coin: "BTC", spotCvdHist: [1] }, { coin: "SUI", spotCvdHist: [1] }], (c) => c === "SUI");
  assert.deepEqual([kept.spotCvdHist, emptied.spotCvdHist], [[1], []]);
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /readJson\(AGENT_KV, `spotcvd:hist:\$\{coin\}`\)/, "the scoreboard loads the spot series");
});

// ── btc_lead_lag (registered 2026-11-07, btc-lead-lag-prereg.md) ──────────────────────────────────────
function quietBars(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = 100 * (1 + (i % 2 ? 0.001 : -0.001));
    out.push({ t: T0 + i * H, o: 100, h: Math.max(100, c) * 1.001, l: Math.min(100, c) * 0.999, c });
  }
  return out;
}
const byHourMap = (rows) => new Map(rows.map((c) => [hourBucket(c.t), c]));

test("btc_lead_lag: registered at p90 · lag 0.75, cooldown 12h, 360h of BTC history", () => {
  assert.deepEqual({ pct: LEAD_LAG.pct, lagFrac: LEAD_LAG.lagFrac, cooldownH: LEAD_LAG.cooldownH, minHistory: LEAD_LAG.minHistory, lookbackH: LEAD_LAG.lookbackH },
    { pct: 0.9, lagFrac: 0.75, cooldownH: 12, minHistory: 360, lookbackH: 720 });
  const reg = REGISTERED_READS.find((r) => r.axis === "btc_lead_lag");
  assert.equal(reg.registeredAt, "2026-11-08T00:00:00Z");
  assert.ok(reg.holdout && reg.gradedExit && !reg.paperWallet && reg.side === "BOTH");
});

test("btc_lead_lag: an outsized BTC hour + an alt under 0.75 of it → follow BTC on the alt; BTC never fires; no BTC = nothing", () => {
  const n = 800, k = 760;
  const btc = quietBars(n);
  btc[k] = { ...btc[k], o: btc[k - 1].c, c: btc[k - 1].c * 0.97, l: btc[k - 1].c * 0.969, h: btc[k - 1].c * 1.001 };
  const ctx = { btcCandles: byHourMap(btc) };
  const lag = quietBars(n);
  lag[k] = { ...lag[k], c: lag[k - 1].c * 0.99 }; // −1% vs BTC −3%: under 0.75 of it → lagging
  assert.deepEqual(btcLeadLagEvents({ coin: "SOL", candleHist: lag }, null, ctx), [{ t: T0 + k * H + H, side: "SHORT" }]);
  const kept = quietBars(n);
  kept[k] = { ...kept[k], c: kept[k - 1].c * 0.975 }; // −2.5%: more than 0.75 of BTC's move → caught up
  assert.deepEqual(btcLeadLagEvents({ coin: "SOL", candleHist: kept }, null, ctx), []);
  assert.deepEqual(btcLeadLagEvents({ coin: "BTC", candleHist: btc }, null, ctx), []);
  assert.deepEqual(btcLeadLagEvents({ coin: "SOL", candleHist: lag }, null, {}), []);
  // under 360 hours of BTC history: nothing
  const shortCtx = { btcCandles: byHourMap(btc.slice(k - 300)) };
  assert.deepEqual(btcLeadLagEvents({ coin: "SOL", candleHist: lag }, null, shortCtx), []);
});

test("btc_lead_lag on the holdout line: BTC rides along as context only, its own events are never graded", async () => {
  const { runHoldoutScorecard } = await import("./axisbt.mjs");
  const n = 900;
  const btc = quietBars(n);
  for (const k of [500, 600, 700, 800]) btc[k] = { ...btc[k], o: btc[k - 1].c, c: btc[k - 1].c * 1.03, h: btc[k - 1].c * 1.031, l: btc[k - 1].c * 0.999 };
  const alt = (coin) => {
    const candleHist = quietBars(n);
    return { coin, candleHist, oiHist: candleHist.map((c) => ({ t: c.t + 120000, price: c.c, oi: 1000, funding: 0 })) };
  };
  const btcSet = { coin: "BTC", candleHist: btc, oiHist: btc.map((c) => ({ t: c.t + 120000, price: c.c, oi: 1000, funding: 0 })) };
  const cfg = { horizons: [4], minSamples: 1, axes: ["btc_lead_lag"] };
  const without = runHoldoutScorecard([alt("ZEC"), alt("INJ")], cfg);
  const withBtc = runHoldoutScorecard([alt("ZEC"), alt("INJ")], { ...cfg, ctxSets: [btcSet] });
  const samples = (sc) => sc.axes.find((a) => a.name === "btc_lead_lag").horizons[0].samples;
  assert.equal(samples(without), 0, "no BTC on the holdout line = the read can't fire");
  assert.ok(samples(withBtc) > 0, "BTC as context lets it fire on the holdout coins");
  assert.deepEqual(withBtc.coins, ["ZEC", "INJ"], "BTC is not one of the graded coins");
});

test("the holdout scorecard passes BTC as context only (index.js)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /runHoldoutScorecard\(holdoutSets, \{[^}]*ctxSets: coinSets\.filter\(\(c\) => c\.coin === "BTC"\) \}\)/);
});

// ── funding_basis_split (registered 2026-11-07, funding-basis-split-prereg.md) ────────────────────────
test("funding_basis_split: registered at the drafted setting (p80/20, basis vs its 30-day median, 24h, 360h)", () => {
  assert.deepEqual({ ...SPLIT }, { lookbackH: 720, minHistory: 360, hi: 0.8, lo: 0.2, cooldownH: 24 });
  const reg = REGISTERED_READS.find((r) => r.axis === "funding_basis_split");
  assert.equal(reg.registeredAt, "2026-11-08T00:00:00Z");
  assert.ok(reg.holdout && reg.gradedExit && !reg.paperWallet && reg.side === "BOTH");
});

test("funding_basis_split: funding says longs are crowded, basis sits at or below its median → SHORT; the mirror → LONG", () => {
  const n = 800, h = 700;
  const oiHist = [], basisHist = [];
  for (let i = 0; i < n; i++) {
    oiHist.push({ t: T0 + i * H + 120000, price: 100, oi: 1000, funding: 0.0001 }); // a flat history ranks 0.5: never extreme
    basisHist.push({ t: T0 + i * H + 300000, basisPct: 0.03 });
  }
  oiHist[h] = { ...oiHist[h], funding: 0.01 };
  basisHist[h] = { ...basisHist[h], basisPct: -0.5 };
  oiHist[h + 30] = { ...oiHist[h + 30], funding: -0.01 };
  basisHist[h + 30] = { ...basisHist[h + 30], basisPct: 0.5 };
  const ev = fundingBasisSplitEvents({ oiHist, basisHist });
  assert.deepEqual(ev.map((e) => [e.t, e.side]), [[oiHist[h].t, "SHORT"], [oiHist[h + 30].t, "LONG"]]);
  // funding and basis AGREE (crowded longs, perp bid up): not this read
  const agree = basisHist.map((r, i) => (i === h ? { ...r, basisPct: 0.5 } : r));
  assert.ok(!fundingBasisSplitEvents({ oiHist, basisHist: agree }).some((e) => e.t === oiHist[h].t));
  assert.deepEqual(fundingBasisSplitEvents({ oiHist, basisHist: [] }), [], "no basis series = no events");
});

test("funding_basis_split is checked for overlap with confluence_follow (both read funding)", async () => {
  const { OVERLAP_PAIRS } = await import("./axisbt.mjs");
  assert.ok(OVERLAP_PAIRS.some((p) => p.includes("funding_basis_split") && p.includes("confluence_follow")));
});

// ── Performance rewrite (2026-11-08): the faster btc_lead_lag / funding_basis_split must fire EXACTLY the events the
// registered bodies did. The registered bodies are kept here verbatim as the reference.
const REF = (() => {
  const H = 3600000;
  const byHour = (rows, ok) => { const m = new Map(); for (const r of [...(rows || [])].sort((a, b) => Number(a.t) - Number(b.t))) if (r && ok(r)) m.set(hourBucket(r.t), r); return m; };
  const candleMap = (c) => byHour(c, (x) => [x.o, x.h, x.l, x.c].every(Number.isFinite) && x.c > 0);
  const pctRank = (arr, x) => { if (!arr.length) return null; let below = 0, equal = 0; for (const v of arr) { if (v < x) below++; else if (v === x) equal++; } return (below + equal / 2) / arr.length; };
  const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(0.5 * (s.length - 1))))]; };
  function leadLag(cs, _pmap, ctx = {}, p = LEAD_LAG) {
    if (String(cs.coin || "").toUpperCase() === "BTC") return [];
    const btc = ctx && ctx.btcCandles instanceof Map ? ctx.btcCandles : null;
    if (!btc || !btc.size) return [];
    const cbh = candleMap(cs.candleHist);
    const btcRet = new Map();
    for (const h of btc.keys()) { const a = btc.get(h), b = btc.get(h - 1); if (b && b.c > 0 && a.c > 0) btcRet.set(h, a.c / b.c - 1); }
    const hours = [...cbh.keys()].sort((a, b) => a - b);
    const ev = [];
    let last = -Infinity;
    for (const h of hours) {
      if (h - last < p.cooldownH) continue;
      const r = btcRet.get(h);
      if (r == null || r === 0) continue;
      const a = cbh.get(h), b = cbh.get(h - 1);
      if (!b) continue;
      const prior = [];
      for (let k = h - p.lookbackH; k < h; k++) { const x = btcRet.get(k); if (x != null) prior.push(Math.abs(x)); }
      if (prior.length < p.minHistory) continue;
      if (!(pctRank(prior, Math.abs(r)) >= p.pct)) continue;
      const alt = a.c / b.c - 1;
      if (!(Math.sign(r) * alt < p.lagFrac * Math.abs(r))) continue;
      ev.push({ t: Number(a.t) + H, side: r > 0 ? "LONG" : "SHORT" });
      last = h;
    }
    return ev;
  }
  function split(cs, _pmap, _ctx, p = SPLIT) {
    const m = byHour(cs.oiHist, (r) => Number.isFinite(Number(r.funding)) && Number(r.price) > 0);
    const bm = byHour(cs.basisHist, (r) => Number.isFinite(Number(r.basisPct)));
    if (!m.size || !bm.size) return [];
    const hours = [...m.keys()].sort((a, b) => a - b);
    const bHours = [...bm.keys()].sort((a, b) => a - b);
    const ev = [];
    let last = -Infinity;
    for (const h of hours) {
      if (h - last < p.cooldownH) continue;
      const b = bm.get(h);
      if (!b) continue;
      const fPrior = [], bPrior = [];
      for (const k of hours) { if (k >= h) break; if (k >= h - p.lookbackH) fPrior.push(Number(m.get(k).funding)); }
      for (const k of bHours) { if (k >= h) break; if (k >= h - p.lookbackH) bPrior.push(Number(bm.get(k).basisPct)); }
      if (fPrior.length < p.minHistory || bPrior.length < p.minHistory) continue;
      const fr = pctRank(fPrior, Number(m.get(h).funding));
      const bmed = median(bPrior), bx = Number(b.basisPct);
      const side = fr >= p.hi && bx <= bmed ? "SHORT" : fr <= p.lo && bx >= bmed ? "LONG" : null;
      if (!side) continue;
      ev.push({ t: m.get(h).t, side });
      last = h;
    }
    return ev;
  }
  return { leadLag, split };
})();

test("the faster btc_lead_lag and funding_basis_split fire exactly the registered bodies' events (gappy, tied, many seeds)", () => {
  for (const seed of [1, 3, 7, 11, 29, 101]) {
    const base = tape(1700, seed), btcT = tape(1700, seed + 50);
    // gaps and ties: drop every 13th candle / 17th oi row / 11th basis row, and round funding + basis so values repeat
    const alt = {
      coin: "ETH",
      candleHist: base.candleHist.filter((_, i) => i % 13 !== 5),
      oiHist: base.oiHist.filter((_, i) => i % 17 !== 3).map((r) => ({ ...r, funding: Math.round(r.funding * 1e5) / 1e5 })),
      basisHist: base.basisHist.filter((_, i) => i % 11 !== 2).map((r) => ({ ...r, basisPct: Math.round(r.basisPct * 100) / 100 })),
    };
    const ctx = { btcCandles: new Map(btcT.candleHist.filter((_, i) => i % 19 !== 7).map((c) => [hourBucket(c.t), c])) };
    for (const p of [LEAD_LAG, { ...LEAD_LAG, pct: 0.95, lagFrac: 0.5 }, { ...LEAD_LAG, minHistory: 100, cooldownH: 0 }]) {
      const ref = REF.leadLag(alt, null, ctx, p);
      assert.deepEqual(btcLeadLagEvents(alt, null, ctx, p), ref, `lead-lag seed ${seed}`);
    }
    for (const p of [SPLIT, { ...SPLIT, hi: 0.9, lo: 0.1 }, { ...SPLIT, cooldownH: 0, minHistory: 100 }]) {
      const ref = REF.split(alt, null, null, p);
      assert.deepEqual(fundingBasisSplitEvents(alt, null, null, p), ref, `split seed ${seed}`);
    }
  }
  // the tape is rich enough that both actually fire (an all-empty comparison would prove nothing)
  const t = tape(1700, 7), b = tape(1700, 57);
  assert.ok(REF.leadLag({ coin: "ETH", ...t }, null, { btcCandles: new Map(b.candleHist.map((c) => [hourBucket(c.t), c])) }, { ...LEAD_LAG, minHistory: 100 }).length > 0);
  assert.ok(REF.split(t, null, null, { ...SPLIT, minHistory: 100 }).length > 0);
});

test("the 30-day windows include the hour exactly 30 days back (boundary pinned against the registered bodies)", () => {
  // Continuous hourly data: the window of hour h holds exactly the 720 hours h−720 … h−1. With minHistory 720 the read
  // fires only if the boundary hour h−720 is counted.
  const n = 800, k = 760;
  const flatBars = () => Array.from({ length: n }, (_, i) => { const c = 100 * (1 + (i % 2 ? 0.001 : -0.001)); return { t: T0 + i * H, o: 100, h: Math.max(100, c) * 1.001, l: Math.min(100, c) * 0.999, c }; });
  const btc = flatBars();
  btc[k] = { ...btc[k], o: btc[k - 1].c, c: btc[k - 1].c * 1.03, h: btc[k - 1].c * 1.031, l: btc[k - 1].c * 0.999 };
  const ctx = { btcCandles: new Map(btc.map((c) => [hourBucket(c.t), c])) };
  const alt = { coin: "SOL", candleHist: flatBars() };
  const p = { ...LEAD_LAG, minHistory: 720 };
  assert.equal(REF.leadLag(alt, null, ctx, p).length, 1, "the reference fires with exactly 720 prior hours");
  assert.deepEqual(btcLeadLagEvents(alt, null, ctx, p), REF.leadLag(alt, null, ctx, p));
  assert.deepEqual(btcLeadLagEvents(alt, null, ctx, { ...p, minHistory: 721 }), [], "721 is one more than the window holds");
  const oiHist = [], basisHist = [];
  for (let i = 0; i < n; i++) { oiHist.push({ t: T0 + i * H + 120000, price: 100, oi: 1000, funding: 0.0001 }); basisHist.push({ t: T0 + i * H + 300000, basisPct: 0.03 }); }
  oiHist[k] = { ...oiHist[k], funding: 0.01 }; basisHist[k] = { ...basisHist[k], basisPct: -0.5 };
  const q = { ...SPLIT, minHistory: 720 };
  assert.equal(REF.split({ oiHist, basisHist }, null, null, q).length, 1);
  assert.deepEqual(fundingBasisSplitEvents({ oiHist, basisHist }, null, null, q), REF.split({ oiHist, basisHist }, null, null, q));
  assert.deepEqual(fundingBasisSplitEvents({ oiHist, basisHist }, null, null, { ...q, minHistory: 721 }), []);
});
