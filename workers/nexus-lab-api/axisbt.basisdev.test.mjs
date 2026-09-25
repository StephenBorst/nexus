// Two-sided basis axis (vs trailing mean). Run: node --test workers/nexus-lab-api/axisbt.basisdev.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { basisDevEvents, basisExtremeEvents, AXES } from "./axisbt.mjs";

const H = 3600000, T0 = Date.UTC(2026, 8, 1);
// persistent ~−0.05% discount with swings both ways (seeded)
function tape(n, seed = 3) {
  let s = seed >>> 0;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: n }, (_, i) => ({ t: T0 + i * H, basisPct: -0.05 + (r() - 0.5) * 0.04 }));
}

test("on a persistent discount the old axis is LONG-only; the two-sided axis fires both sides", () => {
  const cs = { basisHist: tape(600) };
  const old = basisExtremeEvents(cs), dev = basisDevEvents(cs);
  assert.ok(old.length > 0 && old.every((e) => e.side === "LONG"), "zero-anchored rule never shorts");
  assert.ok(dev.some((e) => e.side === "LONG") && dev.some((e) => e.side === "SHORT"), "two-sided rule shorts too");
});

test("no lookahead: rewriting the future never changes a past event", () => {
  const rows = tape(600), k = 400;
  const before = basisDevEvents({ basisHist: rows }).filter((e) => e.t <= rows[k].t);
  const poisoned = rows.map((r, i) => (i > k ? { ...r, basisPct: r.basisPct * -50 } : r));
  const after = basisDevEvents({ basisHist: poisoned }).filter((e) => e.t <= rows[k].t);
  assert.deepEqual(after, before);
});

test("registered beside basis_extreme (graded, not traded)", () => {
  const names = AXES.map((a) => a.name);
  assert.ok(names.includes("basis_dev") && names.includes("basis_dev_x_cvd") && names.includes("basis_extreme"));
});

// ── per-side splits + shadow exit (2026-09-25) ─────────────────────────────────
import { runScorecard, SHADOW_EXITS } from "./axisbt.mjs";
import { AXIS_EXITS } from "../../app/lib/axisExits.mjs";

function coinSet(coin, seed) {
  const basisHist = tape(700, seed);
  // hourly price + candles over the same hours (gentle random walk)
  let p = 100, s = seed >>> 0;
  const r = () => ((s = (Math.imul(s, 22695477) + 1) >>> 0) / 4294967296);
  const oiHist = [], candleHist = [];
  for (const b of basisHist) {
    const o = p; p = p * (1 + (r() - 0.5) * 0.01);
    oiHist.push({ t: b.t, price: p, oi: 1000 });
    candleHist.push({ t: b.t, o, h: Math.max(o, p) * 1.002, l: Math.min(o, p) * 0.998, c: p });
  }
  return { coin, basisHist, oiHist, candleHist, cvdHist: [] };
}

test("every axis reports LONG vs SHORT; the old basis axis shows SHORT events = 0, the two-sided one doesn't", () => {
  const sc = runScorecard([coinSet("BTC", 5), coinSet("ETH", 9)], { minSamples: 5 });
  const by = Object.fromEntries(sc.axes.map((a) => [a.name, a]));
  for (const a of sc.axes) assert.ok(a.sides && "LONG" in a.sides && "SHORT" in a.sides, a.name);
  assert.equal(by.basis_extreme.sides.SHORT.events, 0);
  assert.ok(by.basis_dev.sides.SHORT.events > 0 && by.basis_dev.sides.LONG.events > 0);
  const h = by.basis_dev.horizons.find((x) => x.samples > 0);
  assert.equal(h.bySide.LONG.samples + h.bySide.SHORT.samples, h.samples, "side split sums to the pooled count");
});

test("shadow exit: basis_dev_x_cvd is graded with the Basis × CVD Stack's exits, never as a preset", () => {
  assert.equal(AXIS_EXITS.basis_dev_x_cvd, undefined, "not in AXIS_EXITS (the evidence replay would run the wrong rule)");
  const sh = SHADOW_EXITS.basis_dev_x_cvd.exit, real = AXIS_EXITS.basis_x_cvd;
  for (const k of ["tpPercent", "slPercent", "maxHoldHours"]) assert.equal(sh[k], real[k], k);
});
