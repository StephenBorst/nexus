// ── AXIS BACKTEST HARNESS — does a read actually PREDICT? ─────────────────────
// The scientist's rig for Sept-14: for each candidate axis, take every hour it fired a
// directional signal, measure the FORWARD price return over the next N hours (strictly
// future to the signal — no lookahead), and pool across coins for statistical power.
// Reports hit-rate + mean forward return (bps) per horizon, plus a walk-forward stability
// check (first half vs second half of the sample must agree in sign). A signal is only
// "PREDICTIVE" if it clears a minimum sample AND is positive AND stable — the same
// discipline that killed the naive dials (in-sample sweeps mislead; always walk-forward).
//
// Signal generators are pure (events from stored series, using only data ≤ the signal
// hour); the CVD + liq-flush ones REUSE the deployed classifiers so the backtest scores
// live behavior. Pure + tested. Fed entirely by the self-logged series (oi/cvd/sm/basis/
// liq:hist) — which is why it only becomes meaningful as that history matures (~Sept 14).
import { hourBucket, priceByHour, cvdSideForRow, smByHour, liqFlushEventsFromHist } from "../../app/lib/basisStack.mjs";
import { h4Atr14Frac } from "../../app/lib/atr.mjs";
import { R_CONTRACT } from "../../app/lib/rContract.mjs";
import { trailingPct, basisExtremeSide, basisDeviationSide } from "../../app/lib/basisFade.mjs";
import { AXIS_EXITS } from "../../app/lib/axisExits.mjs";
import { openPosition, stepExit, closedPnlPct, DEFAULT_FEE_BPS } from "./backtest.mjs";

// hourBucket + the oi:hist price spine live in app/lib/basisStack.mjs (shared with the
// brain's basis×CVD gate); re-exported so existing importers keep working.
export { hourBucket, priceByHour };

// Forward return over `h` hours — NO LOOKAHEAD (outcome strictly after the signal).
export function forwardReturn(pmap, t, h) {
  const h0 = hourBucket(t), p0 = pmap.get(h0), p1 = pmap.get(h0 + h);
  if (!(p0 > 0) || !(p1 > 0)) return null;
  return (p1 - p0) / p0;
}

// P&L of a directional call given the forward return.
export function callPnl(fwdRet, side) { return side === "SHORT" ? -fwdRet : fwdRet; }

// DRIFT BASELINE — what a plain long on this coin made over h hours, averaged over EVERY
// recorded hour (not just the hours a signal fired). A read that only buys in a rising window
// looks good for a reason that has nothing to do with the read; subtracting the coin's own
// drift (a short's baseline = −drift) leaves the part the SIGNAL earned. Same forwardReturn
// as the events, same pmap, so the two can't disagree on what "the move" was. Fraction units.
export function coinDrift(pmap, h) {
  let sum = 0, n = 0;
  // pmap keys are ALREADY hour buckets — don't pass them back through forwardReturn (it re-buckets
  // a timestamp; hourBucket(hourBucket(t)) = 0, which silently emptied the baseline — test caught it).
  for (const [h0, p0] of pmap) { const p1 = pmap.get(h0 + h); if (p0 > 0 && p1 > 0) { sum += (p1 - p0) / p0; n++; } }
  return n ? sum / n : null;
}

// ── Signal generators: (coinSet, priceByHourMap) → [{ t, side }] ──────────────
// coinSet = { coin, oiHist, cvdHist, smHist, candleHist, basisHist, liqHist }.

// Fade the crowd: at each hour with stretched funding, take the contrarian side.
export function fundingFadeEvents(cs, _pmap, { threshold = 0.0001 } = {}) {
  const ev = [];
  for (const p of cs.oiHist || []) {
    if (!p || !Number.isFinite(p.funding) || Math.abs(p.funding) < threshold) continue;
    ev.push({ t: p.t, side: p.funding > 0 ? "SHORT" : "LONG" });
  }
  return ev;
}

// CVD divergence: prior-1h price move vs concurrent aggressor flow (reuses the classifier).
export function cvdDivergenceEvents(cs, pmap) {
  const ev = [];
  for (const c of cs.cvdHist || []) {
    if (!c) continue;
    const sig = cvdSideForRow(c, pmap); // shared with the brain's live basis×CVD gate
    if (sig) ev.push({ t: c.t, side: sig.side });
  }
  return ev;
}

// Smart lean by hour (from sm:hist {t, side}) — smByHour lives in app/lib/basisStack.mjs,
// shared with the brain's live basis×smart gate.

// The "one open door": the funding fade CONDITIONED on smart money agreeing.
export function smartFadeEvents(cs, _pmap, { threshold = 0.0001 } = {}) {
  const sm = smByHour(cs.smHist);
  const ev = [];
  for (const p of cs.oiHist || []) {
    if (!p || !Number.isFinite(p.funding) || Math.abs(p.funding) < threshold) continue;
    const fade = p.funding > 0 ? "SHORT" : "LONG";
    if (sm.get(hourBucket(p.t)) === fade) ev.push({ t: p.t, side: fade });
  }
  return ev;
}

// Baseline for comparison: just follow the smart-money lean.
export function smartFollowEvents(cs) {
  return (cs.smHist || []).filter((s) => s && (s.side === "LONG" || s.side === "SHORT")).map((s) => ({ t: s.t, side: s.side }));
}

// ── Spot-perp BASIS extreme fade (basis:hist {t, basisPct}) ───────────────────
// The perp's premium/discount to spot is INSTANTANEOUS leverage froth (vs funding's
// periodic rate) — the pre-registered "standout lead" (54% win, 12d in-sample). Fade the
// EXTREME: an outlier PREMIUM = crowded longs → SHORT; an outlier DISCOUNT = crowded
// shorts → LONG. "Extreme" = the coin's OWN trailing p90 of |basis| over `window` hours
// ending strictly BEFORE the event (no lookahead), so it adapts per-coin/regime instead of
// a fixed cutoff. Graded on the same frozen R contract as every other axis.
// trailingPct + the basis-extreme rule now live in app/lib/basisFade.mjs so the LIVE
// agent signal and this GRADED read are the same code. Re-exported: public API unchanged.
export { trailingPct };
export function basisExtremeEvents(cs, _pmap, { window = 168, minWarmup = 48, pct = 0.9 } = {}) {
  const rows = (cs.basisHist || []).filter((b) => b && Number.isFinite(b.basisPct)).sort((a, b) => (a.t || 0) - (b.t || 0));
  const ev = [];
  for (let i = 0; i < rows.length; i++) {
    const trail = rows.slice(Math.max(0, i - window), i).map((r) => Math.abs(r.basisPct)); // strictly before i
    const side = basisExtremeSide(trail, rows[i].basisPct, { minWarmup, pct }); // premium→SHORT, discount→LONG
    if (side) ev.push({ t: rows[i].t, side });
  }
  return ev;
}

// ── LIQUIDATION-FLUSH reversion (liq:hist {t, longMag, shortMag}) ─────────────
// A forced-liquidation cascade overshoots then reverts — the confluence search's single
// best timing gate (fading the funding crowd INTO a flush lifted win-rate 38.6%→49%).
// Graded standalone here: a DOWN flush (longs capitulating) = a washout low → LONG; an UP
// flush (shorts squeezed) = a blow-off high → SHORT. Reuses the LIVE classifyFlush (2.5×
// trailing-median spike) so the backtest scores deployed behavior; the trailing history is
// strictly PRIOR to the event bar (no lookahead). The continuation read (DOWN→SHORT) is the
// exact inverse — a one-line follow-up if this reverts negative.
export function liqFlushEvents(cs, _pmap, { minHist = 12 } = {}) {
  // Shared with the brain's live basis×liq-flush gate (app/lib/basisStack.mjs).
  return liqFlushEventsFromHist(cs.liqHist, { minHist });
}

// ── BASIS × conditioner CONFLUENCE (the Sept-14 stack) ────────────────────────
// basis_extreme is the first PREDICTIVE axis, but modest (+0.07R) and lumpy (maxDdR 42). The
// method that got us here = STACK orthogonal tools: take the basis fade ONLY when a second,
// harder-to-arb read AGREES on the same side at that hour. Each conditioner's side is read
// no-lookahead (the SAME series/classifiers as its standalone axis) and intersected with the
// basis event at the SAME hour; the forward outcome is still strictly future. Rare
// intersections → small n → the scorecard flags INSUFFICIENT honestly (confluence is meant to
// be selective). Keep only the conditioners that LIFT stability/expectancy over standalone basis.
function liqFlushSideByHour(cs) {
  const m = new Map();
  for (const e of liqFlushEvents(cs)) m.set(hourBucket(e.t), e.side); // DOWN→LONG / UP→SHORT (revert)
  return m;
}
function cvdSideByHour(cs, pmap) {
  const m = new Map();
  for (const e of cvdDivergenceEvents(cs, pmap)) m.set(hourBucket(e.t), e.side);
  return m;
}
// Take each basis extreme ONLY when `sideByHour` gives the SAME side at that hour.
export function basisConfluenceEvents(cs, pmap, sideByHour) {
  const cond = sideByHour instanceof Map ? sideByHour : new Map();
  return basisExtremeEvents(cs).filter((e) => cond.get(hourBucket(e.t)) === e.side);
}
export function basisXsmartEvents(cs, pmap) { return basisConfluenceEvents(cs, pmap, smByHour(cs.smHist)); }
export function basisXliqEvents(cs, pmap) { return basisConfluenceEvents(cs, pmap, liqFlushSideByHour(cs)); }
export function basisXcvdEvents(cs, pmap) { return basisConfluenceEvents(cs, pmap, cvdSideByHour(cs, pmap)); }

// ── TWO-SIDED basis (vs the trailing mean, not zero) — see basisDeviationSide ──
// Graded BESIDE basis_extreme so the two can be compared on the same data. No preset trades it.
export function basisDevEvents(cs, _pmap, { window = 168, minWarmup = 48, pct = 0.9 } = {}) {
  const rows = (cs.basisHist || []).filter((b) => b && Number.isFinite(b.basisPct)).sort((a, b) => (a.t || 0) - (b.t || 0));
  const ev = [];
  for (let i = 0; i < rows.length; i++) {
    const trail = rows.slice(Math.max(0, i - window), i).map((r) => r.basisPct); // raw, strictly before i
    const side = basisDeviationSide(trail, rows[i].basisPct, { minWarmup, pct });
    if (side) ev.push({ t: rows[i].t, side });
  }
  return ev;
}
export function basisDevXcvdEvents(cs, pmap) {
  const cond = cvdSideByHour(cs, pmap);
  return basisDevEvents(cs).filter((e) => cond.get(hourBucket(e.t)) === e.side);
}

// ── RSI momentum-cooldown continuation (Stoic's H4 study, done rigorously) ────
// EMA of a numeric series.
export function ema(values, period) {
  const out = []; const k = 2 / (period + 1); let prev = null;
  for (const v of values) { prev = prev == null ? v : v * k + prev * (1 - k); out.push(prev); }
  return out;
}
// Wilder's RSI(period) over closes → array aligned to closes (first `period` entries null).
export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const ch = closes[i] - closes[i - 1]; if (ch >= 0) gain += ch; else loss -= ch; }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1], g = ch >= 0 ? ch : 0, l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
// The community claim: in an uptrend, an RSI cooldown that HOLDS the ~45+ shelf then turns
// up = a long continuation; a reset that plunges BELOW 45 = the floor gives way. We test it
// with OUR discipline — the trend is measured AT the reset (price > EMA50, NO lookahead), and
// EVERY qualifying reset is scored forward (including the ones that then failed), so there is
// no survivorship bias (nico_quant's critique). The harness then grades it vs the null baseline.
// `held` true = trough in [floorMin,floorMax] (the shelf); false = trough < floorMin (deep).
export function rsiResetEvents(cs, _pmap, { emaPeriod = 50, rsiPeriod = 14, floorMin = 45, floorMax = 68, held = true } = {}) {
  const rows = (cs.oiHist || []).filter((p) => p && Number.isFinite(p.price) && p.price > 0).sort((a, b) => (a.t || 0) - (b.t || 0));
  if (rows.length < emaPeriod + rsiPeriod + 5) return [];
  const closes = rows.map((r) => r.price);
  const e = ema(closes, emaPeriod), r = rsi(closes, rsiPeriod);
  const ev = [];
  for (let i = 2; i < rows.length - 1; i++) {
    const a = r[i - 2], b = r[i - 1], c = r[i];
    if (a == null || b == null || c == null) continue;
    if (!(a > b && c > b)) continue;                 // b is a local RSI trough turning up
    const onShelf = b >= floorMin && b <= floorMax;
    if (held ? !onShelf : !(b < floorMin)) continue; // held the shelf vs plunged below it
    if (!(closes[i] > e[i])) continue;               // uptrend measured AT the reset (no lookahead)
    ev.push({ t: rows[i].t, side: "LONG" });
  }
  return ev;
}
export function rsiResetDeepEvents(cs, pmap, cfg = {}) { return rsiResetEvents(cs, pmap, { ...cfg, held: false }); }

// ── Grok's map: REGIME gate + RELATIVE STRENGTH (the universe) ────────────────
// "The map is the product; RSI is optional seasoning." Continuation events should only
// fire in a real uptrend, and only on the strong horses. These are the conditioning
// layers to run the A/B/C/D isolation (all → +regime → +RS → +value) on Sept 14.

// trend_up AT bar i, no lookahead: price > EMA50 AND a positive `slope`-bar slope.
export function slopeUp(closes, i, slope = 20) {
  if (i < slope) return false;
  return closes[i] > closes[i - slope];
}
// Relative strength of a coin vs BTC over the aligned window = its return minus BTC's
// (residual). >0 = outperforming BTC (a "fast horse"). Aligns by hour, needs overlap.
export function relStrength(coinSeries, btcSeries, { minSamples = 24 } = {}) {
  const hour = (t) => Math.round(Number(t) / 3600000);
  const cm = new Map(), bm = new Map();
  for (const p of coinSeries || []) if (p && Number.isFinite(p.price) && p.price > 0) cm.set(hour(p.t), p.price);
  for (const p of btcSeries || []) if (p && Number.isFinite(p.price) && p.price > 0) bm.set(hour(p.t), p.price);
  const hrs = [...cm.keys()].filter((h) => bm.has(h)).sort((a, b) => a - b);
  if (hrs.length < minSamples) return null;
  const c0 = cm.get(hrs[0]), c1 = cm.get(hrs[hrs.length - 1]);
  const b0 = bm.get(hrs[0]), b1 = bm.get(hrs[hrs.length - 1]);
  if (!(c0 > 0 && b0 > 0)) return null;
  return Math.round((((c1 - c0) / c0) - ((b1 - b0) / b0)) * 1000) / 1000; // residual return
}

// RSI reset held + REGIME gate (trend_up = price>EMA50 AND 20-bar slope up). Grok's "B".
export function rsiResetTrendEvents(cs, _pmap, opts = {}) {
  const { emaPeriod = 50, rsiPeriod = 14, floorMin = 45, floorMax = 68, slope = 20 } = opts;
  const rows = (cs.oiHist || []).filter((p) => p && Number.isFinite(p.price) && p.price > 0).sort((a, b) => (a.t || 0) - (b.t || 0));
  if (rows.length < emaPeriod + rsiPeriod + slope + 5) return [];
  const closes = rows.map((r) => r.price);
  const e = ema(closes, emaPeriod), r = rsi(closes, rsiPeriod);
  const ev = [];
  for (let i = 2; i < rows.length - 1; i++) {
    const a = r[i - 2], b = r[i - 1], c = r[i];
    if (a == null || b == null || c == null) continue;
    if (!(a > b && c > b) || !(b >= floorMin && b <= floorMax)) continue;
    if (!(closes[i] > e[i]) || !slopeUp(closes, i, slope)) continue; // regime: EMA50 + slope up
    ev.push({ t: rows[i].t, side: "LONG" });
  }
  return ev;
}

// ── Grok's D0/D1: RS + VALUE pullback in a regime, with the BTC hard-veto ─────
// The filter stack: universe (RS>0 vs BTC, computed BEFORE the event) → regime (price >
// EMA50 AND > a value anchor) → BTC gate (a HARD VETO — if BTC is bleeding, no alt
// continuation prints) → value tag (a pullback that's within k×vol of the value anchor).
// RSI is optional seasoning layered ON TOP (D1). ⚠️ oi:hist has no volume/OHLC, so the
// "weekly VWAP" is an SMA value anchor and "ATR" is close-to-close vol — labeled proxies;
// logging real candles is the upgrade. No lookahead: every input ends at the event bar.
export function sma(closes, period, i) {
  if (i < period - 1) return null;
  let s = 0; for (let k = i - period + 1; k <= i; k++) s += closes[k];
  return s / period;
}
export function volProxy(closes, period, i) {
  if (i < period) return null;
  let s = 0; for (let k = i - period + 1; k <= i; k++) s += Math.abs(closes[k] - closes[k - 1]);
  return s / period; // mean absolute close-to-close move ≈ an ATR proxy
}
// BTC regime map (hour → {price, ema}) so an alt event can veto on BTC bleed at its own time.
export function btcRegimeByHour(btcSeries, emaPeriod = 50) {
  const rows = (btcSeries || []).filter((p) => p && Number.isFinite(p.price) && p.price > 0).sort((a, b) => (a.t || 0) - (b.t || 0));
  const closes = rows.map((r) => r.price), e = ema(closes, emaPeriod), m = new Map();
  for (let i = emaPeriod; i < rows.length; i++) m.set(hourBucket(rows[i].t), { price: closes[i], ema: e[i], bleed: closes[i] < e[i] });
  return m;
}
export function rsValuePullbackEvents(cs, _pmap, ctx = {}, opts = {}) {
  const { emaPeriod = 50, anchorPeriod = 168, volPeriod = 24, rsLookback = 168, tagK = 1.0, rsi45 = false } = opts;
  const btcMap = ctx.btcMap, btcPrice = ctx.btcPrice; // hour→regime, hour→price
  const rows = (cs.oiHist || []).filter((p) => p && Number.isFinite(p.price) && p.price > 0).sort((a, b) => (a.t || 0) - (b.t || 0));
  if (!btcMap || !btcPrice || rows.length < Math.max(anchorPeriod, rsLookback) + 5) return [];
  const closes = rows.map((r) => r.price), e = ema(closes, emaPeriod);
  const r14 = rsi45 ? rsi(closes, 14) : null;
  const ev = [];
  for (let i = 2; i < rows.length - 1; i++) {
    const anchor = sma(closes, anchorPeriod, i), vol = volProxy(closes, volPeriod, i);
    if (anchor == null || vol == null || e[i] == null) continue;
    // regime: above EMA50 AND above the value anchor (Grok: not one or the other)
    if (!(closes[i] > e[i] && closes[i] > anchor)) continue;
    // BTC hard veto — no alt continuation while BTC bleeds (or its regime is unknown)
    const hourI = hourBucket(rows[i].t), br = btcMap.get(hourI);
    if (!br || br.bleed) continue;
    // RS BEFORE the event — residual vs BTC over the lookback ending at i
    const bNow = btcPrice.get(hourI), bThen = btcPrice.get(hourI - rsLookback);
    if (!(bNow > 0 && bThen > 0) || i - rsLookback < 0) continue;
    const rs = ((closes[i] - closes[i - rsLookback]) / closes[i - rsLookback]) - ((bNow - bThen) / bThen);
    if (!(rs > 0)) continue; // outperforming BTC
    // value tag — a pullback sitting within k×vol of the value anchor
    if (!(Math.abs(closes[i] - anchor) <= tagK * vol * 6)) continue;
    // optional RSI seasoning (D1): the reset held the 45+ shelf
    if (rsi45) { const b = r14[i]; if (b == null || b < 45) continue; }
    ev.push({ t: rows[i].t, side: "LONG", rs }); // rs (residual vs BTC) from closes → per-event rs_quartile
  }
  return ev;
}
export function rsValuePullbackRsiEvents(cs, pmap, ctx, opts = {}) { return rsValuePullbackEvents(cs, pmap, ctx, { ...opts, rsi45: true }); }

// ── Roadmap #1: REAL candle inputs (candle:hist {t,o,h,l,c,v}) ─────────────────
// The proxies above (SMA weekly-VWAP, close-to-close volProxy) exist only because
// oi:hist carried no OHLC/volume. With candles now logged, compute the REAL weekly
// VWAP and true ATR — same filter stack, better inputs. Keyed by hour so they align
// to the oi price spine; no lookahead (every window ends AT the event bar).
export function candlesByHour(candleHist) {
  const m = new Map();
  for (const c of candleHist || []) {
    if (!c || !Number.isFinite(c.c) || !(c.c > 0)) continue;
    m.set(hourBucket(c.t), c);
  }
  return m;
}
// Volume-weighted typical price over the `period` hours ending at `hour` (inclusive).
// Needs ≥60% of the window present and non-zero volume; else null (caller falls back).
export function vwapAt(cbh, hour, period) {
  let pv = 0, vv = 0, n = 0;
  for (let h = hour - period + 1; h <= hour; h++) {
    const c = cbh.get(h); if (!c) continue;
    const typ = (c.h + c.l + c.c) / 3, v = Number.isFinite(c.v) ? c.v : 0;
    pv += typ * v; vv += v; n++;
  }
  if (n < period * 0.6 || !(vv > 0)) return null;
  return pv / vv;
}
// True ATR as a FRACTION of the last close over `period` hours ending at `hour`. Same
// TR = max(range, |h−prevClose|, |l−prevClose|) as the live atrPct gate. null if thin.
export function atrPctAt(cbh, hour, period) {
  const win = [];
  for (let h = hour - period; h <= hour; h++) { const c = cbh.get(h); if (c) win.push(c); }
  if (win.length < Math.max(4, period * 0.6)) return null;
  let trSum = 0, cnt = 0;
  for (let k = 1; k < win.length; k++) {
    const tr = Math.max(win[k].h - win[k].l, Math.abs(win[k].h - win[k - 1].c), Math.abs(win[k].l - win[k - 1].c));
    if (Number.isFinite(tr)) { trSum += tr; cnt++; }
  }
  const last = win[win.length - 1].c;
  return cnt && last > 0 ? trSum / cnt / last : null;
}

// H4 ATR-14 fraction ending at `hour`, off candle:hist — the SAME object the Lab's live stop
// uses (app/lib/atr.mjs), so gradeEventR places its synthetic stop/TP at exactly the distance
// BUILD IT would have shown that hour. candle:hist stores t in ms → normalize to seconds for
// the shared fn. Needs ~60h (15 H4 bars) of candles before `hour`; null until then (same
// INSUFFICIENT-by-design posture as the rest of the candle path).
export function atrPctH4At(cbh, hour, lookbackH = 80) {
  const hourly = [];
  for (let h = hour - lookbackH; h <= hour; h++) {
    const c = cbh.get(h);
    if (c) hourly.push({ t: Number(c.t) / 1000, h: c.h, l: c.l, c: c.c });
  }
  return h4Atr14Frac(hourly);
}

// ── Roadmap #2: FUTURES-VOLUME ROTATION as a regime input to the BTC veto ──────
// Is capital rotating INTO this coin vs BTC? Compare recent-half vs prior-half mean
// hourly volume over `lookback` hours ending at `hour` (no lookahead). The alt's volume
// must be GROWING faster than BTC's — a rotation-in regime that historically precedes
// alt continuation. Feeds the BTC veto (bleed OR no-rotation → veto). null-safe.
export function volGrowth(cbh, hour, lookback) {
  const half = Math.floor(lookback / 2);
  let recent = 0, rn = 0, prior = 0, pn = 0;
  for (let h = hour - lookback + 1; h <= hour; h++) {
    const c = cbh.get(h); if (!c || !Number.isFinite(c.v)) continue;
    if (h > hour - half) { recent += c.v; rn++; } else { prior += c.v; pn++; }
  }
  if (rn < half * 0.5 || pn < half * 0.5 || !(prior > 0)) return null;
  const rMean = recent / rn, pMean = prior / pn;
  return pMean > 0 ? (rMean - pMean) / pMean : null; // fractional volume growth
}
export function volumeRotatesInto(coinCbh, btcCbh, hour, lookback = 48) {
  const cg = volGrowth(coinCbh, hour, lookback), bg = volGrowth(btcCbh, hour, lookback);
  if (cg == null || bg == null) return false; // thin data → don't claim rotation
  return cg > bg; // alt volume growing faster than BTC's = rotation in
}

// The DEEPEST available hourly price series for a coin, as [{t, price}] — prefers candle:hist
// closes (backfilled ~90d from tv/history) over oi:hist (still shallow). This is what turns the
// candle axes on with candle DEPTH rather than oi maturity: "candle:hist depth → D0_candle on".
export function priceSeries(cs) {
  const fromCandle = (cs?.candleHist || []).filter((c) => c && Number.isFinite(c.c) && c.c > 0).map((c) => ({ t: c.t, price: c.c }));
  const fromOi = (cs?.oiHist || []).filter((p) => p && Number.isFinite(p.price) && p.price > 0).map((p) => ({ t: p.t, price: p.price }));
  return (fromCandle.length >= fromOi.length ? fromCandle : fromOi).sort((a, b) => (a.t || 0) - (b.t || 0));
}

// D0c / D2: the RS + value pullback stack, but on REAL candle inputs (weekly VWAP anchor,
// true ATR value-tag band), with the BTC hard-veto optionally EXTENDED by the volume-
// rotation gate (requireRotation). Returns [] when candles aren't logged yet → the axis
// reads INSUFFICIENT until the series matures (~Sept 14), by design.
export function rsValuePullbackCandleEvents(cs, _pmap, ctx = {}, opts = {}) {
  const { emaPeriod = 50, anchorPeriod = 168, atrPeriod = 24, rsLookback = 168, tagK = 2, rsi45 = false, requireRotation = false, rotLookback = 48 } = opts;
  const btcMap = ctx.btcMap, btcPrice = ctx.btcPrice, btcCbh = ctx.btcCandles;
  const cbh = candlesByHour(cs.candleHist);
  const rows = priceSeries(cs); // deepest series — candle closes (backfilled) preferred over oiHist
  if (!cbh.size || !btcMap || !btcPrice || rows.length < Math.max(anchorPeriod, rsLookback) + 5) return [];
  const closes = rows.map((r) => r.price), e = ema(closes, emaPeriod);
  const r14 = rsi45 ? rsi(closes, 14) : null;
  const ev = [];
  for (let i = 2; i < rows.length - 1; i++) {
    const hourI = hourBucket(rows[i].t);
    const anchor = vwapAt(cbh, hourI, anchorPeriod);   // REAL weekly VWAP
    const atr = atrPctAt(cbh, hourI, atrPeriod);        // REAL ATR (fraction of price)
    if (anchor == null || atr == null || e[i] == null) continue;
    if (!(closes[i] > e[i] && closes[i] > anchor)) continue;            // regime: EMA50 + value anchor
    const br = btcMap.get(hourI);
    if (!br || br.bleed) continue;                                       // BTC hard veto (price bleed)
    if (requireRotation) {                                              // …extended by volume rotation
      if (!btcCbh || !volumeRotatesInto(cbh, btcCbh, hourI, rotLookback)) continue;
    }
    const bNow = btcPrice.get(hourI), bThen = btcPrice.get(hourI - rsLookback);
    if (!(bNow > 0 && bThen > 0) || i - rsLookback < 0) continue;
    const rs = ((closes[i] - closes[i - rsLookback]) / closes[i - rsLookback]) - ((bNow - bThen) / bThen);
    if (!(rs > 0)) continue;                                            // outperforming BTC (RS before the event)
    if (!(Math.abs(closes[i] - anchor) <= tagK * atr * closes[i])) continue; // value tag: within tagK ATRs of VWAP
    if (rsi45) { const b = r14[i]; if (b == null || b < 45) continue; }
    ev.push({ t: rows[i].t, side: "LONG", rs }); // rs (residual vs BTC) from closes → per-event rs_quartile
  }
  return ev;
}
export function rsValuePullbackRotationEvents(cs, pmap, ctx, opts = {}) { return rsValuePullbackCandleEvents(cs, pmap, ctx, { ...opts, requireRotation: true }); }
// D1_candle = D0_candle + the RSI≥45 filter — the ONLY difference from D0_candle, so the
// A/B ablation is valid (same entry/stop/tp/time-stop, frozen in gradeEventR).
export function rsValuePullbackCandleRsiEvents(cs, pmap, ctx, opts = {}) { return rsValuePullbackCandleEvents(cs, pmap, ctx, { ...opts, rsi45: true }); }

// ── Scoring: pool events across coins, aggregate forward P&L per horizon ──────
function agg(arr) {
  if (!arr.length) return { samples: 0, hitRate: 0, meanBps: 0 };
  const wins = arr.reduce((n, x) => n + (x > 0 ? 1 : 0), 0);
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  return { samples: arr.length, hitRate: Math.round((wins / arr.length) * 100), meanBps: Math.round(mean * 100000) / 10 };
}

// ── THESIS-IN-R grading (Grok #2) — the ONE grader, at the harness ────────────
// Forward-bps answers "did price drift our way?" — a DIFFERENT object than the R-graded
// thesis record (gradeCall) that Catalyst + human calls use. To grade all producers on ONE
// scale for Sept-14, grade each harness event in R: first-touch TP vs SL with a stop = 1.2×
// true ATR (Grok's spec), target = rMultiple × risk — identical first-touch logic to gradeCall
// (same-bar both = loss, conservative). Timeout = mark-to-market R at the last close. Needs
// candle highs/lows → null until candle:hist matures (INSUFFICIENT by design, same as D0/D2).
// ⚠️ FROZEN CONTRACT (Grok) — do NOT vary these or the D0/D1 ablation dies: stop = 1.2× ATR
// (never tighter), tp = 1.5R, time-stop = 168h (7d), same-bar TP+SL = loss, time-stop / no
// touch = 0 (flat — credit NO unrealized drift). Outcomes are exactly +tp_R, −1, or 0.
// The ruler is H4 ATR-14 (the ONE shared ATR); the multiples are frozen. Changing the ruler,
// not the multiples: 1.2× ATR stop, 1.5R target, 7d hold — the SAME contract BUILD IT applies.
// No atrPeriod knob — H4 ATR-14 has a fixed period (that's the point: one number, no wrappers).
// The frozen object now lives in ONE module (app/lib/rContract.mjs); imported above and
// re-exported here so axisbt's public surface is unchanged. Do NOT vary the values.
export { R_CONTRACT };
export function gradeEventR(cbh, eventHour, side, entry, opts = R_CONTRACT) {
  const { atrMult, rMultiple, maxHoldH } = { ...R_CONTRACT, ...opts };
  if (!cbh || !cbh.size || !(entry > 0)) return null;
  const atrFrac = atrPctH4At(cbh, eventHour);
  if (atrFrac == null || !(atrFrac > 0)) return null;
  const risk = entry * atrFrac * atrMult;
  if (!(risk > 0)) return null;
  const long = side === "LONG";
  const stop = long ? entry - risk : entry + risk;
  const target = long ? entry + rMultiple * risk : entry - rMultiple * risk;
  for (let h = eventHour + 1; h <= eventHour + maxHoldH; h++) {
    const c = cbh.get(h); if (!c) continue;
    if (long) {
      const tp = c.h >= target, sl = c.l <= stop;
      if (tp && sl) return -1;      // same-bar both → loss (conservative, matches gradeCall)
      if (tp) return rMultiple;
      if (sl) return -1;
    } else {
      const tp = c.l <= target, sl = c.h >= stop;
      if (tp && sl) return -1;
      if (tp) return rMultiple;
      if (sl) return -1;
    }
  }
  return 0; // time-stop / no touch → flat, credit no unrealized drift (frozen contract)
}
// ── EXIT-MATCHED grading — the read, traded through a PRESET's own exit ──────────
// The horizons above answer "where was price N hours later?" and the R contract grades a
// frozen 1.5R/168h exit. Neither is what a preset trades. This walks the SAME hourly
// candles through the backtest's stepExit (→ the exec's evaluateExit): tp% / sl% /
// maxHoldHours, adverse-extreme-first inside a bar (same-bar stop + target = stop), the
// timeout closing on the bar where the hold is reached. Entry = the price-spine price at
// the event hour (the same entry the horizons and R use). Right-censored: a trade that has
// not exited by the end of the logged candles (or across a data gap past the hold + grace)
// returns null — it is left out, never credited.
export const EXIT_GRACE_H = 6;
export function gradeEventExit(cbh, eventHour, side, entry, exit) {
  if (!cbh || !cbh.size || !(entry > 0) || !exit) return null;
  const config = { tpPercent: exit.tpPercent, slPercent: exit.slPercent, maxHoldHours: exit.maxHoldHours };
  const maxH = (Number(exit.maxHoldHours) > 0 ? Number(exit.maxHoldHours) : R_CONTRACT.maxHoldH) + EXIT_GRACE_H;
  const pos = openPosition(config, side, entry, eventHour * 3600);
  for (let h = eventHour + 1; h <= eventHour + maxH; h++) {
    const c = cbh.get(h); if (!c || !Number.isFinite(c.h) || !Number.isFinite(c.l)) continue;
    const hit = stepExit(pos, c, (h - eventHour) * 3600000, config);
    if (hit) return { pnlPct: closedPnlPct(pos, hit.px), reason: hit.reason, holdH: h - eventHour };
  }
  return null;
}
// The hold-horizon finding (12h preset exit graded NOISE while 24h graded PREDICTIVE) was
// made on data up to here. The 24h variant was CHOSEN from that data, so its in-sample grade
// flatters it by construction; `oos` counts only trades entered after this instant — the
// honest test of the choice.
export const EXIT_OOS_CUTOFF_MS = Date.parse("2026-09-25T04:00:00Z");
// Exit variants graded side by side for every preset-traded read. Display only — the presets
// and the running agent configs are untouched.
export const EXIT_VARIANTS = Object.freeze([
  Object.freeze({ key: "exit", override: {}, preset: true }),
  Object.freeze({ key: "exit24h", override: { maxHoldHours: 24 }, preset: false }),
]);

// Trades the agent could actually take: ONE position per market (the next entry needs the
// last one closed — same bar re-entry refused, as the backtest's cooldown), and only entries
// at least `windowH` hours before the end of that market's candles, so every variant compared
// sees the same entry window (a 24h trade near the end can't resolve yet; a 12h one could).
export function tradeableExitTrades(all, exit, windowH = Number(exit?.maxHoldHours) || 0) {
  const byMkt = new Map();
  for (const e of all || []) {
    const k = e.coin ?? e.cbh;
    if (!byMkt.has(k)) byMkt.set(k, []);
    byMkt.get(k).push(e);
  }
  const out = [];
  for (const evs of byMkt.values()) {
    const cbh = evs[0].cbh;
    if (!cbh || !cbh.size) continue;
    let lastH = -Infinity;
    for (const h of cbh.keys()) if (h > lastH) lastH = h;
    evs.sort((a, b) => a.t - b.t);
    let busyThrough = -Infinity;
    for (const e of evs) {
      const h0 = hourBucket(e.t);
      if (h0 > lastH - windowH || h0 <= busyThrough) continue;
      const g = gradeEventExit(cbh, h0, e.side, e.pmap.get(h0), exit);
      if (!g) continue;
      busyThrough = h0 + g.holdH;
      out.push({ t: e.t, side: e.side, ...g });
    }
  }
  return out;
}

// Pool exit-graded trades → the same verdict discipline as the horizons, but on NET bps
// (round-trip taker fee deducted — the agent pays it; the horizons are gross).
export function scoreExit(all, exit, medT, minSamples, feeBps = DEFAULT_FEE_BPS, windowH = Number(exit?.maxHoldHours) || 0, oosCutoff = EXIT_OOS_CUTOFF_MS) {
  const feePct = (feeBps / 100) * 2;
  const net = [], fst = [], snd = [], oos = [], exits = { TP: 0, SL: 0, TIMEOUT: 0 };
  const bySideNet = { LONG: [], SHORT: [] };
  let holdSum = 0;
  for (const g of tradeableExitTrades(all, exit, windowH)) {
    const n = (g.pnlPct - feePct) / 100; // fraction, same unit agg() expects
    net.push(n); (g.t <= medT ? fst : snd).push(n);
    if (g.t > oosCutoff) oos.push(n);
    if (bySideNet[g.side]) bySideNet[g.side].push(n);
    exits[g.reason] = (exits[g.reason] || 0) + 1;
    holdSum += g.holdH;
  }
  const a = agg(net), f = agg(fst), s = agg(snd), o = agg(oos);
  const stable = f.samples >= 5 && s.samples >= 5 && (f.meanBps > 0) === (s.meanBps > 0);
  let verdict = "INSUFFICIENT";
  if (a.samples >= minSamples) verdict = a.meanBps > 0 && stable ? "PREDICTIVE" : a.meanBps > 0 ? "PROMISING" : "NOISE";
  return {
    preset: exit.preset, tpPercent: exit.tpPercent, slPercent: exit.slPercent, maxHoldHours: exit.maxHoldHours, feeBps,
    samples: a.samples, hitRate: a.hitRate, netBps: a.meanBps, stable, verdict, exits,
    avgHoldH: a.samples ? Math.round((holdSum / a.samples) * 10) / 10 : 0,
    oos: { since: new Date(oosCutoff).toISOString(), samples: o.samples, hitRate: o.hitRate, netBps: o.meanBps },
    bySide: sideSplit(bySideNet),
  };
}

// LONG vs SHORT, graded separately — "does it make money on its shorts, or do the longs carry
// it?" A read that only ever fires one side (basis_extreme on OKX's persistent discount) shows
// up here as SHORT: 0 instead of hiding inside a pooled number. Informational only.
function sideSplit(bySide) {
  const out = {};
  for (const s of ["LONG", "SHORT"]) { const a = agg(bySide[s] || []); out[s] = { samples: a.samples, hitRate: a.hitRate, meanBps: a.meanBps }; }
  return out;
}

// Every exit variant for a preset-traded read, on the SAME entry window (the longest hold).
export function scoreExitVariants(all, exit, medT, minSamples) {
  const out = {};
  if (!exit) { for (const v of EXIT_VARIANTS) out[v.key] = null; return out; }
  const variants = EXIT_VARIANTS.map((v) => ({ ...v, cfg: { ...exit, ...v.override } }));
  const windowH = Math.max(...variants.map((v) => Number(v.cfg.maxHoldHours) || 0));
  for (const v of variants) out[v.key] = { ...scoreExit(all, v.cfg, medT, minSamples, DEFAULT_FEE_BPS, windowH), presetExit: v.preset };
  return out;
}

function aggR(arr) {
  if (!arr.length) return { samples: 0, hitRate: 0, meanR: 0 };
  const wins = arr.reduce((n, x) => n + (x > 0 ? 1 : 0), 0);
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  return { samples: arr.length, hitRate: Math.round((wins / arr.length) * 100), meanR: Math.round(mean * 100) / 100 };
}

export function scoreEvents(coinSets, signalGen, { horizons = [4, 12, 24], minSamples = 20, exit = null } = {}) {
  // BTC context (regime map + price map) for the RS/veto gens — built once, passed to every gen.
  const btcCs = (coinSets || []).find((c) => String(c.coin || "").toUpperCase() === "BTC");
  // BTC context off the DEEPEST btc series (candle closes preferred) so the RS/veto reaches
  // back over the candle-depth lookback, not just the shallow oi window.
  const btcSeries = btcCs ? priceSeries(btcCs) : [];
  const ctx = btcCs ? { btcMap: btcRegimeByHour(btcSeries), btcPrice: priceByHour(btcSeries), btcCandles: candlesByHour(btcCs.candleHist) } : {};
  const all = [];
  for (const cs of coinSets || []) {
    const pmap = priceByHour(cs.oiHist);
    if (pmap.size < 2) continue;
    const cbh = candlesByHour(cs.candleHist); // for R grading (first-touch needs highs/lows)
    for (const e of signalGen(cs, pmap, ctx) || []) if (e && (e.side === "LONG" || e.side === "SHORT")) all.push({ t: e.t, side: e.side, coin: cs.coin, pmap, cbh, rs: typeof e.rs === "number" ? e.rs : null });
  }
  if (!all.length) return { sides: { LONG: { events: 0, r: aggR([]) }, SHORT: { events: 0, r: aggR([]) } }, samples: 0, horizons: horizons.map((h) => ({ h, samples: 0, hitRate: 0, meanBps: 0, stable: false, verdict: "INSUFFICIENT" })), r: { available: false, samples: 0, hitRate: 0, meanR: 0, avgRWin: 0, maxDdR: 0, stable: false, verdict: "INSUFFICIENT" }, rsQuartileDist: [], headline: "bps", verdict: "INSUFFICIENT", bestHorizon: null, ...scoreExitVariants([], exit, 0, minSamples) };
  // rs_quartile written on EVERY event row that carries an rs — from closes, NOT candle-gated
  // (Grok #4). Cross-sectional rank → quartile (Q1 = strongest). Exposed so Sept-14 can
  // condition on it; a top-quartile-only axis is a one-line follow-up once these matter.
  const withRs = all.filter((e) => typeof e.rs === "number").sort((a, b) => b.rs - a.rs);
  withRs.forEach((e, idx) => { e.rsQuartile = Math.min(4, Math.floor((idx / withRs.length) * 4) + 1); });
  const rsQuartileDist = withRs.length ? [1, 2, 3, 4].map((q) => withRs.filter((e) => e.rsQuartile === q).length) : [];
  const times = all.map((e) => e.t).sort((a, b) => a - b);
  const medT = times[Math.floor(times.length / 2)];
  const horizonsOut = horizons.map((h) => {
    const pnls = [], fst = [], snd = [];
    for (const e of all) {
      const fr = forwardReturn(e.pmap, e.t, h);
      if (fr == null) continue;
      const pnl = callPnl(fr, e.side);
      pnls.push(pnl); (e.t <= medT ? fst : snd).push(pnl);
    }
    const a = agg(pnls), f = agg(fst), s = agg(snd);
    const stable = f.samples >= 5 && s.samples >= 5 && (f.meanBps > 0) === (s.meanBps > 0);
    let verdict = "INSUFFICIENT";
    if (a.samples >= minSamples) verdict = a.meanBps > 0 && stable ? "PREDICTIVE" : a.meanBps > 0 ? "PROMISING" : "NOISE";
    const bySide = { LONG: [], SHORT: [] };
    const base = [], ex = [], exF = [], exS = [], exBySide = { LONG: [], SHORT: [] }, baseBySide = { LONG: [], SHORT: [] };
    const driftOf = new Map(); // per coin, once per horizon
    for (const e of all) {
      const fr = forwardReturn(e.pmap, e.t, h);
      if (fr == null) continue;
      const pnl = callPnl(fr, e.side);
      bySide[e.side].push(pnl);
      if (!driftOf.has(e.pmap)) driftOf.set(e.pmap, coinDrift(e.pmap, h));
      const d = driftOf.get(e.pmap);
      if (d == null) continue;
      const b = callPnl(d, e.side), x = pnl - b;
      base.push(b); ex.push(x); (e.t <= medT ? exF : exS).push(x);
      baseBySide[e.side].push(b); exBySide[e.side].push(x);
    }
    const eA = agg(ex), eF = agg(exF), eS = agg(exS), bA = agg(base);
    const drift = {
      baseBps: bA.meanBps,                    // what the same side on the same coins made on an average hour
      excessBps: eA.meanBps,                  // the signal's move MINUS that — the part the read earned
      excessHitRate: eA.hitRate,
      excessStable: eF.samples >= 5 && eS.samples >= 5 && (eF.meanBps > 0) === (eS.meanBps > 0),
      bySide: Object.fromEntries(["LONG", "SHORT"].map((s) => [s, { baseBps: agg(baseBySide[s]).meanBps, excessBps: agg(exBySide[s]).meanBps, samples: exBySide[s].length }])),
    };
    return { h, ...a, stable, verdict, bySide: sideSplit(bySide), drift };
  });
  const bestHorizon = horizonsOut.reduce((b, x) => (x.meanBps > (b ? b.meanBps : -Infinity) ? x : b), null);
  // THESIS-IN-R headline (Grok #2): grade every event first-touch in R off the logged candles.
  const rSamples = [], rFst = [], rSnd = [];
  for (const e of all) {
    const entry = e.pmap.get(hourBucket(e.t));
    const r = gradeEventR(e.cbh, hourBucket(e.t), e.side, entry);
    if (r == null) continue;
    rSamples.push({ t: e.t, r }); (e.t <= medT ? rFst : rSnd).push(r);
  }
  const rPnls = rSamples.map((x) => x.r);
  const rA = aggR(rPnls), rF = aggR(rFst), rS = aggR(rSnd);
  const rStable = rF.samples >= 5 && rS.samples >= 5 && (rF.meanR > 0) === (rS.meanR > 0);
  let rVerdict = "INSUFFICIENT";
  if (rA.samples >= minSamples) rVerdict = rA.meanR > 0 && rStable ? "PREDICTIVE" : rA.meanR > 0 ? "PROMISING" : "NOISE";
  // Grok's headline row: E[R] (meanR) · hit_rate · n · avg_R|win · max_dd_R.
  const rWins = rPnls.filter((x) => x > 0);
  const avgRWin = rWins.length ? Math.round((rWins.reduce((s, x) => s + x, 0) / rWins.length) * 100) / 100 : 0;
  let cum = 0, peak = 0, maxDd = 0; // max drawdown in R over the time-ordered cumulative curve
  for (const { r: rv } of rSamples.slice().sort((a, b) => a.t - b.t)) { cum += rv; peak = Math.max(peak, cum); maxDd = Math.max(maxDd, peak - cum); }
  const r = { available: rA.samples > 0, ...rA, avgRWin, maxDdR: Math.round(maxDd * 100) / 100, stable: rStable, verdict: rVerdict };
  // Headline = R once we have enough R-graded samples (the right object); forward-bps is the
  // fallback until candles mature, and stays as a secondary read either way.
  const useR = rA.samples >= minSamples;
  // The preset's own exit, when a preset trades this read (AXIS_EXITS). Informational: it
  // does NOT change the axis verdict (that grades the READ); it says whether the read
  // survives the exit the agent actually uses.
  const exitGrades = scoreExitVariants(all, exit, medT, minSamples);
  const rBySide = { LONG: [], SHORT: [] };
  for (const e of all) {
    const rv = gradeEventR(e.cbh, hourBucket(e.t), e.side, e.pmap.get(hourBucket(e.t)));
    if (rv != null) rBySide[e.side].push(rv);
  }
  const sides = {
    LONG: { events: all.filter((e) => e.side === "LONG").length, r: aggR(rBySide.LONG) },
    SHORT: { events: all.filter((e) => e.side === "SHORT").length, r: aggR(rBySide.SHORT) },
  };
  return { sides, samples: all.length, horizons: horizonsOut, r, rsQuartileDist, headline: useR ? "R" : "bps", verdict: useR ? rVerdict : (bestHorizon ? bestHorizon.verdict : "INSUFFICIENT"), bestHorizon, ...exitGrades };
}

// The full scorecard across every registered axis, ranked by best-horizon mean return.
// SHADOW exit contracts: a read NO preset trades, graded with a preset's exits so it can be
// compared like-for-like. It does NOT create a preset and is NOT in AXIS_EXITS (which the
// /intel/evidence replay turns into a live config — a shadow there would replay the WRONG rule).
export const SHADOW_EXITS = Object.freeze({
  basis_dev_x_cvd: Object.freeze({ shadowOf: "basis-cvd-stack", exit: Object.freeze({ ...AXIS_EXITS.basis_x_cvd, preset: "shadow:basis-cvd-stack" }) }),
});

export const AXES = [
  { name: "funding_fade", label: "Funding fade (baseline)", gen: fundingFadeEvents },
  { name: "cvd_divergence", label: "CVD divergence", gen: cvdDivergenceEvents },
  { name: "basis_extreme", label: "Basis extreme fade (perp premium/discount)", gen: basisExtremeEvents },
  { name: "liq_flush", label: "Liquidation-flush reversion", gen: liqFlushEvents },
  { name: "basis_x_smart", label: "Basis extreme × smart money agrees", gen: basisXsmartEvents },
  { name: "basis_x_liqflush", label: "Basis extreme × liq-flush timing", gen: basisXliqEvents },
  { name: "basis_x_cvd", label: "Basis extreme × CVD divergence", gen: basisXcvdEvents },
  { name: "basis_dev", label: "Basis vs its usual level (two-sided)", gen: basisDevEvents },
  { name: "basis_dev_x_cvd", label: "Basis vs usual (two-sided) × CVD divergence", gen: basisDevXcvdEvents },
  { name: "smart_fade", label: "Funding fade × smart money", gen: smartFadeEvents },
  { name: "smart_follow", label: "Follow smart money", gen: smartFollowEvents },
  { name: "rsi_reset_held", label: "RSI reset held 45+ (A: uptrend)", gen: rsiResetEvents },
  { name: "rsi_reset_trend", label: "RSI reset held + trend_up (B: +regime)", gen: rsiResetTrendEvents },
  // ⚠️ Grok's catch: the SMA-anchor / close-to-close-vol versions are PROXIES for the real
  // weekly-VWAP + true-ATR spec — labeled _proxy so the Sept-14 scorecard never mistakes a
  // proxy row for the spec (D0/D1 = the real candle versions below; _proxy = the stand-ins).
  { name: "rs_value_pullback", label: "D0_proxy: RS + value pullback (SMA anchor · close-vol PROXY)", gen: rsValuePullbackEvents },
  { name: "rs_value_pullback_rsi", label: "D1_proxy: + RSI≥45 (SMA anchor · close-vol PROXY)", gen: rsValuePullbackRsiEvents },
  { name: "rs_value_pullback_candle", label: "D0_candle: RS + value pullback (real weekly VWAP · true ATR)", gen: rsValuePullbackCandleEvents },
  { name: "rs_value_pullback_candle_rsi", label: "D1_candle: + RSI≥45 (real VWAP · true ATR)", gen: rsValuePullbackCandleRsiEvents },
  { name: "rs_value_pullback_rotation", label: "D2: + volume rotation (real VWAP/ATR · 2nd veto)", gen: rsValuePullbackRotationEvents },
  { name: "rsi_reset_deep", label: "RSI reset <45 (uptrend)", gen: rsiResetDeepEvents },
];

// Bucket the RS-ranked universe into quartiles (Q1 = strongest, "fastest horses"). Lets
// the harness condition on TOP-QUARTILE relative strength rather than a binary rs>0.
export function rsQuartiles(universe) {
  const n = (universe || []).length;
  if (!n) return [];
  return universe.map((u, idx) => ({ ...u, rsRank: idx + 1, quartile: Math.min(4, Math.floor((idx / n) * 4) + 1) }));
}

export function runScorecard(coinSets, cfg = {}) {
  const axes = AXES.map((a) => {
    const shadow = !AXIS_EXITS[a.name] && SHADOW_EXITS[a.name];
    const s = scoreEvents(coinSets, a.gen, { ...cfg, exit: AXIS_EXITS[a.name] || (shadow ? shadow.exit : null) });
    if (shadow) for (const g of [s.exit, s.exit24h]) if (g) { g.presetExit = false; g.shadowOf = shadow.shadowOf; }
    return { name: a.name, label: a.label, verdict: s.verdict, headline: s.headline, r: s.r, sides: s.sides, rsQuartileDist: s.rsQuartileDist, best: s.bestHorizon, horizons: s.horizons, exit: s.exit, exit24h: s.exit24h };
  });
  // rank: PREDICTIVE > PROMISING > NOISE > INSUFFICIENT, then by the HEADLINE metric —
  // meanR once R-graded (the right object), else forward-bps until candles mature.
  const RANK = { PREDICTIVE: 3, PROMISING: 2, NOISE: 1, INSUFFICIENT: 0 };
  const metric = (a) => (a.r && a.r.available ? a.r.meanR * 1000 : (a.best ? a.best.meanBps : -1e9));
  axes.sort((x, y) => (RANK[y.verdict] - RANK[x.verdict]) || (metric(y) - metric(x)));
  // UNIVERSE — rank the coins by relative strength vs BTC (Grok's "fastest horses").
  // Surfaced so the RS filter (the C/D isolation) can be applied + shown; the map is the product.
  const btc = (coinSets || []).find((c) => String(c.coin || "").toUpperCase() === "BTC");
  const universe = btc
    ? rsQuartiles(coinSets.filter((c) => c !== btc).map((c) => ({ coin: c.coin, rs: relStrength(c.oiHist, btc.oiHist) })).filter((x) => x.rs != null).sort((a, b) => b.rs - a.rs))
    : [];
  return { axes, coins: coinSets.length, universe };
}
