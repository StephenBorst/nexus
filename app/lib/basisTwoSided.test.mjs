// STAGED two-sided basis (basisAnchor "MEAN"): the brain's construction must fire on exactly the
// hours + sides the scoreboard grades as basis_dev / basis_dev_x_cvd — and must never trade the
// zero-anchored basis_extreme verdict while the flag is off.
// Run: node --test app/lib/basisTwoSided.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basisDeviationFromHistory } from "./basisFade.mjs";
import { basisCvdConfirm, hourBucket, priceByHour } from "./basisStack.mjs";
import { deriveSignal } from "../../workers/nexus-agent-brain/logic.mjs";
import { basisDevEvents, basisDevXcvdEvents } from "../../workers/nexus-lab-api/axisbt.mjs";
import { makeBasisAt, basisAtForConfig } from "../../workers/nexus-lab-api/backtest.mjs";

const H = 3600000;
const T0 = Date.parse("2026-08-01T00:00:00Z");
const MEAN_CVD = { signalMode: "BASIS_FADE", basisAnchor: "MEAN", basisConfirm: "CVD" };
const MEAN_PLAIN = { signalMode: "BASIS_FADE", basisAnchor: "MEAN" };

// Persistent-discount tape (the real OKX shape: basis sits ~−0.05%) with periodic moves both
// WIDER and NARROWER than usual, so the two-sided read has both sides to find. `rewrite` adds a
// second row inside some rounded hours (the cron writing twice) to exercise same-hour semantics.
function tape(s0, rewrite = false) {
  let seed = s0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const basisHist = [], cvdHist = [], oiHist = [];
  let price = 100;
  for (let i = 0; i < 260; i++) {
    const t = T0 + i * H + 7 * 60000;
    const spike = i > 60 && i % 13 === 0;
    const base = -0.05 + (rnd() - 0.5) * 0.02;
    basisHist.push({ t, basisPct: spike ? base + (rnd() > 0.5 ? 1 : -1) * (0.04 + rnd() * 0.05) : base });
    price *= 1 + (rnd() - 0.5) * 0.02;
    const buy = 1000 * rnd(), sell = 1000 * rnd();
    cvdHist.push({ t, cvd: buy - sell, buy, sell });
    if (rewrite && i % 5 === 0) {
      const b2 = 1000 * rnd(), s2 = 1000 * rnd();
      cvdHist.push({ t: t + 20 * 60000, cvd: b2 - s2, buy: b2, sell: s2 });
    }
    oiHist.push({ t: T0 + i * H + 2 * 60000, price, oi: 1, funding: 0 });
  }
  return { basisHist, cvdHist, oiHist };
}

// Exactly what evaluateSymbol builds when BASIS_TWO_SIDED_LIVE is on.
function brainRaw(cs, i) {
  const now = cs.basisHist[i].t;
  const d = basisDeviationFromHistory(cs.basisHist.slice(0, i + 1), { now });
  const raw = { basisDevSide: d.side, basisDevPct: d.basisPct, basisDevThr: d.thr, basisDevReason: d.reason };
  if (d.side) {
    const c = basisCvdConfirm({ basisT: d.t, side: d.side, cvdHist: cs.cvdHist, oiHist: cs.oiHist });
    Object.assign(raw, { basisDevCvdConfirmed: c.confirmed, basisDevCvdSide: c.cvdSide, basisDevCvdReason: c.reason });
  }
  return raw;
}

const fired = { plain: { LONG: 0, SHORT: 0 }, cvd: { LONG: 0, SHORT: 0 } };
for (const seed of [7, 42, 1337]) {
  for (const rewrite of [false, true]) {
    test(`parity: brain two-sided == scoreboard basis_dev + basis_dev_x_cvd, hour by hour (seed ${seed}${rewrite ? ", same-hour rewrites" : ""})`, () => {
      const cs = tape(seed, rewrite);
      const plain = new Map(basisDevEvents(cs).map((e) => [hourBucket(e.t), e.side]));
      const stacked = new Map(basisDevXcvdEvents(cs, priceByHour(cs.oiHist)).map((e) => [hourBucket(e.t), e.side]));
      for (let i = 0; i < cs.basisHist.length; i++) {
        const raw = brainRaw(cs, i);
        const h = hourBucket(cs.basisHist[i].t);
        const p = deriveSignal(raw, MEAN_PLAIN).direction;
        const c = deriveSignal(raw, MEAN_CVD).direction;
        assert.equal(p, plain.get(h) ?? "NONE", `plain hour ${i}`);
        assert.equal(c, stacked.get(h) ?? "NONE", `cvd hour ${i}`);
        if (p !== "NONE") fired.plain[p]++;
        if (c !== "NONE") fired.cvd[c]++;
      }
    });
  }
}
test("parity coverage: BOTH sides fire, plain and stacked (else parity passes vacuously)", () => {
  assert.ok(fired.plain.LONG > 0 && fired.plain.SHORT > 0, JSON.stringify(fired.plain));
  assert.ok(fired.cvd.LONG > 0 && fired.cvd.SHORT > 0, JSON.stringify(fired.cvd));
});

test("backtest replay of a MEAN config == the brain's construction, bar by bar", () => {
  const cs = tape(42);
  const at = makeBasisAt(cs, { needCvd: true, twoSided: true });
  const viaConfig = basisAtForConfig(MEAN_CVD, cs);
  for (let i = 0; i < cs.basisHist.length; i++) {
    const now = cs.basisHist[i].t;
    const want = deriveSignal(brainRaw(cs, i), MEAN_CVD).direction;
    assert.equal(deriveSignal(at(now), MEAN_CVD).direction, want, `hour ${i}`);
    assert.equal(deriveSignal(viaConfig(now), MEAN_CVD).direction, want, `hour ${i} (basisAtForConfig)`);
  }
});

test("flag OFF: a MEAN config never trades the zero-anchored read — it sits out and says why", () => {
  const oneSidedFires = { basisSide: "LONG", basisReason: "x", basisCvdConfirmed: true, basisCvdSide: "LONG" };
  const s = deriveSignal(oneSidedFires, MEAN_CVD);
  assert.equal(s.direction, "NONE");
  assert.match(s.reason, /staged \(off\)/);
  // …while the same raw still drives the live one-sided preset exactly as before.
  assert.equal(deriveSignal(oneSidedFires, { signalMode: "BASIS_FADE", basisConfirm: "CVD" }).direction, "LONG");
});

test("one-sided configs ignore the two-sided fields entirely", () => {
  const onlyDev = { basisDevSide: "SHORT", basisDevCvdConfirmed: true, basisDevCvdSide: "SHORT" };
  assert.equal(deriveSignal(onlyDev, { signalMode: "BASIS_FADE" }).direction, "NONE");
  assert.equal(deriveSignal(onlyDev, { signalMode: "BASIS_FADE", basisConfirm: "CVD" }).direction, "NONE");
});

test("MEAN × SMART / LIQ have no scoreboard row → sit out, never a pass", () => {
  const raw = { basisDevSide: "SHORT", basisDevReason: "x", basisSmartConfirmed: true, basisSmartSide: "SHORT", basisLiqConfirmed: true, basisLiqSide: "SHORT" };
  for (const c of ["SMART", "LIQ"]) {
    const s = deriveSignal(raw, { ...MEAN_PLAIN, basisConfirm: c });
    assert.equal(s.direction, "NONE");
    assert.match(s.reason, /not graded/);
  }
});

test("the brain computes the two-sided read ONLY behind BASIS_TWO_SIDED_LIVE, and it ships off", () => {
  const src = readFileSync(new URL("../../workers/nexus-agent-brain/index.js", import.meta.url), "utf8");
  assert.match(src, /const twoSidedLive = env\.BASIS_TWO_SIDED_LIVE === "true";/);
  assert.match(src, /const needBasisDev = twoSidedLive && /);
  const toml = readFileSync(new URL("../../workers/nexus-agent-brain/wrangler.toml", import.meta.url), "utf8");
  assert.ok(!/^\s*BASIS_TWO_SIDED_LIVE\s*=/m.test(toml), "BASIS_TWO_SIDED_LIVE is set — two-sided must stay off until it grades PREDICTIVE with both sides");
});

test("a MEAN config is named and paired as the two-sided read, never as basis_extreme", async () => {
  const { strategyLabel, backtestGateSupport } = await import("./strategyLabel.mjs");
  const { axisForConfig } = await import("./paperParity.mjs");
  assert.equal(strategyLabel(MEAN_PLAIN), "Two-Sided Basis Fade");
  assert.equal(strategyLabel(MEAN_CVD), "Two-Sided Basis × CVD Stack");
  assert.ok(backtestGateSupport(MEAN_CVD).applied.includes("two-sided basis"));
  assert.equal(axisForConfig(MEAN_PLAIN), "basis_dev");
  assert.equal(axisForConfig(MEAN_CVD), "basis_dev_x_cvd");
  assert.equal(axisForConfig({ ...MEAN_PLAIN, basisConfirm: "SMART" }), null);
  assert.equal(strategyLabel({ signalMode: "BASIS_FADE", basisConfirm: "CVD" }), "Basis × CVD Stack"); // live preset unchanged
});
