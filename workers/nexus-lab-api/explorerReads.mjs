// ── The five explorer reads, as borst defined them (2026-10-16) ─────────────────────────────
// docs/research/explorers-prereg.md (registered 2026-10-16; events count from 2026-10-17T00:00Z).
// The scoreboard grades them (axisbt AXES) once registered; before registration the only thing
// allowed to run a generator is the COUNT-ONLY power check (tools/explorers/powerCheck.mjs).
// A changed rule = a new name and a new registration; these bodies are frozen.
//
// Every generator: (cs, pmap, ctx) → [{ t, side }], the scoreboard's generator shape.
//   - decides on data up to and including the deciding bar, never after (no lookahead);
//   - candle reads stamp the event at the deciding bar's CLOSE (candle t = bar open, + 1h);
//   - oi:hist reads stamp it at the row's own time.
// Inputs: cs.oiHist [{t, price, oi, funding}] (hourly, brain) · cs.candleHist [{t,o,h,l,c,v}] (hourly).
import { hourBucket } from "../../app/lib/basisStack.mjs";
import { h4Atr14Frac } from "../../app/lib/atr.mjs";

const H = 3600000;
const DAY_H = 24;
const MONTH_H = 30 * 24;

// last row per hour wins (the grader's same-hour semantics)
function byHour(rows, ok) {
  const m = new Map();
  for (const r of [...(rows || [])].sort((a, b) => Number(a.t) - Number(b.t))) if (r && ok(r)) m.set(hourBucket(r.t), r);
  return m;
}
const candleMap = (candleHist) => byHour(candleHist, (c) => [c.o, c.h, c.l, c.c].every(Number.isFinite) && c.c > 0);
const oiMap = (oiHist) => byHour(oiHist, (p) => Number.isFinite(p.price) && p.price > 0);

// q-th quantile of a numeric array (sorted copy, floor index), as the basis read does.
function quantile(arr, q) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}
function median(arr) { return quantile(arr, 0.5); }
// Percentile rank of x among arr, ties counted half (mid-rank): 0 = below everything, 1 = above.
// "In the bottom 20%" = rank ≤ 0.2; "≥ the 90th percentile" = rank ≥ 0.9. A flat history (every value
// equal) ranks 0.5, so it is neither compressed nor extreme.
function pctRank(arr, x) {
  if (!arr.length) return null;
  let below = 0, equal = 0;
  for (const v of arr) { if (v < x) below++; else if (v === x) equal++; }
  return (below + equal / 2) / arr.length;
}

// H4 ATR-14 (fraction of price) from the 80 hourly candles ending at `hour` (inclusive) — the R
// grade's own ruler (axisbt atrPctH4At), restated here so this module imports nothing from axisbt.
function h4AtrFracAt(cbh, hour, lookbackH = 80) {
  const hourly = [];
  for (let h = hour - lookbackH; h <= hour; h++) { const c = cbh.get(h); if (c) hourly.push({ t: Number(c.t) / 1000, h: c.h, l: c.l, c: c.c }); }
  return h4Atr14Frac(hourly);
}

// ── 1 · oi_div_reversal ─────────────────────────────────────────────────────────────────────
// Extreme 24h move (|24h return| ≥ the 90th percentile of |24h return| over the prior 30 days) AND
// OI fell ≥3% over the same 24h → fade it: rally on falling OI → SHORT, drop on falling OI → LONG.
// Cooldown 24h per coin. Rising OI against the move does NOT fire.
export const OI_DIV = Object.freeze({ windowH: 24, lookbackH: MONTH_H, pct: 0.9, oiDrop: 0.03, cooldownH: 24, minHistory: MONTH_H / 2 });
export function oiDivReversalEvents(cs, _pmap, _ctx, p = OI_DIV) {
  const m = oiMap(cs.oiHist);
  const hours = [...m.keys()].sort((a, b) => a - b);
  const ret = new Map(); // hour → { r, oiCh }
  for (const h of hours) {
    const a = m.get(h), b = m.get(h - p.windowH);
    if (!b || !(b.price > 0)) continue;
    const r = a.price / b.price - 1;
    const oiCh = Number(a.oi) > 0 && Number(b.oi) > 0 ? Number(a.oi) / Number(b.oi) - 1 : null;
    ret.set(h, { r, oiCh });
  }
  const ev = [];
  let last = -Infinity;
  for (const h of hours) {
    const x = ret.get(h);
    if (!x || x.oiCh == null || h - last < p.cooldownH) continue;
    const prior = [];
    for (let k = h - p.lookbackH; k < h; k++) { const y = ret.get(k); if (y) prior.push(Math.abs(y.r)); }
    if (prior.length < p.minHistory) continue; // warm-up: half the 30-day window must exist
    if (!(pctRank(prior, Math.abs(x.r)) >= p.pct) || x.r === 0) continue;
    if (!(x.oiCh <= -p.oiDrop)) continue;
    ev.push({ t: m.get(h).t, side: x.r > 0 ? "SHORT" : "LONG" });
    last = h;
  }
  return ev;
}

// ── 2 · vol_breakout — DROPPED for v1 (borst, 2026-10-16) ────────────────────────────────────
// Its power check counted 33 events in 60 days on the main card, a third of the bar. A looser
// version would be a new definition and a new registration; the frozen v1 is in git history.

// ── 3 · session_momentum ────────────────────────────────────────────────────────────────────
// NY open drive: the move from the 13:00 UTC open to the 15:00 UTC close (the 13:00 and 14:00
// bars). If |move| is larger than the median |move| of the SAME 13:00→15:00 window over the prior
// 30 days (borst, 2026-10-16: the NY open compared with itself, not with every 2h), take its
// direction at the 15:00 close. One event per coin per day.
export const SESSION = Object.freeze({ openUtcH: 13, spanH: 2, lookbackDays: 30, minDays: 20 });
export function sessionMomentumEvents(cs, _pmap, _ctx, p = SESSION) {
  const cbh = candleMap(cs.candleHist);
  const hours = [...cbh.keys()].sort((a, b) => a - b);
  const moveAt = (h0) => { const a = cbh.get(h0), b = cbh.get(h0 + p.spanH - 1); return a && b && a.o > 0 ? b.c / a.o - 1 : null; };
  const ev = [];
  for (const h of hours) {
    if (new Date(Number(cbh.get(h).t)).getUTCHours() !== p.openUtcH) continue;
    const mv = moveAt(h);
    if (mv == null || mv === 0) continue;
    const prior = [];
    for (let d = 1; d <= p.lookbackDays; d++) { const x = moveAt(h - d * DAY_H); if (x != null) prior.push(Math.abs(x)); }
    if (prior.length < p.minDays) continue;
    if (!(Math.abs(mv) > median(prior))) continue;
    ev.push({ t: Number(cbh.get(h + p.spanH - 1).t) + H, side: mv > 0 ? "LONG" : "SHORT" });
  }
  return ev;
}

// ── 4 · level_reclaim ───────────────────────────────────────────────────────────────────────
// Levels: the prior UTC day's high and low only. Sweep: price trades ≥ 0.4 × H4 ATR-14 beyond the
// level (ATR as known at the bar before the first breach). Reclaim: an hourly close back through the
// level within 6h of the first breach (the breach bar and the 5 after it; a single bar that sweeps
// and closes back counts). Entry at that close. Prior-day low reclaimed → LONG, high → SHORT. One
// event per level per day: only the day's first breach of each level is judged.
export const LEVEL = Object.freeze({ sweepAtr: 0.4, reclaimH: 6 });
export function levelReclaimEvents(cs, _pmap, _ctx, p = LEVEL) {
  const cbh = candleMap(cs.candleHist);
  const hours = [...cbh.keys()].sort((a, b) => a - b);
  if (!hours.length) return [];
  const dayOf = (h) => Math.floor(h / DAY_H); // UTC day index (candle buckets are whole hours)
  const ev = [];
  const firstDay = dayOf(hours[0]) + 1, lastDay = dayOf(hours[hours.length - 1]);
  for (let d = firstDay; d <= lastDay; d++) {
    const d0 = d * DAY_H; // first hour bucket of day d
    let pdh = -Infinity, pdl = Infinity, full = true;
    for (let h = d0 - DAY_H; h < d0; h++) { const c = cbh.get(h); if (!c) { full = false; break; } pdh = Math.max(pdh, c.h); pdl = Math.min(pdl, c.l); }
    if (!full) continue;
    for (const lvl of [{ side: "LONG", px: pdl, beyond: (c) => c.l < pdl, depth: (c) => (pdl - c.l) / pdl, back: (c) => c.c > pdl },
                       { side: "SHORT", px: pdh, beyond: (c) => c.h > pdh, depth: (c) => (c.h - pdh) / pdh, back: (c) => c.c < pdh }]) {
      let k = null;
      for (let h = d0; h < d0 + DAY_H; h++) { const c = cbh.get(h); if (c && lvl.beyond(c)) { k = h; break; } }
      if (k == null) continue;
      const atr = h4AtrFracAt(cbh, k - 1);
      if (!(atr > 0)) continue;
      let deepest = 0;
      for (let j = k; j < k + p.reclaimH; j++) {
        const c = cbh.get(j);
        if (!c) break;
        deepest = Math.max(deepest, lvl.depth(c));
        if (deepest >= p.sweepAtr * atr && lvl.back(c)) { ev.push({ t: Number(c.t) + H, side: lvl.side }); break; }
      }
    }
  }
  return ev.sort((a, b) => a.t - b.t);
}

// ── 5 · confluence_follow ───────────────────────────────────────────────────────────────────
// The brain's CONFLUENCE rule at its default thresholds (nexus-agent-brain/logic.mjs deriveSignal:
// fundingThreshold 0.01% → 0.0001, oiChangeThreshold 0), traded the OTHER way. Price and OI change
// are measured row over row on oi:hist (hourly; the brain itself compares with a ~5-min-old
// snapshot, which is not recorded). Cooldown 24h per coin (borst, 2026-10-16): without it one
// funding episode fires every hour and the grader would count it as dozens of independent events.
export const CONFLUENCE = Object.freeze({ fundingThreshold: 0.0001, maxGapH: 2, cooldownH: 24 });
export function confluenceFollowEvents(cs, _pmap, _ctx, p = CONFLUENCE) {
  const rows = [...(cs.oiHist || [])].filter((r) => r && Number.isFinite(r.price) && r.price > 0).sort((a, b) => a.t - b.t);
  const ev = [];
  let last = -Infinity;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i], b = rows[i - 1];
    if ((a.t - b.t) / H > p.maxGapH) continue; // a gap is not "the previous snapshot"
    const f = Number(a.funding);
    const fSig = f >= p.fundingThreshold ? "SHORT" : f <= -p.fundingThreshold ? "LONG" : null;
    if (!fSig) continue;
    const dp = a.price - b.price, doi = Number(a.oi) - Number(b.oi);
    if (!Number.isFinite(doi) || doi === 0 || dp === 0) continue;
    // the brain's OI rule, case for case
    const oiSig = dp > 0 && doi < 0 ? "SHORT" : dp < 0 && doi > 0 ? "LONG" : dp > 0 && doi > 0 ? "LONG" : "SHORT";
    if (oiSig !== fSig) continue;
    const h = hourBucket(a.t);
    if (p.cooldownH > 0 && h - last < p.cooldownH) continue;
    ev.push({ t: a.t, side: fSig === "LONG" ? "SHORT" : "LONG" }); // follow = the other way
    last = h;
  }
  return ev;
}

// ── 6 · oi_div_reversal_4h — registered 2026-10-27, counts from 2026-10-28T00:00Z ──────────────
// docs/research/oi-div-reversal-4h-prereg.md. The registered oi_div_reversal rule on a 4h window,
// run through the same code path (only the window, the OI drop and the cooldown differ), so the two
// can't drift apart. Moved unchanged from explorerDraftsB.mjs; borst signed OI −2% and a 12h cooldown.
export const OI_DIV_4H = Object.freeze({ ...OI_DIV, windowH: 4, oiDrop: 0.02, cooldownH: 12 });
export function oiDivReversal4hEvents(cs, pmap, ctx, p = OI_DIV_4H) {
  return oiDivReversalEvents(cs, pmap, ctx, p);
}

// ── 7 · oi_coil_break — registered 2026-10-27, counts from 2026-10-28T00:00Z ─────────────────────────────────────────────────────────────────────────
// Positions build while price goes nowhere, then price leaves the range: follow the break.
// Coil (decided at hour h, from oi:hist): OI rose at least `oiBuild` over the prior 24h AND |24h
// return| is at or below the 30th percentile of |24h return| over the prior 30 days.
// Break: within `breakWithinH` hours after the coil hour, the first hourly candle that CLOSES above
// the high (→ LONG) or below the low (→ SHORT) of the 24 candles ending at the coil hour.
// One event per coil; cooldown 24h per coin. Not vol_breakout (dropped): that needed an ATR squeeze
// and fired a third as often as the bar; this one asks for OI building into a flat tape.
// docs/research/oi-coil-break-prereg.md. Moved from explorerDraftsB.mjs; borst signed OI +3%.
export const OI_COIL = Object.freeze({ windowH: 24, lookbackH: MONTH_H, flatPct: 0.3, oiBuild: 0.03, breakWithinH: 12, cooldownH: 24, minHistory: MONTH_H / 2 });
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

// The four registered 2026-10-16 (docs/research/explorers-prereg.md). Labels are the scoreboard's.
export const EXPLORER_READS = Object.freeze([
  Object.freeze({ name: "level_reclaim", label: "Prior-day high/low swept and reclaimed", gen: levelReclaimEvents }),
  Object.freeze({ name: "oi_div_reversal", label: "Extreme 24h move on falling OI, faded", gen: oiDivReversalEvents }),
  Object.freeze({ name: "session_momentum", label: "NY open drive (13–15 UTC), followed", gen: sessionMomentumEvents }),
  Object.freeze({ name: "confluence_follow", label: "Funding × OI confluence, traded with the crowd", gen: confluenceFollowEvents }),
  // batch 2, registered 2026-10-27 (docs/research/oi-div-reversal-4h-prereg.md)
  Object.freeze({ name: "oi_div_reversal_4h", label: "Extreme 4h move on falling OI, faded", gen: oiDivReversal4hEvents }),
  // batch 2, registered 2026-10-27 (docs/research/oi-coil-break-prereg.md)
  Object.freeze({ name: "oi_coil_break", label: "OI builds into a flat tape, range break followed", gen: oiCoilBreakEvents }),
]);
export const EXPLORER_GENS = Object.freeze(Object.fromEntries(EXPLORER_READS.map((r) => [r.name, r.gen])));
