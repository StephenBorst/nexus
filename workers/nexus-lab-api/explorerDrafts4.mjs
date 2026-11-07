// ── Explorer reads, batch 4 — DRAFTS (2026-11-07) ───────────────────────────────────────────────
// docs/research/explorer-drafts-4.md. borst's picks (2026-11-07): all four below. NOT registered: the
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
// reads at the row's own time. ctx.btcCandles = BTC's hour → candle map (axisbt passes it to every
// generator; candlesByHour).
import { hourBucket } from "../../app/lib/basisStack.mjs";
import { h4Atr14Frac } from "../../app/lib/atr.mjs";

const H = 3600000;
const DAY_H = 24;
const WEEK_H = 7 * DAY_H;
const MONTH_H = 30 * DAY_H;

// last row per hour wins (the grader's same-hour semantics)
function byHour(rows, ok) {
  const m = new Map();
  for (const r of [...(rows || [])].sort((a, b) => Number(a.t) - Number(b.t))) if (r && ok(r)) m.set(hourBucket(r.t), r);
  return m;
}
const candleMap = (candleHist) => byHour(candleHist, (c) => [c.o, c.h, c.l, c.c].every(Number.isFinite) && c.c > 0);
const oiMap = (oiHist) => byHour(oiHist, (p) => Number.isFinite(p.price) && p.price > 0);
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
// H4 ATR-14 (fraction of price) from the 80 hourly candles ending at `hour` (inclusive): the R grade's ruler.
function atrAt(cbh, hour) {
  const hourly = [];
  for (let h = hour - 80; h <= hour; h++) { const c = cbh.get(h); if (c) hourly.push({ t: Number(c.t) / 1000, h: c.h, l: c.l, c: c.c }); }
  return h4Atr14Frac(hourly);
}

// ── A · btc_lead_lag ──────────────────────────────────────────────────────────────────────────
// BTC makes an outsized 1h move (|1h return| ≥ the 95th percentile of its own prior 30 days, ≥ 360 hours);
// an alt that moved less than HALF of BTC's move in BTC's direction that same hour (or the other way) is
// lagging. Follow BTC on the alt at that bar's close. Alts only (BTC never fires). Cooldown 12h per coin.
// Why: information reaches BTC first; alts with beta > 1 usually move MORE than BTC, so one that moved less
// than half hasn't caught up. Uses only candle:hist (ours and BTC's).
export const LEAD_LAG = Object.freeze({ pct: 0.95, lookbackH: MONTH_H, minHistory: 360, lagFrac: 0.5, cooldownH: 12 });
export function btcLeadLagEvents(cs, _pmap, ctx = {}, p = LEAD_LAG) {
  if (String(cs.coin || "").toUpperCase() === "BTC") return [];
  const btc = ctx.btcCandles instanceof Map ? ctx.btcCandles : null;
  if (!btc || !btc.size) return [];
  const cbh = candleMap(cs.candleHist);
  const btcRet = new Map();
  for (const h of btc.keys()) { const a = btc.get(h), b = btc.get(h - 1); if (b && b.c > 0 && a.c > 0) btcRet.set(h, a.c / b.c - 1); }
  const hours = [...cbh.keys()].sort((a, b) => a - b);
  const ev = [];
  let last = -Infinity;
  for (const h of hours) {
    if (h - last < p.cooldownH) continue;
    const r = btcRet.get(h);
    if (r == null || r === 0) continue;
    const a = cbh.get(h), b = cbh.get(h - 1);
    if (!b) continue;
    const prior = [];
    for (let k = h - p.lookbackH; k < h; k++) { const x = btcRet.get(k); if (x != null) prior.push(Math.abs(x)); }
    if (prior.length < p.minHistory) continue;
    if (!(pctRank(prior, Math.abs(r)) >= p.pct)) continue;
    const alt = a.c / b.c - 1;
    if (!(Math.sign(r) * alt < p.lagFrac * Math.abs(r))) continue;
    ev.push({ t: Number(a.t) + H, side: r > 0 ? "LONG" : "SHORT" });
    last = h;
  }
  return ev;
}

// ── B · funding_settle_snap ───────────────────────────────────────────────────────────────────
// Orderly funds every 8h (app/lib/funding.mjs). ASSUMED settlement hours 00:00 / 08:00 / 16:00 UTC: to be
// confirmed per market against Orderly's funding endpoint before registration (this session can't reach
// Orderly). At a settlement hour S:
//   crowded: the funding on the last oi:hist row before S (the row in hour S−1) ranks ≥ 90th percentile of
//            the coin's own prior 30 days of rows (longs pay) or ≤ 10th (shorts pay), ≥ 360 rows;
//   unwind:  over the two hourly bars before S (S−2 open → S−1 close) price moved AGAINST the payers by at
//            least 0.5 × H4 ATR-14 (ATR at bar S−3);
//   entry:   at S−1's close (= S), WITH the payers: longs paid → LONG, shorts paid → SHORT.
// The claim: payers close just before the stamp to skip it, pushing price away; once it's paid, the
// dislocation snaps back. One event per settlement per coin.
// ⚠ The effect, if real, lives in hours. The pipeline's bar is the R contract (up to 168h): it may not see
// it. That is a reason this draft can fail, not a reason to change the bar.
export const SETTLE = Object.freeze({ hoursUtc: Object.freeze([0, 8, 16]), lookbackH: MONTH_H, minHistory: 360, hi: 0.9, lo: 0.1, unwindAtr: 0.5 });
export function fundingSettleSnapEvents(cs, _pmap, _ctx, p = SETTLE) {
  const cbh = candleMap(cs.candleHist);
  const fm = byHour(cs.oiHist, (r) => Number.isFinite(Number(r.funding)));
  if (!cbh.size || !fm.size) return [];
  const fHours = [...fm.keys()].sort((a, b) => a - b);
  const hours = [...cbh.keys()].sort((a, b) => a - b);
  const ev = [];
  for (const h of hours) {
    const S = h + 1; // bar h closes at S
    if (!p.hoursUtc.includes(((S % DAY_H) + DAY_H) % DAY_H)) continue;
    const row = fm.get(h);
    if (!row) continue;
    const f = Number(row.funding);
    const prior = [];
    for (const k of fHours) { if (k >= h) break; if (k >= h - p.lookbackH) prior.push(Number(fm.get(k).funding)); }
    if (prior.length < p.minHistory) continue;
    const rank = pctRank(prior, f);
    const payers = rank >= p.hi && f > 0 ? "LONG" : rank <= p.lo && f < 0 ? "SHORT" : null;
    if (!payers) continue;
    const c1 = cbh.get(h), c0 = cbh.get(h - 1);
    if (!c0 || !Number.isFinite(c0.o) || !(c0.o > 0)) continue;
    const atr = atrAt(cbh, h - 2);
    if (!(atr > 0)) continue;
    const move = c1.c / c0.o - 1;
    const against = payers === "LONG" ? -move : move;
    if (!(against >= p.unwindAtr * atr)) continue;
    ev.push({ t: Number(c1.t) + H, side: payers });
  }
  return ev;
}

// ── C · level_reclaim_weekly ──────────────────────────────────────────────────────────────────
// level_reclaim's rule on the prior WEEK's high and low (UTC weeks from Monday 00:00; all 168 bars present).
// Sweep: the week's first breach of a level trades ≥ 0.4 × H4 ATR-14 beyond it (ATR at the bar before the
// breach); reclaim: an hourly close back through the level within 6h of that breach. Entry at that close.
// Prior-week low reclaimed → LONG, high → SHORT. One event per level per week.
// A close cousin of the only read that held up on new coins. It is one bet with level_reclaim when the two
// fire together (a prior-week low is often the prior-day low too): it goes in the overlap block.
export const LEVEL_WEEK = Object.freeze({ sweepAtr: 0.4, reclaimH: 6 });
const MONDAY_OFFSET_H = 4 * DAY_H; // hour 0 of the Unix epoch is a Thursday; Monday 00:00 UTC = +96h (mod 168)
export function levelReclaimWeeklyEvents(cs, _pmap, _ctx, p = LEVEL_WEEK) {
  const cbh = candleMap(cs.candleHist);
  const hours = [...cbh.keys()].sort((a, b) => a - b);
  if (!hours.length) return [];
  const weekOf = (h) => Math.floor((h - MONDAY_OFFSET_H) / WEEK_H);
  const ev = [];
  for (let w = weekOf(hours[0]) + 1; w <= weekOf(hours[hours.length - 1]); w++) {
    const w0 = w * WEEK_H + MONDAY_OFFSET_H;
    let pwh = -Infinity, pwl = Infinity, full = true;
    for (let h = w0 - WEEK_H; h < w0; h++) { const c = cbh.get(h); if (!c) { full = false; break; } pwh = Math.max(pwh, c.h); pwl = Math.min(pwl, c.l); }
    if (!full) continue;
    for (const lvl of [{ side: "LONG", beyond: (c) => c.l < pwl, depth: (c) => (pwl - c.l) / pwl, back: (c) => c.c > pwl },
                       { side: "SHORT", beyond: (c) => c.h > pwh, depth: (c) => (c.h - pwh) / pwh, back: (c) => c.c < pwh }]) {
      let k = null;
      for (let h = w0; h < w0 + WEEK_H; h++) { const c = cbh.get(h); if (c && lvl.beyond(c)) { k = h; break; } }
      if (k == null) continue;
      const atr = atrAt(cbh, k - 1);
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

export const DRAFT_READS_4 = Object.freeze([
  Object.freeze({ name: "btc_lead_lag", label: "BTC impulse, lagging alt follows", gen: btcLeadLagEvents }),
  Object.freeze({ name: "funding_settle_snap", label: "Pre-settlement unwind by the payers, snapped back", gen: fundingSettleSnapEvents }),
  Object.freeze({ name: "level_reclaim_weekly", label: "Prior-week high/low swept and reclaimed", gen: levelReclaimWeeklyEvents }),
  Object.freeze({ name: "funding_basis_split", label: "Funding and basis disagree: follow the basis", gen: fundingBasisSplitEvents }),
]);
export const DRAFT_GENS_4 = Object.freeze(Object.fromEntries(DRAFT_READS_4.map((r) => [r.name, r.gen])));
