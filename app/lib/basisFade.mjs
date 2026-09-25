// ── Spot-perp BASIS extreme fade — ONE rule, graded AND traded ───────────────
// The signal scoreboard graded `basis_extreme` PREDICTIVE (n=203, stable) while the
// agent's own funding-fade flagship graded NOISE. Turning that graded read into a
// tradeable signal is only honest if the LIVE signal is literally the same rule the
// scoreboard grades — otherwise the board endorses something the agent isn't doing.
// So the rule lives here once: axisbt's basisExtremeEvents (grading) and the brain
// (trading) both call it, and they cannot drift.
//
// The read: a perp at an extreme PREMIUM to spot is froth → fade it SHORT; an extreme
// DISCOUNT → fade it LONG. "Extreme" is measured against the market's OWN recent
// behaviour (trailing p90 of |basisPct| over ~a week), never a fixed number — so a
// structurally high-basis market doesn't fire constantly and a flat regime never fires.
//
// ⚠️ PREDICTIVE on the scoreboard is NOT the same as robust in a live strategy. The
// scoreboard measures forward returns of the READ; it says nothing about entries,
// exits, fees or sizing. Anything built on this stays PAPER until it earns a record.

export const BASIS_FADE_DEFAULTS = Object.freeze({ window: 168, minWarmup: 48, pct: 0.9 });

// Nearest-rank quantile. Lives here (not in axisbt) so grading and trading share it.
export function trailingPct(values, p) {
  const arr = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const idx = Math.min(arr.length - 1, Math.max(0, Math.ceil(p * arr.length) - 1));
  return arr[idx];
}

// The core decision. `trailAbs` = |basisPct| observed STRICTLY BEFORE this observation.
// Returns "SHORT" (premium) / "LONG" (discount) / null. Null whenever the sample is too
// thin or the reading isn't strictly past the trailing threshold — refusing to fire is
// the correct answer far more often than firing.
export function basisExtremeSide(trailAbs, basisPct, { minWarmup, pct } = {}) {
  // ⚠️ NOT { ...DEFAULTS, minWarmup, pct } — an omitted arg spreads `undefined` OVER the
  // default and silently disables the rule (thr becomes undefined ⇒ it never fires).
  const cfg = { minWarmup: minWarmup ?? BASIS_FADE_DEFAULTS.minWarmup, pct: pct ?? BASIS_FADE_DEFAULTS.pct };
  if (!Number.isFinite(basisPct)) return null;
  const trail = (trailAbs || []).filter((v) => Number.isFinite(v));
  if (trail.length < cfg.minWarmup) return null;
  const thr = trailingPct(trail, cfg.pct);
  const mag = Math.abs(basisPct);
  if (!(thr > 0) || !(mag > thr)) return null;   // strictly ABOVE — a flat regime has no extreme
  return basisPct > 0 ? "SHORT" : "LONG";
}

// LIVE read off the recorded basis:hist series ([{t, basisPct}], any order).
// The NEWEST row is the observation; the `window` rows strictly before it are the trail —
// the same construction the scoreboard grades, just evaluated at the last recorded hour.
// Returns the decision plus the numbers behind it so the caller can pass them to
// deriveSignal (which stays pure) and so a rejection can explain itself.
export function basisFadeFromHistory(rows, { now = Date.now(), window, minWarmup, pct, maxAgeMs = 3 * 3600000 } = {}) {
  const cfg = {
    window: window ?? BASIS_FADE_DEFAULTS.window,
    minWarmup: minWarmup ?? BASIS_FADE_DEFAULTS.minWarmup,
    pct: pct ?? BASIS_FADE_DEFAULTS.pct,
  };
  const sorted = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && Number.isFinite(r.basisPct) && Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);
  if (!sorted.length) return { side: null, basisPct: null, thr: null, ageMs: null, reason: "no basis history" };

  const obs = sorted[sorted.length - 1];
  const ageMs = now - obs.t;
  // basis:hist accrues HOURLY. A gap means the flow cron stalled — trading a stale
  // premium is worse than not trading, so this refuses rather than guesses.
  if (ageMs > maxAgeMs) {
    return { side: null, basisPct: obs.basisPct, thr: null, ageMs, t: obs.t, reason: `basis stale (${Math.round(ageMs / 3600000)}h)` };
  }
  const trailRows = sorted.slice(Math.max(0, sorted.length - 1 - cfg.window), sorted.length - 1);
  const trailAbs = trailRows.map((r) => Math.abs(r.basisPct));
  const thr = trailAbs.length >= cfg.minWarmup ? trailingPct(trailAbs, cfg.pct) : null;
  const side = basisExtremeSide(trailAbs, obs.basisPct, cfg);
  const reason = side
    ? `basis ${obs.basisPct > 0 ? "premium" : "discount"} ${obs.basisPct.toFixed(3)}% > p${Math.round(cfg.pct * 100)} ${thr?.toFixed(3)}%`
    : (trailAbs.length < cfg.minWarmup ? `accruing (${trailAbs.length}/${cfg.minWarmup}h)` : "basis not extreme");
  // `t` = the observation's hour — the join key for stack conditioners (basisStack.mjs).
  return { side, basisPct: obs.basisPct, thr, ageMs, t: obs.t, reason };
}

// ── TWO-SIDED variant: extreme vs the market's OWN USUAL basis, not vs zero ─────
// Found 2026-09-25: the OKX USDT perp sits at a persistent ~−0.05% discount to spot, so
// basisExtremeSide (|basis| vs its trailing p90, sign taken from ZERO) only ever fires the
// deepest discount → LONG. The premium → SHORT half never fires; the read is one-sided.
// This measures the deviation from the TRAILING MEAN instead: a discount WIDER than usual →
// LONG, NARROWER than usual (a relative premium) → SHORT. Same window / warmup / p90 as the
// original, same strictly-prior trail. It is a DIFFERENT rule, so it is graded as its own
// scoreboard axis beside basis_extreme — never swapped into the live preset silently.
const DEV_EPS = 1e-9; // % units — far below any real basis move (~1e-3)
export function basisDeviationSide(trailRaw, basisPct, { minWarmup, pct } = {}) {
  const cfg = { minWarmup: minWarmup ?? BASIS_FADE_DEFAULTS.minWarmup, pct: pct ?? BASIS_FADE_DEFAULTS.pct };
  if (!Number.isFinite(basisPct)) return null;
  const trail = (trailRaw || []).filter((v) => Number.isFinite(v));
  if (trail.length < cfg.minWarmup) return null;
  const mean = trail.reduce((s, v) => s + v, 0) / trail.length;
  const thr = trailingPct(trail.map((v) => Math.abs(v - mean)), cfg.pct);
  const dev = basisPct - mean;
  // thr must clear a float floor: the mean of a flat series is off by ~1e-17, which would
  // otherwise "detect" an extreme in pure rounding noise (the test caught it).
  if (!(thr > DEV_EPS) || !(Math.abs(dev) > thr)) return null; // strictly ABOVE — a flat regime has no extreme
  return dev > 0 ? "SHORT" : "LONG";
}
