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

// ── A · oi_div_reversal_4h — REGISTERED 2026-10-27 ────────────────────────────────────────────
// Moved unchanged into explorerReads.mjs (EXPLORER_READS); docs/research/oi-div-reversal-4h-prereg.md.

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

// ── C · funding_reset — DROPPED for this batch (borst, 2026-10-27) ──────────────────────────────
// Its power check projected 40 events in 60 days at the proposed setting, and only passed at a
// setting where funding is no longer an extreme. A looser version would be a new definition and a
// new registration; the draft body is in git history.

// ── D · funding_basis_split — DEFINED, NOT COUNTED ────────────────────────────────────────────
// Funding and basis are two prices of leverage. When funding says longs are paying (≥ its 30-day
// 80th percentile) but the perp trades at or below its usual discount to spot (basis ≤ its 30-day
// median), the funding print lags the tape: the crowd it describes is already leaving → SHORT; and
// the mirror for shorts → LONG. Needs basis:hist beside oi:hist; basis history has no public read
// route, so the power check can't count it from outside the worker. PARKED (borst, 2026-10-27): no
// basis history route this batch, so no generator.

export const DRAFT_READS_B = Object.freeze([
  Object.freeze({ name: "oi_coil_break", label: "OI builds into a flat tape, range break followed", gen: oiCoilBreakEvents }),
]);
export const DRAFT_GENS_B = Object.freeze(Object.fromEntries(DRAFT_READS_B.map((r) => [r.name, r.gen])));
