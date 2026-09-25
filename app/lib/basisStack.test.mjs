// Run: node --test app/lib/basisStack.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { hourBucket, priceByHour, classifyCvdDivergence, cvdSideForRow, basisCvdConfirm, basisSmartConfirm, smByHour, basisLiqConfirm, liqFlushEventsFromHist } from "./basisStack.mjs";
import { basisFadeFromHistory } from "./basisFade.mjs";
import { basisXcvdEvents, basisXsmartEvents, basisXliqEvents, liqFlushEvents } from "../../workers/nexus-lab-api/axisbt.mjs";
import { deriveSignal } from "../../workers/nexus-agent-brain/logic.mjs";

const H = 3600000;
const T0 = 1_780_000_000_000 - (1_780_000_000_000 % H); // hour-aligned

test("classifyCvdDivergence: price up on net selling = distribution → SHORT", () => {
  const r = classifyCvdDivergence(0.8, { cvd: -400000, buy: 300000, sell: 700000 });
  assert.equal(r.side, "SHORT");
  assert.equal(r.kind, "distribution");
});

test("classifyCvdDivergence: agreement or a tiny move is not a fade tell", () => {
  assert.equal(classifyCvdDivergence(0.8, { cvd: 400000, buy: 700000, sell: 300000 }), null); // trend
  assert.equal(classifyCvdDivergence(0.1, { cvd: -400000, buy: 300000, sell: 700000 }), null); // < min move
});

test("cvdSideForRow: reads price move off the oi:hist spine at the row's hour", () => {
  const pmap = priceByHour([{ t: T0, price: 100 }, { t: T0 + H, price: 101 }]); // +1%
  const sig = cvdSideForRow({ t: T0 + H, cvd: -500, buy: 250, sell: 750 }, pmap);
  assert.equal(sig.side, "SHORT");
  assert.equal(cvdSideForRow({ t: T0 + 5 * H, cvd: -500, buy: 250, sell: 750 }, pmap), null); // no price
});

test("basisCvdConfirm: confirms only the same side in the same hour", () => {
  const oiHist = [{ t: T0, price: 100 }, { t: T0 + H, price: 101 }];
  const cvdHist = [{ t: T0 + H, cvd: -500, buy: 250, sell: 750 }]; // distribution → SHORT
  assert.equal(basisCvdConfirm({ basisT: T0 + H, side: "SHORT", cvdHist, oiHist }).confirmed, true);
  const dis = basisCvdConfirm({ basisT: T0 + H, side: "LONG", cvdHist, oiHist });
  assert.equal(dis.confirmed, false);
  assert.equal(dis.cvdSide, "SHORT");
  assert.match(dis.reason, /disagrees/);
});

test("basisCvdConfirm: never guesses — missing row / price / side all refuse", () => {
  const oiHist = [{ t: T0, price: 100 }, { t: T0 + H, price: 101 }];
  assert.match(basisCvdConfirm({ basisT: T0 + H, side: "SHORT", cvdHist: [], oiHist }).reason, /no CVD read/);
  assert.match(basisCvdConfirm({ basisT: T0 + H, side: "SHORT", cvdHist: [{ t: T0 + H, cvd: -5, buy: 2, sell: 7 }], oiHist: [] }).reason, /no price/);
  assert.equal(basisCvdConfirm({ basisT: T0 + H, side: null, cvdHist: [], oiHist }).confirmed, false);
  assert.equal(basisCvdConfirm({ basisT: NaN, side: "SHORT", cvdHist: [], oiHist }).confirmed, false);
});

// ── PARITY: the live gates fire on EXACTLY the hours/sides the scoreboard grades ──
// A deterministic synthetic tape: 240 hours of basis/cvd/smart/price with periodic basis
// extremes and mixed flow/lean. With `dupes`, the cvd + smart crons also write a SECOND row
// inside some rounded hours (sometimes neutral, sometimes the opposite side) — the grader's
// Map keeps the LAST row with a side, and the live lookup must too. For every hour we ask the
// LIVE path (basisFadeFromHistory → confirm, evaluated as if "now" were that hour) and
// compare with axisbt's graded events. If these ever disagree, the agent is trading
// something the board didn't grade.
function tape({ dupes = false, seed: s0 = 7 } = {}) {
  let seed = s0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const basisHist = [], cvdHist = [], oiHist = [], smHist = [];
  let price = 100;
  for (let i = 0; i < 240; i++) {
    const t = T0 + i * H + 7 * 60000; // recorded a few minutes past the hour, like the crons
    const spike = i > 60 && i % 17 === 0;
    const basisPct = spike ? (rnd() > 0.5 ? 1 : -1) * (0.5 + rnd()) : (rnd() - 0.5) * 0.1;
    price *= 1 + (rnd() - 0.5) * 0.02;
    const buy = 1000 * rnd(), sell = 1000 * rnd();
    basisHist.push({ t, basisPct });
    cvdHist.push({ t, cvd: buy - sell, buy, sell });
    oiHist.push({ t: T0 + i * H + 2 * 60000, price, oi: 1, funding: 0 });
    const r = rnd();
    smHist.push({ t: T0 + i * H + 12 * 60000, side: r < 0.4 ? "LONG" : r < 0.8 ? "SHORT" : "SPLIT", long: 3, short: 2 });
    if (dupes && i % 3 === 0) {
      // a second write in the same rounded hour (+20 min): neutral half the time, flipped otherwise
      const b2 = 1000 * rnd(), s2 = 1000 * rnd();
      cvdHist.push(rnd() > 0.5 ? { t: t + 20 * 60000, cvd: 0, buy: 1, sell: 1 } : { t: t + 20 * 60000, cvd: b2 - s2, buy: b2, sell: s2 });
      smHist.push({ t: T0 + i * H + 25 * 60000, side: rnd() > 0.5 ? "SPLIT" : (r < 0.5 ? "SHORT" : "LONG"), long: 2, short: 3 });
    }
  }
  return { basisHist, cvdHist, oiHist, smHist };
}

function assertParity(cs, gradedGen, confirm) {
  const graded = new Map(gradedGen(cs, priceByHour(cs.oiHist)).map((e) => [hourBucket(e.t), e.side]));
  let live = 0;
  for (let i = 0; i < cs.basisHist.length; i++) {
    const now = cs.basisHist[i].t;
    const b = basisFadeFromHistory(cs.basisHist.slice(0, i + 1), { now });
    const side = b.side && confirm(b).confirmed ? b.side : null;
    const want = graded.get(hourBucket(now)) ?? null;
    assert.equal(side, want, `hour ${i}: live=${side} graded=${want}`);
    if (side) live++;
  }
  assert.equal(live, graded.size);
  return live;
}

// Coverage guard: a seed can legitimately yield zero intersections, but the suite as a whole
// must exercise real fires in BOTH modes (else parity would pass vacuously).
const fired = { cvd: { false: 0, true: 0 }, smart: { false: 0, true: 0 } };
for (const dupes of [false, true]) {
  for (const seed of [7, 42, 1337]) {
    const tag = `${dupes ? "with same-hour rewrites" : "one row/hour"}, seed ${seed}`;
    test(`parity: live basis×CVD gate == scoreboard basis_x_cvd (${tag})`, () => {
      const cs = tape({ dupes, seed });
      fired.cvd[dupes] += assertParity(cs, basisXcvdEvents, (b) => basisCvdConfirm({ basisT: b.t, side: b.side, cvdHist: cs.cvdHist, oiHist: cs.oiHist }));
    });
    test(`parity: live basis×smart gate == scoreboard basis_x_smart (${tag})`, () => {
      const cs = tape({ dupes, seed });
      fired.smart[dupes] += assertParity(cs, basisXsmartEvents, (b) => basisSmartConfirm({ basisT: b.t, side: b.side, smHist: cs.smHist }));
    });
  }
}
test("parity coverage: the fixtures actually fire both gates, with and without rewrites", () => {
  for (const k of ["cvd", "smart"]) for (const d of ["false", "true"]) assert.ok(fired[k][d] > 0, `${k} dupes=${d} never fired`);
});

test("same-hour rewrite: a later NEUTRAL row does not erase an earlier signal (grader semantics)", () => {
  const oiHist = [{ t: T0, price: 100 }, { t: T0 + H, price: 101 }];
  const cvdHist = [
    { t: T0 + H, cvd: -500, buy: 250, sell: 750 },                // distribution → SHORT
    { t: T0 + H + 20 * 60000, cvd: 0, buy: 1, sell: 1 },          // neutral, same rounded hour
  ];
  assert.equal(basisCvdConfirm({ basisT: T0 + H, side: "SHORT", cvdHist, oiHist }).confirmed, true);
  const smHist = [{ t: T0 + H, side: "LONG" }, { t: T0 + H + 20 * 60000, side: "SPLIT" }];
  assert.equal(smByHour(smHist).get(hourBucket(T0 + H)), "LONG");
  assert.equal(basisSmartConfirm({ basisT: T0 + H, side: "LONG", smHist }).confirmed, true);
});

test("same-hour rewrite: a later OPPOSITE row wins (last-with-a-side, like the grader)", () => {
  const smHist = [{ t: T0 + H, side: "LONG" }, { t: T0 + H + 20 * 60000, side: "SHORT" }];
  const r = basisSmartConfirm({ basisT: T0 + H, side: "LONG", smHist });
  assert.equal(r.confirmed, false);
  assert.equal(r.smartSide, "SHORT");
});

test("basisSmartConfirm: agrees / disagrees / split / missing", () => {
  const smHist = [{ t: T0 + H, side: "SHORT", long: 1, short: 4 }];
  const ok = basisSmartConfirm({ basisT: T0 + H, side: "SHORT", smHist });
  assert.equal(ok.confirmed, true);
  assert.match(ok.reason, /agrees 1L\/4S/);
  assert.match(basisSmartConfirm({ basisT: T0 + H, side: "LONG", smHist }).reason, /leans SHORT/);
  assert.match(basisSmartConfirm({ basisT: T0 + H, side: "LONG", smHist: [{ t: T0 + H, side: "SPLIT" }] }).reason, /split/);
  assert.match(basisSmartConfirm({ basisT: T0 + H, side: "LONG", smHist: [] }).reason, /no smart-money read/);
});

// ── deriveSignal: the opt-in gate in BASIS_FADE ─────────────────────────────────
test("BASIS_FADE + basisConfirm CVD: enters only when CVD confirms the same side", () => {
  const cfg = { signalMode: "BASIS_FADE", basisConfirm: "CVD" };
  const ok = deriveSignal({ basisSide: "SHORT", basisCvdConfirmed: true, basisCvdSide: "SHORT", hasPrev: true }, cfg);
  assert.equal(ok.direction, "SHORT");
  assert.match(ok.reason, /CVD confirms/);

  const no = deriveSignal({ basisSide: "SHORT", basisCvdConfirmed: false, basisCvdSide: "LONG", basisCvdReason: "CVD disagrees (accumulation → LONG)", hasPrev: true }, cfg);
  assert.equal(no.direction, "NONE");
  assert.match(no.reason, /CVD disagrees/);
});

test("BASIS_FADE + basisConfirm CVD: absent CVD read ⇒ sits out (never a pass)", () => {
  const s = deriveSignal({ basisSide: "LONG", hasPrev: true }, { signalMode: "BASIS_FADE", basisConfirm: "CVD" });
  assert.equal(s.direction, "NONE");
  assert.match(s.reason, /CVD not read/);
});

test("BASIS_FADE without basisConfirm is unchanged", () => {
  const s = deriveSignal({ basisSide: "LONG", hasPrev: true }, { signalMode: "BASIS_FADE" });
  assert.equal(s.direction, "LONG");
});

test("BASIS_FADE + basisConfirm SMART: enters only when smart money agrees", () => {
  const cfg = { signalMode: "BASIS_FADE", basisConfirm: "SMART" };
  const ok = deriveSignal({ basisSide: "LONG", basisSmartConfirmed: true, basisSmartSide: "LONG", hasPrev: true }, cfg);
  assert.equal(ok.direction, "LONG");
  assert.match(ok.reason, /smart money agrees/);
  const no = deriveSignal({ basisSide: "LONG", basisSmartConfirmed: false, basisSmartSide: "SHORT", basisSmartReason: "smart money leans SHORT", hasPrev: true }, cfg);
  assert.equal(no.direction, "NONE");
  assert.match(no.reason, /leans SHORT/);
  const absent = deriveSignal({ basisSide: "LONG", hasPrev: true }, cfg);
  assert.equal(absent.direction, "NONE");
  assert.match(absent.reason, /smart money not read/);
  // a CVD confirmation must not satisfy the SMART gate
  const crossed = deriveSignal({ basisSide: "LONG", basisCvdConfirmed: true, basisCvdSide: "LONG", hasPrev: true }, cfg);
  assert.equal(crossed.direction, "NONE");
});

// ── LIQ FLUSH confirm: parity with the scoreboard's basis_x_liqflush ────────────
function liqTape({ dupes = false, seed: s0 = 3 } = {}) {
  let seed = s0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const basisHist = [], liqHist = [];
  for (let i = 0; i < 240; i++) {
    const t = T0 + i * H + 7 * 60000;
    const spike = i > 60 && i % 13 === 0;
    basisHist.push({ t, basisPct: spike ? (rnd() > 0.5 ? 1 : -1) * (0.5 + rnd()) : (rnd() - 0.5) * 0.1 });
    // Baseline liquidations ~100; every ~5th hour a 3-6× cascade on one side.
    const cascade = rnd() < 0.2;
    const up = rnd() > 0.5;
    const base = () => 80 + 40 * rnd();
    liqHist.push({ t: T0 + i * H + 11 * 60000, longMag: cascade && !up ? base() * (3 + 3 * rnd()) : base(), shortMag: cascade && up ? base() * (3 + 3 * rnd()) : base() });
    if (dupes && i % 4 === 0) liqHist.push({ t: T0 + i * H + 31 * 60000, longMag: base() * (rnd() > 0.5 ? 4 : 1), shortMag: base() * (rnd() > 0.5 ? 4 : 1) });
  }
  return { basisHist, liqHist, oiHist: [] };
}
const firedLiq = { false: 0, true: 0 };
for (const dupes of [false, true]) {
  for (const seed of [3, 21, 99]) {
    test(`parity: live basis×liq-flush gate == scoreboard basis_x_liqflush (${dupes ? "same-hour rewrites" : "one row/hour"}, seed ${seed})`, () => {
      const cs = liqTape({ dupes, seed });
      firedLiq[dupes] += assertParity(cs, basisXliqEvents, (b) => basisLiqConfirm({ basisT: b.t, side: b.side, liqHist: cs.liqHist }));
    });
  }
}
test("parity coverage: the liq fixtures actually fire, with and without rewrites", () => {
  assert.ok(firedLiq.false > 0 && firedLiq.true > 0, JSON.stringify(firedLiq));
});

test("liqFlushEventsFromHist == the scoreboard's liq_flush events (same shared function)", () => {
  const cs = liqTape({ dupes: true, seed: 7 });
  assert.deepEqual(liqFlushEventsFromHist(cs.liqHist), liqFlushEvents(cs));
});

test("basisLiqConfirm: agrees / disagrees / quiet / missing", () => {
  const hist = Array.from({ length: 20 }, (_, i) => ({ t: T0 + i * H, longMag: 100, shortMag: 100 }));
  const flushDown = [...hist, { t: T0 + 20 * H, longMag: 400, shortMag: 100 }]; // longs flushed → LONG
  const ok = basisLiqConfirm({ basisT: T0 + 20 * H, side: "LONG", liqHist: flushDown });
  assert.equal(ok.confirmed, true);
  assert.match(ok.reason, /DOWN flush 4×/);
  const no = basisLiqConfirm({ basisT: T0 + 20 * H, side: "SHORT", liqHist: flushDown });
  assert.equal(no.confirmed, false);
  assert.equal(no.liqSide, "LONG");
  assert.match(basisLiqConfirm({ basisT: T0 + 20 * H, side: "LONG", liqHist: [...hist, { t: T0 + 20 * H, longMag: 110, shortMag: 100 }] }).reason, /no liquidation flush/);
  assert.match(basisLiqConfirm({ basisT: T0 + 30 * H, side: "LONG", liqHist: flushDown }).reason, /no liquidation read/);
});

test("BASIS_FADE + basisConfirm LIQ: enters only when the flush confirms; other confirms don't count", () => {
  const cfg = { signalMode: "BASIS_FADE", basisConfirm: "LIQ" };
  assert.equal(deriveSignal({ basisSide: "SHORT", basisLiqConfirmed: true, basisLiqSide: "SHORT", hasPrev: true }, cfg).direction, "SHORT");
  const no = deriveSignal({ basisSide: "SHORT", basisLiqConfirmed: false, basisLiqReason: "no liquidation flush", hasPrev: true }, cfg);
  assert.equal(no.direction, "NONE");
  assert.match(no.reason, /no liquidation flush/);
  assert.equal(deriveSignal({ basisSide: "SHORT", basisCvdConfirmed: true, basisCvdSide: "SHORT", hasPrev: true }, cfg).direction, "NONE");
});
