// The five explorer reads as borst defined them (2026-10-16). Behaviour on hand-built tapes, plus
// the no-lookahead property on a random tape: changing anything after time T never changes the
// events at or before T. Run: node --test workers/nexus-lab-api/explorerReads.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  oiDivReversalEvents, sessionMomentumEvents, levelReclaimEvents, confluenceFollowEvents,
  EXPLORER_GENS, OI_DIV, CONFLUENCE,
} from "./explorerReads.mjs";
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
  assert.deepEqual(Object.keys(EXPLORER_GENS).sort(), ["confluence_follow", "level_reclaim", "oi_div_reversal", "session_momentum"]);
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
  return { oiHist, candleHist };
}

test("no lookahead: for every read, the future never changes past events", () => {
  const full = tape(1600);
  for (const [name, gen] of Object.entries(EXPLORER_GENS)) {
    const all = gen(full, null, {});
    assert.ok(all.length > 0, `${name}: the tape must make it fire`);
    for (const cutH of [900, 1200, 1500]) {
      const cut = T0 + cutH * H;
      // poison everything after the cut, then compare events stamped at or before it
      const poisoned = {
        oiHist: full.oiHist.map((r) => (r.t > cut ? { ...r, price: r.price * 3, oi: r.oi * 0.1, funding: -r.funding } : r)),
        candleHist: full.candleHist.map((c) => (c.t + H > cut ? { ...c, o: c.o * 3, h: c.h * 3, l: c.l * 0.2, c: c.c * 0.3 } : c)),
      };
      const before = (evs) => evs.filter((e) => e.t <= cut).map((e) => `${e.t}|${e.side}`);
      assert.deepEqual(before(gen(poisoned, null, {})), before(all), `${name} looked past ${cutH}h`);
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
