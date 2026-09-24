// Run: node --test app/lib/basisStack.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { hourBucket, priceByHour, classifyCvdDivergence, cvdSideForRow, basisCvdConfirm } from "./basisStack.mjs";
import { basisFadeFromHistory } from "./basisFade.mjs";
import { basisXcvdEvents } from "../../workers/nexus-lab-api/axisbt.mjs";
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

// ── PARITY: the live gate fires on EXACTLY the hours/sides the scoreboard grades ──
// A deterministic synthetic tape: 240 hours of basis/cvd/price with periodic extremes and
// mixed flow. For every hour we ask the LIVE path (basisFadeFromHistory → basisCvdConfirm,
// evaluated as if "now" were that hour) and compare with axisbt.basisXcvdEvents. If these
// ever disagree, the agent is trading something the board didn't grade.
test("parity: live basis×CVD gate == scoreboard basis_x_cvd events, hour by hour", () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const basisHist = [], cvdHist = [], oiHist = [];
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
  }
  const graded = new Map(basisXcvdEvents({ basisHist, cvdHist, oiHist }, priceByHour(oiHist)).map((e) => [hourBucket(e.t), e.side]));
  assert.ok(graded.size > 0, "fixture should produce some confirmed stack events");

  let live = 0;
  for (let i = 0; i < basisHist.length; i++) {
    const now = basisHist[i].t;
    const b = basisFadeFromHistory(basisHist.slice(0, i + 1), { now });
    let side = null;
    if (b.side) {
      const c = basisCvdConfirm({ basisT: b.t, side: b.side, cvdHist, oiHist });
      if (c.confirmed) side = b.side;
    }
    const want = graded.get(hourBucket(now)) ?? null;
    assert.equal(side, want, `hour ${i}: live=${side} graded=${want}`);
    if (side) live++;
  }
  assert.equal(live, graded.size);
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
