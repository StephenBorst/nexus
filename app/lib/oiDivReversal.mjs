// ── oi_div_reversal (24h) and oi_div_reversal_4h — ONE rule for the grader and the agent ─────────────
// The registered reads (docs/research/explorers-prereg.md, out of sample from 2026-10-17;
// docs/research/oi-div-reversal-4h-prereg.md, out of sample from 2026-10-28). Both bodies moved here
// UNCHANGED from workers/nexus-lab-api/explorerReads.mjs (which re-exports them), so the scoreboard's
// grader and the brain's live gate call the same function and cannot drift, the guarantee
// levelReclaim.mjs gives level_reclaim. The helpers below are copied from explorerReads as they were.
// A changed rule = a new name and a new registration; these bodies are frozen.
//
// The agent side trades the 4h read only (served TRADEABLE 2026-11-13, pipeline-if-then.md, Tradeable:
// "borst sets up one paper wallet for it with the preset as registered, on the main coins only"). The
// brain computes it only behind worker var OI_DIV_4H_LIVE and only for PAPER configs.
//
// Pure: no fetch, no KV. Input: oi:hist [{t (ms), price, oi, funding}] (hourly, brain).
import { hourBucket } from "./basisStack.mjs";
import { LEVEL_RECLAIM_MAIN_SYMBOLS } from "./levelReclaim.mjs";

const H = 3600000;
const MONTH_H = 30 * 24;

// last row per hour wins (the grader's same-hour semantics)
function byHour(rows, ok) {
  const m = new Map();
  for (const r of [...(rows || [])].sort((a, b) => Number(a.t) - Number(b.t))) if (r && ok(r)) m.set(hourBucket(r.t), r);
  return m;
}
const oiMap = (oiHist) => byHour(oiHist, (p) => Number.isFinite(p.price) && p.price > 0);

// Percentile rank of x among arr, ties counted half (mid-rank): 0 = below everything, 1 = above.
// "≥ the 90th percentile" = rank ≥ 0.9. A flat history (every value equal) ranks 0.5.
function pctRank(arr, x) {
  if (!arr.length) return null;
  let below = 0, equal = 0;
  for (const v of arr) { if (v < x) below++; else if (v === x) equal++; }
  return (below + equal / 2) / arr.length;
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

// ── 6 · oi_div_reversal_4h — registered 2026-10-27, counts from 2026-10-28T00:00Z ──────────────
// docs/research/oi-div-reversal-4h-prereg.md. The registered oi_div_reversal rule on a 4h window,
// run through the same code path (only the window, the OI drop and the cooldown differ), so the two
// can't drift apart. borst signed OI −2% and a 12h cooldown.
export const OI_DIV_4H = Object.freeze({ ...OI_DIV, windowH: 4, oiDrop: 0.02, cooldownH: 12 });
export function oiDivReversal4hEvents(cs, pmap, ctx, p = OI_DIV_4H) {
  return oiDivReversalEvents(cs, pmap, ctx, p);
}

// ── The live gate (4h read) ──────────────────────────────────────────────────────────────────
// The brain records one oi:hist row per hour, at the top of the hour (oiSnapshotDue), before it
// evaluates any market, and an event is stamped at its row's time. So an event shows up on the tick
// that wrote its row. The gate fires it for OI_DIV_4H_LIVE_RULES.maxAgeMs after its stamp (the grader
// enters at that hour's price), and exec takes each event once (its `t` is the signal's `sourceT`).
// Older events, or a history that has stopped growing, sit out with the reason: never a guess.
export const OI_DIV_4H_LIVE_RULES = Object.freeze({ maxAgeMs: H, staleMs: 3 * H });
export function oiDiv4hLive(oiHist, now = Date.now(), p = OI_DIV_4H_LIVE_RULES) {
  const rows = (oiHist || []).filter((r) => r && Number.isFinite(Number(r.t)) && Number(r.t) <= now);
  if (!rows.length) return { side: null, t: null, reason: "no OI history recorded" };
  const lastT = Math.max(...rows.map((r) => Number(r.t)));
  if (now - lastT > p.staleMs) return { side: null, t: null, reason: `OI history stale (${Math.round((now - lastT) / H)}h)` };
  const ev = oiDivReversal4hEvents({ oiHist: rows });
  const fresh = ev.filter((e) => e.t <= now && now - e.t < p.maxAgeMs);
  if (!fresh.length) return { side: null, t: null, reason: "no extreme 4h move on falling OI this hour" };
  const e = fresh[fresh.length - 1];
  return { side: e.side, t: e.t, reason: e.side === "LONG" ? "extreme 4h drop on falling OI, faded" : "extreme 4h rally on falling OI, faded" };
}

// The agent side is PAPER ONLY. There is no live lift for it: going live is its own review, after its paper run.
export const OI_DIV_4H_MODE = "OI_DIV_4H";
export const usesOiDiv4h = (config) => config?.signalMode === OI_DIV_4H_MODE;
export function oiDiv4hRefusal(config) {
  if (!usesOiDiv4h(config)) return null;
  return config.mode === "PAPER" ? null : "oi_div_reversal_4h is paper only: no live trading without its own review";
}

// ── The paper wallet's config, as registered (2026-11-13) ────────────────────────────────────
// oi_div_reversal_4h was served TRADEABLE on 2026-11-13 (#299). As for level_reclaim: a FRESH wallet (a
// zero-start record), loaded through a hidden link (/lab?tab=agent&deploy=oi-div-4h-paper), not a public
// preset. Exactly what was graded: the registered rule, the graded exit (R contract, 168h, no other exit
// parts), the scoreboard's main-card coins (SUI is on the holdout line), no filters the grader doesn't
// simulate, caps wide enough never to bind (parity explains any that do).
export const OI_DIV_4H_DEPLOY = "oi-div-4h-paper";
export const OI_DIV_4H_PAPER_CONFIG = Object.freeze({
  mode: "PAPER",
  signalMode: OI_DIV_4H_MODE,
  exitContract: "R_CONTRACT",
  maxHoldHours: 168,
  symbols: [...LEVEL_RECLAIM_MAIN_SYMBOLS],
  leverage: 3,
  capitalPerTrade: 50,
  maxTradesPerDay: 24,
  maxDailyLossUsdc: 1000,
  takeProfits: [],
  trailingStopPct: 0,
  breakevenTriggerPct: 0,
  dcaEnabled: false,
  volScaledStops: false,
  invertSignal: false,
  respectRegime: false,
  respectSmartMoney: false,
  maxSignalAgeSec: 0,
});
