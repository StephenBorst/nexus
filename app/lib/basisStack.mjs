// ── The BASIS STACK — conditioners on the basis fade, graded AND traded ───────
// basisFade.mjs holds the base read (fade an extreme spot-perp basis). The scoreboard's
// stack method takes that fade ONLY when a second, harder-to-arb read agrees on the same
// side at the SAME hour. This module holds the conditioner rules once, so the grader
// (workers/nexus-lab-api/axisbt.mjs) and the brain (workers/nexus-agent-brain) call the
// same functions and cannot drift — the same guarantee basisFade.mjs gives the base read.
//
// Pure: no fetch, no KV. Callers pass the recorded series.

// Hour bucket — the join key between series recorded by different crons.
export function hourBucket(t) { return Math.round(Number(t) / 3600000); }

// Price spine: hour → price, from oi:hist ({t, price, oi, funding}). The grader's forward
// returns AND the CVD divergence's price move both read this series.
export function priceByHour(oiHist) {
  const m = new Map();
  for (const p of oiHist || []) if (p && Number.isFinite(p.price) && p.price > 0) m.set(hourBucket(p.t), p.price);
  return m;
}

// ── CVD divergence ────────────────────────────────────────────────────────────
// A price push on opposing aggressor flow: price UP on net SELLING = distribution → SHORT;
// price DOWN on net BUYING = accumulation → LONG. Agreement (price and flow the same way)
// is trend, not a fade tell → null.
export const CVD_MIN_MOVE = 0.25; // % price move over the window to call a direction
export const CVD_MIN_TILT = 0.08; // |cvd|/(buy+sell) floor — a real aggressor tilt

export function classifyCvdDivergence(priceChangePct, cvdObj) {
  if (!cvdObj || !Number.isFinite(priceChangePct)) return null;
  const total = (Number(cvdObj.buy) || 0) + (Number(cvdObj.sell) || 0);
  if (total <= 0) return null;
  const tilt = (Number(cvdObj.cvd) || 0) / total; // -1..1 net aggressor lean
  if (Math.abs(priceChangePct) < CVD_MIN_MOVE || Math.abs(tilt) < CVD_MIN_TILT) return null;
  const priceUp = priceChangePct > 0, flowUp = tilt > 0;
  if (priceUp === flowUp) return null;
  return {
    side: priceUp ? "SHORT" : "LONG",
    kind: priceUp ? "distribution" : "accumulation",
    tilt: Math.round(tilt * 100) / 100,
    priceChangePct: Math.round(priceChangePct * 100) / 100,
  };
}

// The CVD read at ONE cvd:hist row: its hour's price vs the hour before, off the price
// spine. Returns the classifier's verdict, or null when either price is missing.
export function cvdSideForRow(cvdRow, pmap) {
  if (!cvdRow || !(pmap instanceof Map)) return null;
  const h0 = hourBucket(cvdRow.t), p0 = pmap.get(h0), pPrev = pmap.get(h0 - 1);
  if (!(p0 > 0) || !(pPrev > 0)) return null;
  return classifyCvdDivergence(((p0 - pPrev) / pPrev) * 100, cvdRow);
}

// LIVE confirm for a basis fade. `basisT` is the timestamp of the basis observation that
// fired, `side` its fade side. Confirmed ONLY when the cvd:hist row in the SAME hour
// classifies to the SAME side — exactly the intersection basisXcvdEvents grades.
// Never guesses: a missing row, a missing price, or a disagreeing/neutral read all
// return confirmed:false with the reason, so the agent can say why it sat out.
export function basisCvdConfirm({ basisT, side, cvdHist, oiHist }) {
  if (side !== "LONG" && side !== "SHORT") return { confirmed: false, cvdSide: null, reason: "no basis extreme" };
  if (!Number.isFinite(basisT)) return { confirmed: false, cvdSide: null, reason: "basis hour unknown" };
  const h = hourBucket(basisT);
  const row = (Array.isArray(cvdHist) ? cvdHist : []).find((c) => c && Number.isFinite(c.t) && hourBucket(c.t) === h);
  if (!row) return { confirmed: false, cvdSide: null, reason: "no CVD read for that hour" };
  const pmap = priceByHour(oiHist);
  if (!(pmap.get(h) > 0) || !(pmap.get(h - 1) > 0)) return { confirmed: false, cvdSide: null, reason: "no price for the CVD hour" };
  const sig = cvdSideForRow(row, pmap);
  if (!sig) return { confirmed: false, cvdSide: null, reason: "CVD neutral (no divergence)" };
  if (sig.side !== side) return { confirmed: false, cvdSide: sig.side, reason: `CVD disagrees (${sig.kind} → ${sig.side})` };
  return { confirmed: true, cvdSide: sig.side, reason: `CVD confirms (${sig.kind})` };
}
