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

// The side a series gives at hour `h`, with the grader's EXACT semantics: the grader builds
// an hour→side Map by iterating the stored array in order and calling .set() only for rows
// that produce a side — so the LAST row in that hour WITH a side wins (a later neutral row
// does not erase an earlier signal). Mirroring that here is what keeps live == graded when a
// cron writes twice inside one rounded hour. Returns { rows, side, sig } for the hour.
function sideAtHour(rows, h, sideOf) {
  const inHour = [];
  let side = null, sig = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !Number.isFinite(r.t) || hourBucket(r.t) !== h) continue;
    inHour.push(r);
    const s = sideOf(r);
    if (s && (s.side === "LONG" || s.side === "SHORT")) { side = s.side; sig = s; }
  }
  return { rows: inHour, side, sig };
}

// Smart-money lean by hour (sm:hist {t, side, long, short}) — shared with the grader's
// smart_fade / basis_x_smart axes. Same last-with-a-side-wins Map semantics.
export function smByHour(smHist) {
  const m = new Map();
  for (const s of smHist || []) if (s && (s.side === "LONG" || s.side === "SHORT")) m.set(hourBucket(s.t), s.side);
  return m;
}

function checkBasis(basisT, side) {
  if (side !== "LONG" && side !== "SHORT") return { confirmed: false, reason: "no basis extreme" };
  if (!Number.isFinite(basisT)) return { confirmed: false, reason: "basis hour unknown" };
  return null;
}

// LIVE confirm for a basis fade — CVD. `basisT` is the timestamp of the basis observation
// that fired, `side` its fade side. Confirmed ONLY when the cvd:hist read in the SAME hour
// classifies to the SAME side — exactly the intersection basisXcvdEvents grades.
// Never guesses: a missing row, a missing price, or a disagreeing/neutral read all
// return confirmed:false with the reason, so the agent can say why it sat out.
export function basisCvdConfirm({ basisT, side, cvdHist, oiHist }) {
  const bad = checkBasis(basisT, side);
  if (bad) return { ...bad, cvdSide: null };
  const h = hourBucket(basisT);
  const pmap = priceByHour(oiHist);
  const { rows, side: cvdSide, sig } = sideAtHour(cvdHist, h, (r) => cvdSideForRow(r, pmap));
  if (!rows.length) return { confirmed: false, cvdSide: null, reason: "no CVD read for that hour" };
  if (!(pmap.get(h) > 0) || !(pmap.get(h - 1) > 0)) return { confirmed: false, cvdSide: null, reason: "no price for the CVD hour" };
  if (!cvdSide) return { confirmed: false, cvdSide: null, reason: "CVD neutral (no divergence)" };
  if (cvdSide !== side) return { confirmed: false, cvdSide, reason: `CVD disagrees (${sig.kind} → ${cvdSide})` };
  return { confirmed: true, cvdSide, reason: `CVD confirms (${sig.kind})` };
}

// LIVE confirm for a basis fade — SMART MONEY. Confirmed ONLY when the sm:hist lean in the
// SAME hour is on the SAME side — exactly the intersection basisXsmartEvents grades.
export function basisSmartConfirm({ basisT, side, smHist }) {
  const bad = checkBasis(basisT, side);
  if (bad) return { ...bad, smartSide: null };
  const h = hourBucket(basisT);
  const { rows, side: smartSide, sig } = sideAtHour(smHist, h, (r) => (r.side === "LONG" || r.side === "SHORT" ? { side: r.side, long: r.long, short: r.short } : null));
  if (!rows.length) return { confirmed: false, smartSide: null, reason: "no smart-money read for that hour" };
  if (!smartSide) return { confirmed: false, smartSide: null, reason: "smart money split (no lean)" };
  const tally = Number.isFinite(sig.long) && Number.isFinite(sig.short) ? ` ${sig.long}L/${sig.short}S` : "";
  if (smartSide !== side) return { confirmed: false, smartSide, reason: `smart money leans ${smartSide}${tally}` };
  return { confirmed: true, smartSide, reason: `smart money agrees${tally}` };
}
