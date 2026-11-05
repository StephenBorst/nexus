// ── level_reclaim — ONE rule for the grader and the agent ────────────────────────────────────
// The registered read (docs/research/explorers-prereg.md, out of sample from 2026-10-17). The body
// of `levelReclaimEvents` moved here UNCHANGED from workers/nexus-lab-api/explorerReads.mjs (which
// re-exports it), so the scoreboard's grader and the brain's live gate call the same function and
// cannot drift — the guarantee basisFade.mjs / basisStack.mjs give the basis reads.
//
// The agent side (`levelReclaimLive`) is STAGED and OFF (pipeline-if-then.md, Edge: "the agent rule
// for it, with a parity test … It stays off: no preset, no mode in the Lab, no wallet"). The brain
// computes it only behind worker var LEVEL_RECLAIM_LIVE (commented out in wrangler.toml) and only
// for PAPER configs. A changed rule = a new name and a new registration; this body is frozen.
//
// Pure: no fetch, no KV. Input: candle:hist [{t (ms, bar open), o, h, l, c, v}] (hourly, brain).
import { hourBucket } from "./basisStack.mjs";
import { h4Atr14Frac } from "./atr.mjs";

const H = 3600000;
const DAY_H = 24;

// last row per hour wins (the grader's same-hour semantics)
function byHour(rows, ok) {
  const m = new Map();
  for (const r of [...(rows || [])].sort((a, b) => Number(a.t) - Number(b.t))) if (r && ok(r)) m.set(hourBucket(r.t), r);
  return m;
}
const candleMap = (candleHist) => byHour(candleHist, (c) => [c.o, c.h, c.l, c.c].every(Number.isFinite) && c.c > 0);

// H4 ATR-14 (fraction of price) from the 80 hourly candles ending at `hour` (inclusive) — the R
// grade's own ruler (axisbt atrPctH4At).
function h4AtrFracAt(cbh, hour, lookbackH = 80) {
  const hourly = [];
  for (let h = hour - lookbackH; h <= hour; h++) { const c = cbh.get(h); if (c) hourly.push({ t: Number(c.t) / 1000, h: c.h, l: c.l, c: c.c }); }
  return h4Atr14Frac(hourly);
}

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

// ── The live gate (STAGED, off) ──────────────────────────────────────────────────────────────
// The brain runs every ~5 min and appends each hourly candle once it has CLOSED, so an event (stamped
// at its reclaim bar's close) shows up on the first tick after that close. The gate fires an event
// for LIVE_MAX_AGE_MS after its stamp: the grader enters at that hour's price (the oi:hist row at the
// top of the hour), and exec takes each event once (its `t` is the signal's `sourceT`). Older events,
// or candles that have stopped arriving, sit out with the reason — never a guess.
export const LEVEL_LIVE = Object.freeze({ maxAgeMs: H, staleMs: 3 * H });
export function levelReclaimLive(candleHist, now = Date.now(), p = LEVEL_LIVE) {
  const rows = (candleHist || []).filter((c) => c && Number.isFinite(Number(c.t)) && Number(c.t) + H <= now);
  if (!rows.length) return { side: null, t: null, reason: "no closed candles recorded" };
  const lastClose = Math.max(...rows.map((c) => Number(c.t))) + H;
  if (now - lastClose > p.staleMs) return { side: null, t: null, reason: `candles stale (${Math.round((now - lastClose) / H)}h)` };
  const ev = levelReclaimEvents({ candleHist: rows });
  const fresh = ev.filter((e) => e.t <= now && now - e.t < p.maxAgeMs);
  if (!fresh.length) return { side: null, t: null, reason: "no prior-day level swept and reclaimed this hour" };
  const e = fresh[fresh.length - 1];
  return { side: e.side, t: e.t, reason: e.side === "LONG" ? "prior-day low swept and reclaimed" : "prior-day high swept and reclaimed" };
}

// The agent side is PAPER ONLY until a live-money review says otherwise (like the graded exit).
export const usesLevelReclaim = (config) => config?.signalMode === "LEVEL_RECLAIM";
export function levelReclaimRefusal(config) {
  if (!usesLevelReclaim(config)) return null;
  return config.mode === "PAPER" ? null : "level_reclaim is paper only: no live trading without its own review";
}

// ── The paper wallet's config, as registered (2026-11-05) ────────────────────────────────────
// pipeline-if-then.md, Tradeable: "borst sets up one paper wallet for it with the preset as registered, on the main
// coins only." level_reclaim was served TRADEABLE on 2026-11-05. borst's call: a FRESH wallet (a zero-start record),
// loaded through a hidden link (/lab?tab=agent&deploy=level-reclaim-paper), not a public preset, until that wallet
// has 30 paper trades with parity CLEAN. Exactly what was graded: the registered rule, the graded exit (R contract,
// 168h, no other exit parts), the scoreboard's main-card coins (SUI is on the holdout line), no filters the grader
// doesn't simulate, caps wide enough never to bind (parity explains any that do).
export const LEVEL_RECLAIM_DEPLOY = "level-reclaim-paper";
export const LEVEL_RECLAIM_MAIN_SYMBOLS = Object.freeze(
  ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ARB", "AVAX", "LINK", "HYPE", "WLD"].map((c) => `PERP_${c}_USDC`),
);
export const LEVEL_RECLAIM_PAPER_CONFIG = Object.freeze({
  mode: "PAPER",
  signalMode: "LEVEL_RECLAIM",
  exitContract: "R_CONTRACT",
  maxHoldHours: 168,
  symbols: [...LEVEL_RECLAIM_MAIN_SYMBOLS],
  leverage: 3,
  capitalPerTrade: 50,
  maxTradesPerDay: 24,
  maxDailyLossUsdc: 1000,
  // no exit parts beyond the graded exit (gradedExitRefusal), no unsimulated gates (paperParity unsimulatedFilters)
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
