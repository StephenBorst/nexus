// The stress-hour DRAFT (docs/research/stress-hours-draft.md). Not registered, so: nothing that trades
// or grades imports it, behaviour on hand-built tapes, no lookahead, and the count tool counts only.
// Run: node --test workers/nexus-lab-api/stressDraft.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STRESS_DRAFT, stressPanel, stressHours, deleverHours, shockHours, stressEpisodes, inStress } from "./stressDraft.mjs";
import { stressCount } from "../../tools/explorers/stressCount.mjs";

const H = 3600000;
const T0 = Date.UTC(2026, 6, 1, 0, 0, 0);
const COINS = ["BTC", "ETH", "SOL", "BNB", "XRP", "LINK", "DOGE", "AVAX", "HYPE"];

test("nothing that trades or grades imports the draft", () => {
  for (const f of ["./axisbt.mjs", "./index.js", "./explorerReads.mjs", "../nexus-agent-brain/index.js", "../nexus-agent-brain/logic.mjs", "../nexus-agent-exec/index.js", "../nexus-agent-exec/logic.mjs"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /stressDraft/, `${f} must not import the stress draft before it is registered`);
  }
});

// Nine coins, gently noisy; `shock(h)` returns a multiplier set for hour h: { oi, px } per coin index.
function panel(n, shock = () => null, seed = 3) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  return COINS.map((coin, ci) => {
    let p = 100 + ci, oi = 1000 + ci;
    const oiHist = [], candleHist = [];
    for (let i = 0; i < n; i++) {
      const o = p;
      const k = shock(i, ci);
      p *= 1 + (rnd() - 0.5) * 0.004 + (k?.px || 0);
      oi *= 1 + (rnd() - 0.5) * 0.004 + (k?.oi || 0);
      candleHist.push({ t: T0 + i * H, o, h: Math.max(o, p) * (1 + rnd() * 0.001 + Math.abs(k?.px || 0)), l: Math.min(o, p) * (1 - rnd() * 0.001), c: p });
      oiHist.push({ t: T0 + i * H + 120000, price: p, oi, funding: 0 });
    }
    return { coin, oiHist, candleHist };
  });
}

const AT = 600; // hour of the hand-built cascade (past the 15-day history the move rank needs)
const cascade = (nCoins) => (i, ci) => (i === AT && ci < nCoins ? { oi: -0.04, px: -0.05 } : i === AT ? { px: -0.05 } : null);

test("a board-wide move with five coins delevering is a stress hour; four is not", () => {
  const five = stressHours(panel(800, cascade(5)));
  assert.ok(five.includes(T0 + AT * H + 120000), "the cascade hour is a stress hour, stamped when its rows were written");
  assert.ok(five.every((t) => t >= T0 + AT * H && t < T0 + (AT + STRESS_DRAFT.windowH) * H), "and only the 4h it sits inside");
  assert.deepEqual(stressHours(panel(800, cascade(4))), []);
});

test("delevering without the board moving is not stress (but counts as DELEVER alone)", () => {
  const quiet = (i, ci) => (i === AT && ci < 6 ? { oi: -0.04 } : null);
  assert.deepEqual(stressHours(panel(800, quiet)), []);
  assert.ok(deleverHours(panel(800, quiet)).includes(T0 + AT * H + 120000));
});

test("an hour with fewer than six readable coins is not judged (never calm by default)", () => {
  const sets = panel(800, cascade(5)).map((s, i) => (i >= 5 ? { ...s, oiHist: [] } : s));
  assert.deepEqual(stressPanel(sets), []);
});

test("no history, no verdict: the move rank needs 15 days first", () => {
  const early = (i, ci) => (i === 100 && ci < 9 ? { oi: -0.04, px: -0.05 } : null);
  assert.deepEqual(stressHours(panel(400, early)), []);
});

test("no lookahead: the future never changes past stress hours", () => {
  const full = panel(1500, (i, ci) => ((i === 700 || i === 1100) && ci < 6 ? { oi: -0.05, px: 0.06 } : null));
  const base = { stress: stressHours(full), delever: deleverHours(full), shock: shockHours(full[0].candleHist) };
  assert.ok(base.stress.length > 0 && base.shock.length > 0);
  for (const cutH of [800, 1000, 1200]) {
    const cut = T0 + cutH * H;
    const poisoned = full.map((s) => ({
      ...s,
      oiHist: s.oiHist.map((r) => (r.t > cut ? { ...r, price: r.price * 3, oi: r.oi * 0.1 } : r)),
      candleHist: s.candleHist.map((c) => (c.t + H > cut ? { ...c, h: c.h * 5, l: c.l * 0.2, c: c.c * 0.5 } : c)),
    }));
    const before = (xs) => xs.filter((t) => t <= cut);
    assert.deepEqual(before(stressHours(poisoned)), before(base.stress), `stress looked past ${cutH}h`);
    assert.deepEqual(before(deleverHours(poisoned)), before(base.delever), `delever looked past ${cutH}h`);
    assert.deepEqual(before(shockHours(poisoned[0].candleHist)), before(base.shock), `shock looked past ${cutH}h`);
  }
});

test("a shock is stamped at the candle's close, not its open", () => {
  const sets = panel(800, (i, ci) => (i === AT && ci === 0 ? { px: 0.03 } : null));
  const s = shockHours(sets[0].candleHist);
  assert.ok(s.includes(T0 + (AT + 1) * H));
  assert.ok(!s.includes(T0 + AT * H));
});

test("episodes merge hours within 24h; the window is [S, S+24h)", () => {
  const hs = [0, 2, 30, 80].map((h) => T0 + h * H);
  assert.deepEqual(stressEpisodes(hs).map((e) => e.hours), [2, 1, 1]);
  assert.equal(stressEpisodes([T0, T0 + 24 * H]).length, 1);
  assert.equal(inStress(T0 - 1, hs), false);
  assert.equal(inStress(T0, hs), true);
  assert.equal(inStress(T0 + 25 * H, hs), true);   // 23h after the hour-2 stress
  assert.equal(inStress(T0 + 26 * H, hs), false);  // 24h after it: outside
  assert.equal(inStress(T0 + 30 * H, hs), true);
});

test("the count tool returns counts and nothing else", () => {
  const sets = panel(1500, (i, ci) => (i === 900 && ci < 6 ? { oi: -0.05, px: -0.06 } : null));
  const fakeRead = () => [{ t: T0 + 905 * H, side: "LONG" }, { t: T0 + 1300 * H, side: "SHORT" }];
  const r = stressCount(sets, sets, { days: 60, now: T0 + 1500 * H, reads: { fake: fakeRead } });
  assert.deepEqual(Object.keys(r).sort(), ["episodes", "hoursCovered", "judgedHours", "perRead", "stressHours"]);
  assert.deepEqual(r.perRead.fake, { events: 18, inStress: 9 });
  for (const k of ["episodes", "hoursCovered", "judgedHours", "stressHours"]) assert.equal(typeof r[k], "number");
});
