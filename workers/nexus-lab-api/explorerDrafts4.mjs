// ── Explorer reads, batch 4 — DRAFTS (2026-11-07) ───────────────────────────────────────────────
// docs/research/explorer-drafts-4.md. borst's picks (2026-11-07). What is left here is NOT registered: the
// scoreboard (axisbt AXES) must not import this file and nothing trades these (explorerDrafts4.test.mjs
// fails if either happens). The only thing allowed to run a generator here is the COUNT-ONLY power check
// (tools/explorers/powerCheck.mjs --batch=4). A draft moves UNCHANGED into explorerReads.mjs only when
// borst signs a dated registration; a changed rule after that is a new name.
//
// Built to hold up on new coins: every threshold is relative to the coin's own history (or BTC's), never
// a fixed number tuned on the main card. On 2026-11-07 only level_reclaim held up on the holdout coins;
// the main-card-only winners all failed there.
//
// Generator shape as explorerReads.mjs: (cs, pmap, ctx) → [{ t, side }], decided on data up to and
// including the deciding bar; candle reads stamp at the deciding bar's CLOSE (bar open + 1h), oi:hist
// reads at the row's own time.
import { hourBucket } from "../../app/lib/basisStack.mjs";

const H = 3600000;
const DAY_H = 24;
const MONTH_H = 30 * DAY_H;

// last row per hour wins (the grader's same-hour semantics)
function byHour(rows, ok) {
  const m = new Map();
  for (const r of [...(rows || [])].sort((a, b) => Number(a.t) - Number(b.t))) if (r && ok(r)) m.set(hourBucket(r.t), r);
  return m;
}
// Mid-rank percentile (ties count half), as explorerReads.mjs.
function pctRank(arr, x) {
  if (!arr.length) return null;
  let below = 0, equal = 0;
  for (const v of arr) { if (v < x) below++; else if (v === x) equal++; }
  return (below + equal / 2) / arr.length;
}
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

// A · btc_lead_lag: REGISTERED 2026-11-07 at p90 · lag 0.75 (explorerReads.mjs, btc-lead-lag-prereg.md).
// B · funding_settle_snap: DROPPED (borst 2026-11-07): it passed the count only at p80, which isn't an extreme;
//     the settlement hours were unconfirmed and the 168h R contract can't see an hours-long effect.
// C · level_reclaim_weekly: DROPPED (borst 2026-11-07): 5–19 events per 60 days at every setting.
// The dropped bodies are in git history.

// ── D · funding_basis_split (batch 2's parked D, unchanged in substance) ─────────────────────────
// The two leverage prices disagree. At an oi:hist row (hour h) with a basis:hist row in the same hour:
//   funding ranks ≥ 80th percentile of the coin's prior 30 days (longs paying) AND the spot-perp basis is
//   at or below its own prior-30-day median (the perp isn't bid up the way funding says) → SHORT;
//   the mirror (funding ≤ 20th, basis ≥ median) → LONG.
// The reading: the funding print lags the tape; the crowd it describes is already leaving. Each series
// needs ≥ 360 prior hours. Cooldown 24h per coin. basis:hist had holes before the paced snapshotFlow fix
// (CLAUDE.md): counted as it stands.
export const SPLIT = Object.freeze({ lookbackH: MONTH_H, minHistory: 360, hi: 0.8, lo: 0.2, cooldownH: 24 });
export function fundingBasisSplitEvents(cs, _pmap, _ctx, p = SPLIT) {
  const m = byHour(cs.oiHist, (r) => Number.isFinite(Number(r.funding)) && Number(r.price) > 0);
  const bm = byHour(cs.basisHist, (r) => Number.isFinite(Number(r.basisPct)));
  if (!m.size || !bm.size) return [];
  const hours = [...m.keys()].sort((a, b) => a - b);
  const bHours = [...bm.keys()].sort((a, b) => a - b);
  const ev = [];
  let last = -Infinity;
  for (const h of hours) {
    if (h - last < p.cooldownH) continue;
    const b = bm.get(h);
    if (!b) continue;
    const fPrior = [], bPrior = [];
    for (const k of hours) { if (k >= h) break; if (k >= h - p.lookbackH) fPrior.push(Number(m.get(k).funding)); }
    for (const k of bHours) { if (k >= h) break; if (k >= h - p.lookbackH) bPrior.push(Number(bm.get(k).basisPct)); }
    if (fPrior.length < p.minHistory || bPrior.length < p.minHistory) continue;
    const fr = pctRank(fPrior, Number(m.get(h).funding));
    const bmed = median(bPrior), bx = Number(b.basisPct);
    const side = fr >= p.hi && bx <= bmed ? "SHORT" : fr <= p.lo && bx >= bmed ? "LONG" : null;
    if (!side) continue;
    ev.push({ t: m.get(h).t, side });
    last = h;
  }
  return ev;
}

// D is PARKED (borst 2026-11-07) until it is counted on the basis history route.
export const DRAFT_READS_4 = Object.freeze([
  Object.freeze({ name: "funding_basis_split", label: "Funding and basis disagree: follow the basis", gen: fundingBasisSplitEvents }),
]);
export const DRAFT_GENS_4 = Object.freeze(Object.fromEntries(DRAFT_READS_4.map((r) => [r.name, r.gen])));
