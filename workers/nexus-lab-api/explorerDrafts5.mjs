// ── Explorer reads, batch 5 — DRAFTS (2026-11-16) ───────────────────────────────────────────────
// docs/research/scanner-reads-prereg.md. The two Bankr scanners' entry rules, written exactly so the scoreboard can
// run them itself from public price (borst 2026-11-16: "A, defaults OK, write the pages"). NOT registered: the
// scoreboard (axisbt AXES) must not import this file and nothing trades these (explorerDrafts5.test.mjs fails if
// either happens). The only thing allowed to run a generator here is the COUNT-ONLY power check
// (tools/explorers/powerCheck.mjs --batch=5). A draft moves UNCHANGED into explorerReads.mjs only when borst signs
// the page; a changed rule after that is a new name.
//
// Generator shape as explorerReads.mjs: (cs, pmap, ctx) → [{ t, side }], decided on bars up to and including the
// deciding 1h bar, stamped at that bar's CLOSE (bar open + 1h). Input: cs.candleHist [{t (ms, bar open), o,h,l,c,v}].
// Every window walks a fixed number of bars per hour (O(n · window)), per the scoreboard's CPU rule.

const H = 3600000;

/** The coin's hourly bars as a hour-index map (last row per hour wins), finite OHLC, close > 0. */
function hourMap(candleHist) {
  const m = new Map();
  for (const c of [...(candleHist || [])].sort((a, b) => Number(a.t) - Number(b.t))) {
    if (!c || ![c.o, c.h, c.l, c.c].every((x) => Number.isFinite(Number(x))) || !(Number(c.c) > 0)) continue;
    m.set(Math.floor(Number(c.t) / H), { o: +c.o, h: +c.h, l: +c.l, c: +c.c, v: Number(c.v) });
  }
  return m;
}

/**
 * The 4h trend each hourly bar can see at its close: the last COMPLETE UTC 4h bar (all four hours present) closed at
 * or before that close, its close vs the EMA-20 of complete 4h closes (seeded with the first 20 closes' average).
 * "UP" above, "DOWN" below, null before 20 complete 4h bars or on an exact tie. Returns hour → trend.
 */
export function trend4hByHour(hm) {
  const hours = [...hm.keys()].sort((a, b) => a - b);
  const out = new Map();
  let ema = null, seed = [], trend = null;
  const alpha = 2 / 21;
  for (const hr of hours) {
    if (hr % 4 === 3) {                               // this bar closes a UTC 4h window
      const w = [hr - 3, hr - 2, hr - 1, hr].map((k) => hm.get(k));
      if (w.every(Boolean)) {
        const close = w[3].c;
        if (ema == null) { seed.push(close); if (seed.length === 20) ema = seed.reduce((s, x) => s + x, 0) / 20; }
        else ema = ema + alpha * (close - ema);
        trend = ema == null ? null : close > ema ? "UP" : close < ema ? "DOWN" : null;
      }
    }
    out.set(hr, trend);
  }
  return out;
}

// ── A · shelf_breakdown_short (the breakout scanner) ─────────────────────────────────────────────
export const SHELF = Object.freeze({
  lookback: 24,        // the shelf = the lowest low of the prior 24 1h bars (all present)
  untouchedH: 12,      // ...set at least 12 bars before the deciding bar (nothing since traded down to it)
  volBars: 20, volMult: 1.5,   // the deciding bar's volume ≥ 1.5× the average of the prior 20 bars
  sessionFromUtc: 7, sessionToUtc: 21,  // the deciding bar OPENS 07:00–20:00 UTC, Monday–Friday
  cooldownH: 12,
});

/** A 1h close below a 24h shelf untouched for 12h, on 1.5× volume, in session, with the 4h trend down → SHORT. */
export function shelfBreakdownShortEvents(cs, _pmap, _ctx, p = SHELF) {
  const hm = hourMap(cs.candleHist);
  const trend = trend4hByHour(hm);
  const ev = [];
  let last = -Infinity;
  for (const hr of [...hm.keys()].sort((a, b) => a - b)) {
    if (hr - last < p.cooldownH) continue;
    const d = new Date(hr * H), dow = d.getUTCDay(), hh = d.getUTCHours();
    if (dow === 0 || dow === 6 || hh < p.sessionFromUtc || hh >= p.sessionToUtc) continue;
    if (trend.get(hr) !== "DOWN") continue;
    const bar = hm.get(hr);
    let shelf = Infinity, shelfAt = -1, full = true;
    for (let k = hr - p.lookback; k < hr; k++) {
      const b = hm.get(k);
      if (!b) { full = false; break; }
      if (b.l <= shelf) { shelf = b.l; shelfAt = k; }   // ties: the most recent touch counts
    }
    if (!full || !(shelfAt <= hr - p.untouchedH - 1)) continue;
    if (!(bar.c < shelf)) continue;
    let vs = 0, vn = 0;
    for (let k = hr - p.volBars; k < hr; k++) { const v = hm.get(k)?.v; if (Number.isFinite(v)) { vs += v; vn++; } }
    if (vn < p.volBars || !(vs > 0) || !Number.isFinite(bar.v) || !(bar.v >= p.volMult * (vs / vn))) continue;
    ev.push({ t: (hr + 1) * H, side: "SHORT" });
    last = hr;
  }
  return ev;
}

// ── B · bb_rsi_momentum (the momentum hunter) ───────────────────────────────────────────────────
export const BBM = Object.freeze({
  bbBars: 20, bbSd: 2,           // Bollinger 20, 2 standard deviations (population), on 1h closes
  rsiBars: 14, rsiLong: 60, rsiShort: 40,   // Wilder RSI-14 on 1h closes
  rangeBars: 3, rangeWindows: 8, rangeMult: 2,   // skip when the last 3h range > 2× the average 3h range of the prior 24h
  cooldownH: 12,
});

/** Wilder RSI per hour over unbroken runs of hourly bars (a missing hour restarts the warm-up). hour → rsi. */
export function rsiByHour(hm, n = 14) {
  const out = new Map();
  let prev = null, prevHr = null, gains = [], losses = [], ag = null, al = null;
  for (const hr of [...hm.keys()].sort((a, b) => a - b)) {
    const c = hm.get(hr).c;
    if (prevHr == null || hr !== prevHr + 1) { gains = []; losses = []; ag = al = null; prev = c; prevHr = hr; continue; }
    const ch = c - prev, g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
    if (ag == null) {
      gains.push(g); losses.push(l);
      if (gains.length === n) { ag = gains.reduce((s, x) => s + x, 0) / n; al = losses.reduce((s, x) => s + x, 0) / n; }
    } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; }
    if (ag != null) out.set(hr, al === 0 ? (ag === 0 ? 50 : 100) : 100 - 100 / (1 + ag / al));
    prev = c; prevHr = hr;
  }
  return out;
}

const rangeOf = (hm, from, to) => {
  let hi = -Infinity, lo = Infinity;
  for (let k = from; k <= to; k++) { const b = hm.get(k); if (!b) return null; hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); }
  return hi - lo;
};

/** A 1h close outside its 20/2 Bollinger band, RSI-14 past 60/40, with the 4h trend, no volatility burst → follow. */
export function bbRsiMomentumEvents(cs, _pmap, _ctx, p = BBM) {
  const hm = hourMap(cs.candleHist);
  const trend = trend4hByHour(hm), rsi = rsiByHour(hm, p.rsiBars);
  const ev = [];
  let last = -Infinity;
  for (const hr of [...hm.keys()].sort((a, b) => a - b)) {
    if (hr - last < p.cooldownH) continue;
    const tr = trend.get(hr), r = rsi.get(hr);
    if (!tr || r == null) continue;
    const closes = [];
    for (let k = hr - p.bbBars + 1; k <= hr; k++) { const b = hm.get(k); if (!b) break; closes.push(b.c); }
    if (closes.length !== p.bbBars) continue;
    const mid = closes.reduce((s, x) => s + x, 0) / p.bbBars;
    const sd = Math.sqrt(closes.reduce((s, x) => s + (x - mid) ** 2, 0) / p.bbBars);
    const c = hm.get(hr).c;
    const side = tr === "UP" && c > mid + p.bbSd * sd && r > p.rsiLong ? "LONG"
      : tr === "DOWN" && c < mid - p.bbSd * sd && r < p.rsiShort ? "SHORT" : null;
    if (!side) continue;
    const now = rangeOf(hm, hr - p.rangeBars + 1, hr);
    let sum = 0, ok = now != null;
    for (let j = 1; ok && j <= p.rangeWindows; j++) {
      const rg = rangeOf(hm, hr - p.rangeBars + 1 - p.rangeBars * j, hr - p.rangeBars * j);
      if (rg == null) ok = false; else sum += rg;
    }
    if (!ok || !(sum > 0) || now > p.rangeMult * (sum / p.rangeWindows)) continue;
    ev.push({ t: (hr + 1) * H, side });
    last = hr;
  }
  return ev;
}

export const DRAFT_READS_5 = Object.freeze([
  { name: "shelf_breakdown_short", gen: shelfBreakdownShortEvents },
  { name: "bb_rsi_momentum", gen: bbRsiMomentumEvents },
]);
export const DRAFT_GENS_5 = Object.freeze(Object.fromEntries(DRAFT_READS_5.map((r) => [r.name, r.gen])));
