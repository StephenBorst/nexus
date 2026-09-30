// ── Market structure from one market's own 4H tape ──────────────────────────────────────────────
// A RESEARCH read. Nothing live imports this: no card, no agent, no grade. Its only user is the
// pre-registered replay in tools/structure-study (docs/research/structure-house-fade-prereg.md),
// and the rules below are the ones that document registered. Change a rule = a new dated
// registration, never an edit here.
//
// Honest by construction:
//   • no lookahead: every function reads only bars that had CLOSED by `asOfMs` (a 4H bar once
//     open + 4h ≤ asOf, a week once its Monday 00:00 UTC + 7d ≤ asOf);
//   • nothing is filled in: a missing bar stays missing, and too little history returns a reason
//     (h4_insufficient / weekly_insufficient / flat_tape), never a guessed level;
//   • levels come from the market's own Orderly perp tape. No EMA200 (Orderly's history is too
//     short for a weekly one), no order blocks, no fair-value gaps in v1.
//
// Bars are { t, o, h, l, c } with t = the bar's OPEN time in ms, ascending (see normalizeBars).

export const H4_MS = 4 * 3600 * 1000;
export const DAY_MS = 86400 * 1000;
export const WEEK_MS = 7 * DAY_MS;

export const STRUCTURE_DEFAULTS = Object.freeze({
  fractalK: 2,           // a swing = a bar whose high (low) is strictly above (below) the 2 bars each side
  atrLen: 14,            // ATR = mean true range of the last 14 closed 4H bars
  zoneLookbackBars: 180, // 4H swings from the last 30 days count as levels
  zoneAtrMult: 1.0,      // "into a level" = entry within 1 ATR of it
  minH4Bars: 60,         // 10 days of closed 4H bars, or the call is not classified
  weeklyWindow: 26,      // weekly bias reads the last 26 completed weeks
  weeklyMinWeeks: 8,     // fewer completed weeks than this = no weekly read
});

// Per-field coalesce: `{ ...DEFAULTS, ...opts }` lets an explicit `undefined` erase a default
// (the bug that once kept a basis signal from ever firing).
function withDefaults(params) {
  const p = params || {};
  const out = {};
  for (const k of Object.keys(STRUCTURE_DEFAULTS)) out[k] = p[k] ?? STRUCTURE_DEFAULTS[k];
  return out;
}

/** Sort by open time, drop non-finite rows, keep the LAST copy of a duplicated bar. */
export function normalizeBars(bars) {
  const byT = new Map();
  for (const b of bars || []) {
    const bar = { t: Number(b.t), o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c) };
    if (Object.values(bar).every(Number.isFinite)) byT.set(bar.t, bar);
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/** Monday 00:00 UTC of the week holding `ms` (1970-01-01 was a Thursday, 3 days after a Monday). */
export function weekStart(ms) {
  const day = Math.floor(ms / DAY_MS);
  return (day - ((((day + 3) % 7) + 7) % 7)) * DAY_MS;
}

/** The bars that had closed by `asOfMs` (open + barMs ≤ asOf). `bars` ascending. */
export function completedBars(bars, asOfMs, barMs = H4_MS) {
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t + barMs <= asOfMs) lo = mid + 1; else hi = mid;
  }
  return bars.slice(0, lo);
}

/**
 * Completed weekly bars (Monday 00:00 UTC → next Monday) built from closed 4H bars. A week with no
 * bars is not a bar (RWA weekends, pre-listing); a listing week is built from the bars it has.
 */
export function weeklyBars(bars4h, asOfMs) {
  const out = [];
  let cur = null;
  for (const b of bars4h) {
    if (b.t + H4_MS > asOfMs) break;
    const w = weekStart(b.t);
    if (!cur || cur.t !== w) {
      if (cur) out.push(cur);
      cur = { t: w, o: b.o, h: b.h, l: b.l, c: b.c, n: 1 };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.n += 1;
    }
  }
  if (cur) out.push(cur);
  return out.filter((w) => w.t + WEEK_MS <= asOfMs);
}

/** Strict fractal: bars[i].h above every bar within k on each side. Needs k bars on both sides. */
export function isSwingHigh(bars, i, k) {
  if (i - k < 0 || i + k > bars.length - 1) return false;
  for (let j = i - k; j <= i + k; j++) if (j !== i && !(bars[j].h < bars[i].h)) return false;
  return true;
}
export function isSwingLow(bars, i, k) {
  if (i - k < 0 || i + k > bars.length - 1) return false;
  for (let j = i - k; j <= i + k; j++) if (j !== i && !(bars[j].l > bars[i].l)) return false;
  return true;
}

/**
 * Weekly bias = the direction of the last break of structure in the last `weeklyWindow` completed
 * weeks. Walking forward, a swing becomes the reference level the week it is confirmed (k weeks
 * after it); a weekly CLOSE above the reference high = BULL, below the reference low = BEAR (a
 * reference is used up once broken). No break in the window = NEUTRAL; a week that breaks both =
 * NEUTRAL. Fewer than `weeklyMinWeeks` completed weeks = null (no read).
 */
export function weeklyBias(weeks, params) {
  const P = withDefaults(params);
  const k = P.fractalK;
  const w = weeks.slice(-P.weeklyWindow);
  if (w.length < P.weeklyMinWeeks) return null;
  let bias = "NEUTRAL", refHigh = null, refLow = null, lastBreakAt = null;
  for (let j = 0; j < w.length; j++) {
    const i = j - k; // the swing that week j's close confirms
    if (i >= k) {
      if (isSwingHigh(w, i, k)) refHigh = w[i].h;
      if (isSwingLow(w, i, k)) refLow = w[i].l;
    }
    const up = refHigh != null && w[j].c > refHigh;
    const dn = refLow != null && w[j].c < refLow;
    if (up) refHigh = null;
    if (dn) refLow = null;
    if (up || dn) { bias = up && dn ? "NEUTRAL" : up ? "BULL" : "BEAR"; lastBreakAt = w[j].t; }
  }
  return { bias, weeks: w.length, lastBreakAt };
}

/** Mean true range of the last `len` bars (each against the previous close). Needs len + 1 bars. */
export function atr(bars, len) {
  if (bars.length < len + 1) return null;
  let sum = 0;
  for (let j = bars.length - len; j < bars.length; j++) {
    const b = bars[j], pc = bars[j - 1].c;
    sum += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  }
  return sum / len;
}

/**
 * The nearest UNBROKEN confirmed 4H swing levels around `entry`, from the last `zoneLookbackBars`:
 * supply = the lowest swing high above entry that no later close has cleared; demand = the highest
 * swing low below entry that no later close has cleared. `bars` = closed bars only.
 */
export function nearestLevels(bars, entry, params) {
  const P = withDefaults(params);
  const k = P.fractalK;
  const last = bars.length - 1;
  let supply = null, demand = null;
  for (let i = Math.max(k, last - P.zoneLookbackBars + 1); i <= last - k; i++) {
    if (isSwingHigh(bars, i, k)) {
      const p = bars[i].h;
      if (p > entry && (!supply || p < supply.price)) {
        let broken = false;
        for (let j = i + 1; j <= last && !broken; j++) broken = bars[j].c > p;
        if (!broken) supply = { price: p, t: bars[i].t };
      }
    }
    if (isSwingLow(bars, i, k)) {
      const p = bars[i].l;
      if (p < entry && (!demand || p > demand.price)) {
        let broken = false;
        for (let j = i + 1; j <= last && !broken; j++) broken = bars[j].c < p;
        if (!broken) demand = { price: p, t: bars[i].t };
      }
    }
  }
  return { supply, demand };
}

/**
 * Does a call fight structure at the moment it was posted?
 *   againstWeekly = a LONG under a BEAR weekly bias, or a SHORT under a BULL one;
 *   intoZone      = a LONG within zoneAtrMult × ATR under unbroken 4H supply, or a SHORT within it
 *                   above unbroken 4H demand;
 *   counterCycle  = againstWeekly OR intoZone.
 * @param {{direction:"LONG"|"SHORT", entry:number, asOfMs:number}} call
 * @param bars4h  the market's 4H bars (normalizeBars), any range; only bars closed by asOfMs are read
 */
export function classifyAgainstStructure(call, bars4h, params) {
  const P = withDefaults(params);
  const dir = call && call.direction;
  const entry = Number(call && call.entry);
  const asOf = Number(call && call.asOfMs);
  if ((dir !== "LONG" && dir !== "SHORT") || !(entry > 0) || !Number.isFinite(asOf)) {
    return { classified: false, reason: "bad_call" };
  }
  const h4 = completedBars(bars4h, asOf, H4_MS);
  if (h4.length < P.minH4Bars) return { classified: false, reason: "h4_insufficient", h4Bars: h4.length };
  const weekly = weeklyBias(weeklyBars(h4, asOf), P);
  if (!weekly) return { classified: false, reason: "weekly_insufficient", h4Bars: h4.length };
  const a = atr(h4, P.atrLen);
  if (!(a > 0)) return { classified: false, reason: "flat_tape", h4Bars: h4.length };
  const { supply, demand } = nearestLevels(h4, entry, P);
  const level = dir === "LONG" ? supply : demand;
  const zoneDistAtr = level ? Math.abs(level.price - entry) / a : null;
  const intoZone = zoneDistAtr != null && zoneDistAtr <= P.zoneAtrMult;
  const againstWeekly = (dir === "LONG" && weekly.bias === "BEAR") || (dir === "SHORT" && weekly.bias === "BULL");
  return {
    classified: true,
    weeklyBias: weekly.bias,
    weeks: weekly.weeks,
    againstWeekly,
    atr: a,
    supply,
    demand,
    zoneDistAtr,
    intoZone,
    counterCycle: againstWeekly || intoZone,
    h4Bars: h4.length,
  };
}
