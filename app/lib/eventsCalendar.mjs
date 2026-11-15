// Events calendar (2026-11-15, borst: "what's missing for traders? data, intel, knowledge"). What is scheduled to move
// the tape, in time order: US macro releases (CPI, jobs, FOMC, GDP: ForexFactory's public weekly calendar, USD, high
// and medium impact) and the dated world-event markets on the Catalysts board (Polymarket, with the crowd's odds and
// when the market closes). Every row is a dated fact from a named source; nothing is typed in by hand, and an unread
// source is named, never shown as an empty week. No direction, no call, no grade. Pure, tested; the worker reads the
// sources (lab-api routes-events.mjs, GET /intel/calendar).

const HOUR = 3_600_000, DAY = 24 * HOUR;
export const MACRO_IMPACTS = Object.freeze(["High", "Medium"]);
export const PAST_KEEP_MS = 6 * HOUR;      // a release in the last 6 hours stays, marked "out"
export const AHEAD_MS = 14 * DAY;          // macro: the two weeks the feed covers
export const MARKET_AHEAD_MS = 45 * DAY;   // world-event markets: dated further out (a Fed meeting, an election)
export const CALENDAR_SOURCES = Object.freeze({
  macro: { name: "ForexFactory weekly calendar", url: "https://www.forexfactory.com/calendar" },
  markets: { name: "Polymarket, via the Catalysts board", url: "https://polymarket.com" },
});

const str = (v) => (typeof v === "string" ? v.trim() : "");
const ms = (v) => { const t = Date.parse(String(v ?? "")); return Number.isFinite(t) ? t : null; };

/**
 * ForexFactory weekly JSON → macro rows. Shape: [{ title, country, date (ISO with offset), impact, forecast, previous }].
 * USD only, high/medium impact, inside the window. A malformed row is skipped; a non-array reply = null (unread).
 */
export function macroEvents(reply, { now = Date.now() } = {}) {
  if (!Array.isArray(reply)) return null;
  const out = [];
  const seen = new Set();
  for (const r of reply) {
    if (str(r?.country) !== "USD" || !MACRO_IMPACTS.includes(str(r?.impact))) continue;
    const at = ms(r?.date), title = str(r?.title);
    if (at == null || !title || at < now - PAST_KEEP_MS || at > now + AHEAD_MS) continue;
    const key = `${at}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: "MACRO", at, title, impact: str(r.impact),
      forecast: str(r?.forecast) || null, previous: str(r?.previous) || null,
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Catalysts board → dated world-event rows (when the market closes, and the crowd's odds). Null board = unread. */
export function marketEvents(board, { now = Date.now() } = {}) {
  const list = board?.catalysts;
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const c of list) {
    const at = ms(c?.endDate), title = str(c?.question);
    const p = Number(c?.yesProbPct);
    if (at == null || !title || at < now || at > now + MARKET_AHEAD_MS) continue;
    out.push({
      kind: "MARKET", at, title, category: str(c?.category) || null,
      yesPct: Number.isFinite(p) ? Math.round(p * 10) / 10 : null,
      coins: Array.isArray(c?.impacts) ? [...new Set(c.impacts.map((i) => str(i?.coin)).filter(Boolean))].slice(0, 4) : [],
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Merge, time-ordered; macro first on a tie. */
export function calendar({ macro = [], markets = [] } = {}) {
  return [...(macro ?? []), ...(markets ?? [])].sort((a, b) => a.at - b.at || (a.kind === "MACRO" ? -1 : 1));
}

/** "in 2h 10m" / "in 3d" / "out 40m ago". */
export function untilWords(at, now = Date.now()) {
  const d = at - now, a = Math.abs(d);
  const mins = Math.max(1, Math.round(a / 60_000));
  const span = mins < 60 ? `${mins}m`
    : mins < 24 * 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`
    : `${Math.round(a / DAY)}d`;
  return d >= 0 ? `in ${span}` : `out ${span} ago`;
}

/** The detail line under a row's title. */
export function eventDetail(e) {
  if (!e) return "";
  if (e.kind === "MACRO") {
    const parts = [`${e.impact} impact`];
    if (e.forecast) parts.push(`forecast ${e.forecast}`);
    if (e.previous) parts.push(`previous ${e.previous}`);
    return parts.join(" · ");
  }
  const parts = [];
  if (e.yesPct != null) parts.push(`${e.yesPct}% yes on Polymarket`);
  parts.push("market closes then");
  if (e.coins?.length) parts.push(`touches ${e.coins.join(", ")}`);
  return parts.join(" · ");
}

/** Day label in the viewer's time zone: Today / Tomorrow / Mon 17 Nov. */
export function dayLabel(at, now = Date.now(), tz) {
  const opt = tz ? { timeZone: tz } : {};
  const key = (t) => new Date(t).toLocaleDateString("en-CA", opt);
  if (key(at) === key(now)) return "Today";
  if (key(at) === key(now + DAY)) return "Tomorrow";
  return new Date(at).toLocaleDateString("en-GB", { ...opt, weekday: "short", day: "numeric", month: "short" });
}

/** The next high-impact macro release still ahead, for a one-line heads-up. */
export function nextHighImpact(rows, now = Date.now()) {
  return (rows ?? []).find((e) => e.kind === "MACRO" && e.impact === "High" && e.at >= now) ?? null;
}

export const CALENDAR_NOTE = "Times in your time zone. Macro from ForexFactory’s public calendar; world events are Polymarket markets, and the date is when the market closes. Scheduled, not predicted.";
