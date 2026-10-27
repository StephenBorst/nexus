// ── Explorer reads, batch 2 — DRAFTS, NOT REGISTERED (2026-10-27) ──────────────────────────────
// docs/research/explorer-drafts-b.md. Nothing here is graded: the scoreboard (axisbt AXES) must not
// import this file, and explorerDraftsB.test.mjs fails if it does. Until borst signs a registration,
// the only thing allowed to run these generators is the COUNT-ONLY power check
// (tools/explorers/powerCheck.mjs --batch b): how often a rule fires, never what happened after.
// Signing one = a dated registration that moves its body, unchanged, into the registered set.
//
// Same generator shape as explorerReads.mjs: (cs, pmap, ctx) → [{ t, side }], deciding on data up
// to and including the deciding bar (no lookahead). oi:hist reads stamp the event at the row's time;
// candle reads at the deciding bar's close (candle t = bar open, + 1h).
// Inputs: cs.oiHist [{t, price, oi, funding}] (hourly, brain) · cs.candleHist [{t,o,h,l,c,v}] (hourly).
import { hourBucket } from "../../app/lib/basisStack.mjs";
import { h4Atr14Frac } from "../../app/lib/atr.mjs";
import { oiDivReversalEvents, OI_DIV } from "./explorerReads.mjs";

const MONTH_H = 30 * 24;

function byHour(rows, ok) {
  const m = new Map();
  for (const r of [...(rows || [])].sort((a, b) => Number(a.t) - Number(b.t))) if (r && ok(r)) m.set(hourBucket(r.t), r);
  return m;
}
const oiMap = (oiHist) => byHour(oiHist, (p) => Number.isFinite(p.price) && p.price > 0);
const candleMap = (candleHist) => byHour(candleHist, (c) => [c.o, c.h, c.l, c.c].every(Number.isFinite) && c.c > 0);
// Percentile rank, ties counted half (the same mid-rank rule as explorerReads.mjs).
function pctRank(arr, x) {
  if (!arr.length) return null;
  let below = 0, equal = 0;
  for (const v of arr) { if (v < x) below++; else if (v === x) equal++; }
  return (below + equal / 2) / arr.length;
}
function h4AtrFracAt(cbh, hour, lookbackH = 80) {
  const hourly = [];
  for (let h = hour - lookbackH; h <= hour; h++) { const c = cbh.get(h); if (c) hourly.push({ t: Number(c.t) / 1000, h: c.h, l: c.l, c: c.c }); }
  return h4Atr14Frac(hourly);
}

// ── A · oi_div_reversal_4h ────────────────────────────────────────────────────────────────────
// The registered oi_div_reversal (explorers-prereg.md names "a 4h version" as a later registration),
// on a 4h window: |4h return| ≥ the 90th percentile of |4h return| over the prior 30 days AND OI
// fell at least `oiDrop` over the same 4h → fade it. Same code path as the 24h read (its body runs
// with these parameters), so the two can't drift apart. Open choices: oiDrop and the cooldown.
export const OI_DIV_4H = Object.freeze({ ...OI_DIV, windowH: 4, oiDrop: 0.02, cooldownH: 12 });
export function oiDivReversal4hEvents(cs, pmap, ctx, p = OI_DIV_4H) {
  return oiDivReversalEvents(cs, pmap, ctx, p);
}

// ── B · oi_coil_break ─────────────────────────────────────────────────────────────────────────
// Positions build while price goes nowhere, then price leaves the range: follow the break.
// Coil (decided at hour h, from oi:hist): OI rose at least `oiBuild` over the prior 24h AND |24h
// return| is at or below the 30th percentile of |24h return| over the prior 30 days.
// Break: within `breakWithinH` hours after the coil hour, the first hourly candle that CLOSES above
// the high (→ LONG) or below the low (→ SHORT) of the 24 candles ending at the coil hour.
// One event per coil; cooldown 24h per coin. Not vol_breakout (dropped): that needed an ATR squeeze
// and fired a third as often as the bar; this one asks for OI building into a flat tape.
export const OI_COIL = Object.freeze({ windowH: 24, lookbackH: MONTH_H, flatPct: 0.3, oiBuild: 0.05, breakWithinH: 12, cooldownH: 24, minHistory: MONTH_H / 2 });
export function oiCoilBreakEvents(cs, _pmap, _ctx, p = OI_COIL) {
  const m = oiMap(cs.oiHist), cbh = candleMap(cs.candleHist);
  const hours = [...m.keys()].sort((a, b) => a - b);
  const ret = new Map();
  for (const h of hours) {
    const a = m.get(h), b = m.get(h - p.windowH);
    if (!b || !(b.price > 0)) continue;
    const oiCh = Number(a.oi) > 0 && Number(b.oi) > 0 ? Number(a.oi) / Number(b.oi) - 1 : null;
    ret.set(h, { r: a.price / b.price - 1, oiCh });
  }
  const ev = [];
  let last = -Infinity;
  for (const h of hours) {
    const x = ret.get(h);
    if (!x || x.oiCh == null || h - last < p.cooldownH) continue;
    if (!(x.oiCh >= p.oiBuild)) continue;
    const prior = [];
    for (let k = h - p.lookbackH; k < h; k++) { const y = ret.get(k); if (y) prior.push(Math.abs(y.r)); }
    if (prior.length < p.minHistory) continue;
    if (!(pctRank(prior, Math.abs(x.r)) <= p.flatPct)) continue;
    // the coil's range: the 24 candles ending at the coil hour (all must exist)
    let hi = -Infinity, lo = Infinity, full = true;
    for (let k = h - p.windowH + 1; k <= h; k++) { const c = cbh.get(k); if (!c) { full = false; break; } hi = Math.max(hi, c.h); lo = Math.min(lo, c.l); }
    if (!full) continue;
    for (let k = h + 1; k <= h + p.breakWithinH; k++) {
      const c = cbh.get(k);
      if (!c) continue;
      const side = c.c > hi ? "LONG" : c.c < lo ? "SHORT" : null;
      if (side) { ev.push({ t: Number(c.t) + 3600000, side }); last = k; break; }
    }
  }
  return ev;
}

// ── C · funding_reset ─────────────────────────────────────────────────────────────────────────
// Wait for a crowd to be cleared instead of fading it at the extreme (funding_fade, graded NOISE,
// fades the extreme itself). Crowded: within the prior 24h, funding was at or above the 90th
// percentile of its prior 30 days (longs paying). Cleared, at hour h: funding is now at or below the
// 30-day median AND price is at least `drop` × H4 ATR-14 below its price at the crowded hour → LONG.
// The mirror case for shorts (funding ≤ the 10th percentile, back to ≥ the median, price ≥ drop × ATR
// above) → SHORT. Cooldown 24h per coin. The percentiles are taken over the 30 days before the
// crowded hour, so a crowded stretch can't move its own bar.
export const FUNDING_RESET = Object.freeze({ crowdPct: 0.9, withinH: 24, drop: 1, lookbackH: MONTH_H, cooldownH: 24, minHistory: MONTH_H / 2 });
export function fundingResetEvents(cs, _pmap, _ctx, p = FUNDING_RESET) {
  const m = byHour(cs.oiHist, (r) => Number.isFinite(r.price) && r.price > 0 && Number.isFinite(r.funding));
  const cbh = candleMap(cs.candleHist);
  const hours = [...m.keys()].sort((a, b) => a - b);
  const priorFunding = (h) => { const out = []; for (let k = h - p.lookbackH; k < h; k++) { const y = m.get(k); if (y) out.push(y.funding); } return out; };
  const ev = [];
  let last = -Infinity;
  for (const h of hours) {
    if (h - last < p.cooldownH) continue;
    const now = m.get(h);
    for (let k = h - 1; k >= h - p.withinH; k--) { // the most recent crowded hour in the window
      const c = m.get(k);
      if (!c) continue;
      const prior = priorFunding(k);
      if (prior.length < p.minHistory) continue;
      const rank = pctRank(prior, c.funding);
      const longCrowd = rank >= p.crowdPct, shortCrowd = rank <= 1 - p.crowdPct;
      if (!longCrowd && !shortCrowd) continue;
      const nowRank = pctRank(prior, now.funding);
      const atr = h4AtrFracAt(cbh, h);
      if (!(atr > 0)) break;
      const move = now.price / c.price - 1;
      if (longCrowd && nowRank <= 0.5 && move <= -p.drop * atr) { ev.push({ t: now.t, side: "LONG" }); last = h; }
      else if (shortCrowd && nowRank >= 0.5 && move >= p.drop * atr) { ev.push({ t: now.t, side: "SHORT" }); last = h; }
      break;
    }
  }
  return ev;
}

// ── D · funding_basis_split — DEFINED, NOT COUNTED ────────────────────────────────────────────
// Funding and basis are two prices of leverage. When funding says longs are paying (≥ its 30-day
// 80th percentile) but the perp trades at or below its usual discount to spot (basis ≤ its 30-day
// median), the funding print lags the tape: the crowd it describes is already leaving → SHORT; and
// the mirror for shorts → LONG. Needs basis:hist beside oi:hist; basis history has no public read
// route, so the power check can't count it from outside the worker. No generator until borst says
// whether to add a read-only history route.

export const DRAFT_READS_B = Object.freeze([
  Object.freeze({ name: "oi_div_reversal_4h", label: "Extreme 4h move on falling OI, faded", gen: oiDivReversal4hEvents }),
  Object.freeze({ name: "oi_coil_break", label: "OI builds into a flat tape, range break followed", gen: oiCoilBreakEvents }),
  Object.freeze({ name: "funding_reset", label: "Funding extreme cleared by price, entered after", gen: fundingResetEvents }),
]);
export const DRAFT_GENS_B = Object.freeze(Object.fromEntries(DRAFT_READS_B.map((r) => [r.name, r.gen])));
