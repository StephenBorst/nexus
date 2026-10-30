// ── Market stress hours — REGISTERED conditioner (docs/research/stress-hours-prereg.md) ──────────────
// Signed by borst 2026-10-30; out-of-sample from 2026-10-31T00:00:00Z; limit 2027-04-30. A stress hour
// is a market-wide state, not a trade: many coins delevering at once while the whole board moves hard.
// The study asks whether the registered reads grade differently in the 24h after one. It never fires a
// trade and never changes a read. The rule below is frozen: a changed rule = a new name + a new dated
// registration. Brain and exec never import this file (stressHours.test.mjs fails if one does).
//
// Inputs are what we record hourly on the nine main-card coins (RECORDED_COINS): oi:hist (price, OI).
// Everything at hour h is decided from data at or before h: the oi:hist rows in hour h and h−4. A stress
// hour is stamped when its newest input row was written (a few minutes past h), never at the top of the
// hour before the data existed. Moved unchanged from the draft (stressDraft.mjs, PR #201); the counted
// side variants (DELEVER alone, BTC shock) are not part of the registration and were dropped.
import { hourBucket } from "../../app/lib/basisStack.mjs";

const H = 3600000;
const MONTH_H = 30 * 24;

export const STRESS_RULE = Object.freeze({
  // DELEVER: at least `breadth` of the coins show OI down `oiDrop` or more over `windowH`.
  windowH: 4, oiDrop: 0.02, breadth: 5,
  // MOVE: the median |windowH return| across the coins ranks at or above `movePct` of its own prior 30 days.
  movePct: 0.9, lookbackH: MONTH_H, minHistory: MONTH_H / 2,
  // At least this many coins must be readable at h, or the hour is not judged (never "calm" by default).
  minCoins: 6,
  // A read's event is STRESS if it lands in [S, S + afterH) of a stress hour S.
  afterH: 24,
  // A read's event is CALM only if it isn't STRESS and at least this many of the afterH hours up to it were judged.
  minJudgedH: 20,
  // Stress hours closer than this belong to one episode (reported, not used in the label).
  episodeGapH: 24,
});

// The study, as signed. The judging code (built in its own PR, before any read reaches the bar) reads these.
export const STRESS_STUDY = Object.freeze({
  name: "stress_hours",
  registeredAt: "2026-10-31T00:00:00Z",
  limit: "2027-04-30T00:00:00Z",
  // the reads registered as of the signing; a read registered later is not in this study
  reads: Object.freeze(["rsi_reset_deep", "level_reclaim", "oi_div_reversal", "session_momentum", "confluence_follow", "oi_div_reversal_4h", "oi_coil_break"]),
  minEach: 30,        // judged once a read has this many STRESS and this many CALM out-of-sample events
  minAtLimit: 20,     // fewer STRESS events than this at the limit = NOT_ENOUGH_STRESS
  shifts: 1000, minShiftDays: 7, seed: 20261031, // time-shift null
  alpha: 0.05,        // Holm across the reads judged
});

// last row per hour wins (the reads' same-hour semantics, explorerReads.mjs byHour)
function byHour(rows, ok) {
  const m = new Map();
  for (const r of [...(rows || [])].sort((a, b) => Number(a.t) - Number(b.t))) if (r && ok(r)) m.set(hourBucket(r.t), r);
  return m;
}
const oiMap = (rows) => byHour(rows, (p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.oi) && p.oi > 0);

// Percentile rank, ties counted half (as the explorer reads do).
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

/**
 * The market panel, hour by hour: for each hour with enough readable coins, how many delevered, the
 * median |move|, and whether that median is extreme against its own past. No outcome is read.
 * @param {{coin:string, oiHist:object[]}[]} sets the main-card coins
 * `t` = when the newest row used was written (the hour is known from then on).
 * @returns {{ hour:number, t:number, coins:number, delevered:number, moveMed:number, moveRank:number|null }[]}
 */
export function stressPanel(sets, p = STRESS_RULE) {
  const maps = sets.map((s) => oiMap(s.oiHist));
  const hours = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
  const rows = [];
  const pastMoves = []; // median moves of earlier judged hours, oldest first: [hour, value]
  for (const h of hours) {
    let coins = 0, delevered = 0, seenAt = 0;
    const moves = [];
    for (const m of maps) {
      const now = m.get(h), then = m.get(h - p.windowH);
      if (!now || !then) continue;
      coins++;
      seenAt = Math.max(seenAt, Number(now.t));
      if (now.oi / then.oi - 1 <= -p.oiDrop) delevered++;
      moves.push(Math.abs(now.price / then.price - 1));
    }
    if (coins < p.minCoins) continue;
    const moveMed = median(moves);
    const prior = pastMoves.filter(([ph]) => ph < h && ph >= h - p.lookbackH).map(([, v]) => v);
    const moveRank = prior.length >= p.minHistory ? pctRank(prior, moveMed) : null;
    rows.push({ hour: h, t: seenAt, coins, delevered, moveMed, moveRank });
    pastMoves.push([h, moveMed]);
  }
  return rows;
}

/** Stress hours (ms timestamps, ascending): DELEVER and MOVE in the same hour. */
export function stressHours(sets, p = STRESS_RULE) {
  return stressPanel(sets, p)
    .filter((r) => r.delevered >= p.breadth && r.moveRank != null && r.moveRank >= p.movePct)
    .map((r) => r.t);
}

/** Group stress hours into episodes (a gap longer than episodeGapH starts a new one). */
export function stressEpisodes(hoursMs, p = STRESS_RULE) {
  const eps = [];
  for (const t of [...hoursMs].sort((a, b) => a - b)) {
    const last = eps[eps.length - 1];
    if (last && t - last.end <= p.episodeGapH * H) { last.end = t; last.hours++; } else eps.push({ start: t, end: t, hours: 1 });
  }
  return eps;
}

/** Is a read's event at `t` inside the window after some stress hour? (`hoursMs` ascending) */
export function inStress(t, hoursMs, p = STRESS_RULE) {
  let lo = 0, hi = hoursMs.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (hoursMs[mid] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  return best >= 0 && t - hoursMs[best] < p.afterH * H;
}

/** The judged hours (hour buckets with a move rank), for stressLabel. */
export function judgedHourSet(sets, p = STRESS_RULE) {
  return new Set(stressPanel(sets, p).filter((r) => r.moveRank != null).map((r) => r.hour));
}

/**
 * One read event's label: STRESS (within afterH after a stress hour), CALM (not STRESS, and at least
 * minJudgedH of the afterH hours up to it were judged, so a stress hour couldn't have hidden in a gap),
 * else UNJUDGED (left out of the study).
 */
export function stressLabel(t, hoursMs, judged, p = STRESS_RULE) {
  if (inStress(t, hoursMs, p)) return "STRESS";
  const h = hourBucket(t);
  let seen = 0;
  for (let k = 0; k < p.afterH; k++) if (judged.has(h - k)) seen++;
  return seen >= p.minJudgedH ? "CALM" : "UNJUDGED";
}
