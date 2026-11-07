// Batch-4 explorer DRAFTS (docs/research/explorer-drafts-4.md). Not registered, so: never on the scoreboard,
// behaviour on hand-built tapes, no lookahead, and the power check counts only.
// Run: node --test workers/nexus-lab-api/explorerDrafts4.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DRAFT_GENS_4, DRAFT_READS_4, btcLeadLagEvents, fundingSettleSnapEvents, levelReclaimWeeklyEvents, fundingBasisSplitEvents, LEAD_LAG } from "./explorerDrafts4.mjs";
import { AXES } from "./axisbt.mjs";
import { REGISTERED_READS } from "../../app/lib/readPipeline.mjs";
import { hourBucket } from "../../app/lib/basisStack.mjs";

const H = 3600000;
// A Monday 00:00 UTC, so weekly and 8h settlement boundaries line up with whole bars.
const T0 = Date.UTC(2026, 6, 6, 0, 0, 0);
const candlesMap = (rows) => new Map(rows.map((c) => [hourBucket(c.t), c]));

test("drafts are not graded: off the scoreboard, unregistered, and nothing else imports them", () => {
  const graded = new Set(AXES.map((a) => a.name));
  const registered = new Set(REGISTERED_READS.map((r) => r.axis));
  for (const n of Object.keys(DRAFT_GENS_4)) {
    assert.ok(!graded.has(n), `${n} is on the scoreboard before it is registered`);
    assert.ok(!registered.has(n), `${n} is registered: move it out of the drafts file in the registration PR`);
  }
  for (const f of ["./axisbt.mjs", "./index.js", "../nexus-agent-brain/index.js", "../nexus-agent-brain/logic.mjs", "../nexus-agent-exec/index.js"]) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /explorerDrafts4/, `${f} must not import the drafts`);
  }
  assert.deepEqual(DRAFT_READS_4.map((r) => r.name), ["btc_lead_lag", "funding_settle_snap", "level_reclaim_weekly", "funding_basis_split"]);
});

// seeded random tape with every series the drafts read; BTC and the alt share a seed offset
function tape(n, seed = 7, { btc = false } = {}) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  let p = 100, oi = 1000, basis = 0.02;
  const oiHist = [], candleHist = [], basisHist = [];
  for (let i = 0; i < n; i++) {
    const o = p;
    const shock = rnd() < 0.04 ? (rnd() - 0.5) * 0.08 : 0;
    p *= 1 + (rnd() - 0.5) * 0.012 + (btc ? shock : shock * 0.2);
    oi *= 1 + (rnd() - 0.5) * 0.02;
    basis += (rnd() - 0.5) * 0.02;
    const hi = Math.max(o, p) * (1 + rnd() * 0.004), lo = Math.min(o, p) * (1 - rnd() * 0.004);
    candleHist.push({ t: T0 + i * H, o, h: hi, l: lo, c: p, v: 1 });
    oiHist.push({ t: T0 + i * H + 120000, price: p, oi, funding: (rnd() - 0.5) * 0.0006 + (i % 200 < 30 ? 0.0004 : 0) });
    basisHist.push({ t: T0 + i * H + 300000, basisPct: basis });
  }
  return { oiHist, candleHist, basisHist };
}

test("no lookahead: for every draft, the future never changes past events", () => {
  const btcFull = tape(1800, 3, { btc: true });
  const full = { coin: "ETH", ...tape(1800, 11) };
  for (const [name, gen] of Object.entries(DRAFT_GENS_4)) {
    const ctx = { btcCandles: candlesMap(btcFull.candleHist) };
    const all = gen(full, null, ctx);
    assert.ok(all.length > 0, `${name}: the tape must make it fire`);
    for (const cutH of [1100, 1400, 1700]) {
      const cut = T0 + cutH * H;
      const poison = (t) => ({
        oiHist: t.oiHist.map((r) => (r.t > cut ? { ...r, price: r.price * 3, oi: r.oi * 0.1, funding: -r.funding * 5 } : r)),
        candleHist: t.candleHist.map((c) => (c.t + H > cut ? { ...c, o: c.o * 3, h: c.h * 3, l: c.l * 0.2, c: c.c * 0.3 } : c)),
        basisHist: t.basisHist.map((r) => (r.t > cut ? { ...r, basisPct: -r.basisPct * 9 } : r)),
      });
      const pctx = { btcCandles: candlesMap(poison(btcFull).candleHist) };
      const before = (evs) => evs.filter((e) => e.t <= cut).map((e) => `${e.t}|${e.side}`);
      assert.deepEqual(before(gen({ coin: "ETH", ...poison(full) }, null, pctx)), before(all), `${name} looked past ${cutH}h`);
    }
  }
});

// a quiet hourly tape: price flat at 100 with a small wiggle, so one hand-placed bar decides an event
function flat(n, { wiggle = 0.001 } = {}) {
  const candleHist = [];
  for (let i = 0; i < n; i++) {
    const c = 100 * (1 + (i % 2 ? wiggle : -wiggle));
    candleHist.push({ t: T0 + i * H, o: 100, h: Math.max(100, c) * 1.001, l: Math.min(100, c) * 0.999, c });
  }
  return candleHist;
}

test("btc_lead_lag: an outsized BTC hour + an alt that moved under half of it → follow BTC on the alt; BTC itself never fires", () => {
  const n = 800, k = 760;
  const btc = flat(n);
  btc[k] = { ...btc[k], o: btc[k - 1].c, c: btc[k - 1].c * 1.03, h: btc[k - 1].c * 1.031, l: btc[k - 1].c * 0.999 };
  const ctx = { btcCandles: candlesMap(btc) };
  const lag = flat(n);
  lag[k] = { ...lag[k], c: lag[k - 1].c * 1.005 }; // +0.5% vs BTC +3%: under half → lagging
  const ev = btcLeadLagEvents({ coin: "SOL", candleHist: lag }, null, ctx);
  assert.deepEqual(ev, [{ t: T0 + k * H + H, side: "LONG" }]);
  const kept = flat(n);
  kept[k] = { ...kept[k], c: kept[k - 1].c * 1.04 }; // the alt already moved more than BTC: not lagging
  assert.deepEqual(btcLeadLagEvents({ coin: "SOL", candleHist: kept }, null, ctx), []);
  assert.deepEqual(btcLeadLagEvents({ coin: "BTC", candleHist: btc }, null, ctx), []);
  assert.deepEqual(btcLeadLagEvents({ coin: "SOL", candleHist: lag }, null, {}), [], "no BTC series = no events");
  assert.equal(LEAD_LAG.minHistory, 360);
});

test("funding_settle_snap: payers at an extreme + a pre-settlement move against them → enter with the payers at the settlement close", () => {
  const n = 800;
  const candleHist = flat(n);
  const oiHist = candleHist.map((c, i) => ({ t: c.t + 120000, price: c.c, oi: 1000, funding: 0.0001 * ((i * 7) % 5) / 5 }));
  // the bar closing at 16:00 UTC on day 32: hour index 32*24+15
  const h = 32 * 24 + 15;
  oiHist[h] = { ...oiHist[h], funding: 0.002 }; // longs paying, far above the coin's prior month
  candleHist[h - 1] = { ...candleHist[h - 1], o: 100 };
  candleHist[h] = { ...candleHist[h], c: 97, l: 96.9 }; // −3% over the two bars: longs unwound
  const ev = fundingSettleSnapEvents({ candleHist, oiHist });
  assert.deepEqual(ev, [{ t: T0 + (h + 1) * H, side: "LONG" }]);
  assert.equal(new Date(ev[0].t).getUTCHours(), 16);
  // the same move one hour off a settlement boundary is not this read
  const off = candleHist.map((c) => ({ ...c })), offOi = oiHist.map((r) => ({ ...r }));
  offOi[h] = { ...offOi[h], funding: 0.0001 }; offOi[h + 1] = { ...offOi[h + 1], funding: 0.002 };
  off[h] = { ...candleHist[h + 1] }; off[h].t = T0 + h * H; off[h + 1] = { ...candleHist[h], t: T0 + (h + 1) * H };
  assert.deepEqual(fundingSettleSnapEvents({ candleHist: off, oiHist: offOi }), []);
});

test("level_reclaim_weekly: the prior week's low swept by ≥0.4 ATR and closed back above within 6h → LONG at that close", () => {
  const n = 3 * 168;
  const candleHist = flat(n);
  const k = 2 * 168 + 30; // Wednesday of week 3
  candleHist[k] = { ...candleHist[k], l: 97, c: 99.5 };
  candleHist[k + 1] = { ...candleHist[k + 1], o: 99.5, l: 99.4, c: 100.05, h: 100.2 };
  const ev = levelReclaimWeeklyEvents({ candleHist });
  assert.deepEqual(ev, [{ t: T0 + (k + 2) * H, side: "LONG" }]);
  assert.equal(new Date(T0).getUTCDay(), 1, "weeks start Monday 00:00 UTC");
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
  assert.deepEqual(fundingBasisSplitEvents({ oiHist, basisHist: [] }), [], "no basis series = no events");
});

test("GET /agent/basis-history/:coin is read-only: GET only, one KV read of basis:hist, a sanitized coin", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const i = src.indexOf('parts[1] === "basis-history"');
  assert.ok(i > 0, "the route exists");
  const block = src.slice(i, src.indexOf("\n    }\n", i));
  assert.match(block, /request\.method === "GET"/);
  assert.match(block, /AGENT_KV\.get\(`basis:hist:\$\{coin\}`\)/);
  assert.match(block, /\/\^\[A-Z0-9\]\{1,12\}\$\/\.test\(coin\)/);
  assert.doesNotMatch(block, /\.put\(|\.delete\(/, "never writes");
});
