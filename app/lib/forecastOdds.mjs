// ── The crowd's odds vs the coin's own history (borst 2026-11-23, "level up the forecast divergence tab") ──────────
// The old read FOLDED a probability into a direction: YES < 50% on "will BTC reach $70k" became "the crowd leans DOWN".
// That is wrong. 12% that BTC climbs 14% in a week is not bearish: BTC itself only did that in a minority of weeks. A
// low probability on a far strike is just distance. So the forecast lens now asks the honest question:
//
//   how often did this coin actually make this move, in this much time, over its own last year?
//
// and compares the crowd's YES to that rate, in points. Only a material gap (GAP_PTS) is a lean: the crowd rates the
// move more (or less) likely than the coin's own history does. Within GAP_PTS = no lean, never a fallback to the fold.
//
// Measured, not modelled: daily bars, every start day in the lookback, overlapping windows (a base rate, not
// independent samples; the UI says so). "Reach / hit / dip to" markets resolve on a TOUCH (any high/low in the
// window); "above / below on <date>" markets resolve on the CLOSE at the end, so the two are counted differently.
// Pure + tested (forecastOdds.test.mjs). lab-api's forecast board (logic.mjs forecastDivergence) and the Lab tab
// both read it: one rule, every surface (the table's forecast column, the drawer, the Board, the share card).

const DAY = 86_400_000;
/** A gap under this many points is "about the same as history": no lean. */
export const GAP_PTS = 10;
/** Fewer start days than this = too little history to compare. */
export const MIN_WINDOWS = 60;
/** How far back the base rate reads. */
export const LOOKBACK_DAYS = 365;

/** "touch" (reach / hit / dip to) or "close" (above / below at the end). */
export function oddsKind(question) {
  const q = String(question || "");
  if (/\b(reach|reaches|reached|hit|hits|touch|touches|dip|dips|tag|tags)\b/i.test(q)) return "touch";
  if (/\b(drop|drops|fall|falls)\s+to\b/i.test(q)) return "touch";
  return "close";
}

/** Whole days from now to the market's end (≥ 1), or null when the end is missing or past. */
export function daysLeft(endDate, now = Date.now()) {
  const end = Date.parse(String(endDate || ""));
  if (!Number.isFinite(end) || end <= now) return null;
  return Math.max(1, Math.round((end - now) / DAY));
}

/** Daily bars from one /tv/history reply ({s, t[s], h, l, c}), completed days only, oldest first. */
export function dailyBars(tv, now = Date.now()) {
  if (!tv || tv.s !== "ok" || !Array.isArray(tv.t)) return [];
  const out = [];
  for (let i = 0; i < tv.t.length; i++) {
    const t = Number(tv.t[i]) * 1000, h = Number(tv.h?.[i]), l = Number(tv.l?.[i]), c = Number(tv.c?.[i]);
    if (!Number.isFinite(t) || !(h > 0) || !(l > 0) || !(c > 0)) continue;
    if (t + DAY > now) continue; // today's bar is still moving
    out.push({ t, h, l, c });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * How often the coin made this move in `days`, from each start day's close.
 * @param {{t:number,h:number,l:number,c:number}[]} bars completed daily bars, oldest first
 * @param {{ distancePct: number, days: number, kind: "touch"|"close", lookbackDays?: number, minWindows?: number }} p
 * @returns {{ pct: number, hits: number, windows: number, days: number, kind: string, lookbackDays: number } | null}
 */
export function historyOdds(bars, { distancePct, days, kind, lookbackDays = LOOKBACK_DAYS, minWindows = MIN_WINDOWS }) {
  const d = Number(distancePct) / 100, w = Math.round(Number(days));
  if (!Array.isArray(bars) || !Number.isFinite(d) || d === 0 || !(w >= 1)) return null;
  const rows = bars.slice(-lookbackDays);
  const up = d > 0;
  let hits = 0, windows = 0;
  for (let i = 0; i + w < rows.length; i++) {
    const level = rows[i].c * (1 + d);
    let hit = false;
    if (kind === "touch") {
      for (let j = i + 1; j <= i + w && !hit; j++) hit = up ? rows[j].h >= level : rows[j].l <= level;
    } else {
      const end = rows[i + w].c;
      hit = up ? end >= level : end <= level;
    }
    windows++;
    if (hit) hits++;
  }
  if (windows < minWindows) return null;
  return { pct: Math.round((hits / windows) * 1000) / 10, hits, windows, days: w, kind: kind === "touch" ? "touch" : "close", lookbackDays: rows.length };
}

/**
 * The crowd vs history. lean = the direction the crowd is MORE confident in than history, only past GAP_PTS.
 * @param {{ yesPct: number, direction: "UP"|"DOWN", historyPct: number }} p
 * @returns {{ gapPts: number, lean: "UP"|"DOWN"|null }}
 */
export function crowdVsHistory({ yesPct, direction, historyPct }) {
  const y = Number(yesPct), h = Number(historyPct);
  if (!Number.isFinite(y) || !Number.isFinite(h) || (direction !== "UP" && direction !== "DOWN")) return { gapPts: null, lean: null };
  const gapPts = Math.round((y - h) * 10) / 10;
  if (Math.abs(gapPts) < GAP_PTS) return { gapPts, lean: null };
  const moreLikely = gapPts > 0;
  const lean = direction === "UP" ? (moreLikely ? "UP" : "DOWN") : (moreLikely ? "DOWN" : "UP");
  return { gapPts, lean };
}

/** "In BTC's last 365 days, a 14.4% rise within 7 days happened from 9% of start days." Plain, no verdict. */
export function historyLine(coin, distancePct, odds) {
  if (!odds) return null;
  const dist = Math.abs(Number(distancePct));
  if (!Number.isFinite(dist)) return null;
  const move = `${dist.toFixed(1)}% ${Number(distancePct) > 0 ? "rise" : "drop"}`;
  const span = `${odds.days} day${odds.days === 1 ? "" : "s"}`;
  const how = odds.kind === "touch" ? `a ${move} within ${span}` : `a close ${dist.toFixed(1)}% ${Number(distancePct) > 0 ? "higher" : "lower"} ${span} later`;
  return `In ${coin}’s last ${odds.lookbackDays} days, ${how} happened from ${fmtPct(odds.pct)} of start days.`;
}

/** "The crowd rates it 21 points more likely than BTC's own history does." / "...close to ..." */
export function gapLine(coin, gapPts) {
  if (gapPts == null || !Number.isFinite(gapPts)) return null;
  if (Math.abs(gapPts) < GAP_PTS) return `The crowd’s odds are close to ${coin}’s own history.`;
  return `The crowd rates it ${Math.round(Math.abs(gapPts))} points ${gapPts > 0 ? "more" : "less"} likely than ${coin}’s own history does.`;
}

const fmtPct = (p) => (p < 1 && p > 0 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`);
