// ── rsi_reset_deep's rule, shared by the scoreboard and the brain (moved from axisbt.mjs unchanged, 2026-11-19) ─────
// The scoreboard grades rsi_reset_deep with rsiResetDeepEvents (axisbt AXES, re-exported there); the brain's
// REGISTERED_READ paper mode runs the same function (workers/nexus-lab-api/registeredReadLive.mjs). Bodies frozen: a
// changed rule is a new name and a new registration. Kept-reference test: rsiReset.test.mjs.
//
// Note for live use: the generator's loop ends one row short of the last (`i < rows.length - 1`), so an event at row i
// is only emitted once row i + 1 exists, although its decision reads rows ≤ i only (RSI and EMA are forward
// recursions). `rsiResetDeepAtStamp` gives the brain each event at its own row, exactly the events the generator
// emits once the next row lands (pinned by test), never one more.
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

// The events rsiResetDeepEvents will emit, as soon as each one's own row is recorded: run with one probe row after the
// last (a copy one hour on), keep events stamped at or before the last real row. The probe only lifts the loop's end
// bound; no event reads it (rsiReset.test.mjs checks it against the generator on every cut of a tape).
const H = 3600000;
export function rsiResetDeepAtStamp(cs, pmap, ctx) {
  const rows = (cs?.oiHist || []).filter((p) => p && Number.isFinite(p.price) && p.price > 0);
  if (!rows.length) return [];
  const last = rows.reduce((a, b) => ((b.t || 0) >= (a.t || 0) ? b : a));
  const probe = { ...last, t: Number(last.t) + H };
  return rsiResetDeepEvents({ ...cs, oiHist: [...rows, probe] }, pmap, ctx).filter((e) => e.t <= Number(last.t));
}
