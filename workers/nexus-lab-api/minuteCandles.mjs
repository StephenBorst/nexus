// ── The 1-minute bar archive calls are graded on (app/lib/minuteGrade.mjs) ─────────────────────────
// One KV value per symbol per UTC day: `m1:{SYMBOL}:{YYYY-MM-DD}` = { v, sym, day, from, to, t, o, h, l, c }.
// [from, to) is the span of seconds FETCHED from Orderly's public /tv/history (resolution 1); a minute in
// it with no bar printed no trade. Kept with NO expiry: Orderly doesn't promise to serve old minutes,
// and a graded call must stay re-checkable (GET /candles/1m/:symbol/:day serves these values as stored).
//
// Contiguous by construction, like the hourly store (gradeCandles.mjs): a head page must reach the
// day's span, a tail page must start inside it, and a failed page stops that symbol for the run. A
// window is only handed to the grader when the days it spans cover it with no hole.
//
// Fetched by the minute grader (minuteGrader.mjs), the only writer. On-read graders (the call page, its
// share card, /verify) read the archive and never call Orderly.
import { orderlyJson } from "./backtest.mjs";
import { gradeSymbol } from "./gradeCandles.mjs";
import { MINUTE_S } from "../../app/lib/minuteGrade.mjs";

const ORDERLY = "https://api-evm.orderly.org";
const DAY_S = 86400;
export const M1_PAGE_S = 8 * 3600;        // 480 bars a request, the hourly store's proven page size
export const M1_OVERLAP_S = 3 * MINUTE_S; // re-read the last minutes: the newest bar was a partial minute
export const M1_PAD_S = 2 * MINUTE_S;     // a call's window starts in the minute before its post
export const M1_RUN_BUDGET = 40;          // pages one run may fetch (a cold backfill spreads over runs)

export const M1_KEY = (sym, day) => `m1:${sym}:${day}`;
export const dayOf = (sec) => new Date(Math.floor(sec / DAY_S) * DAY_S * 1000).toISOString().slice(0, 10);
const dayStartOf = (day) => Date.parse(`${day}T00:00:00Z`) / 1000;
const floorMin = (sec) => Math.floor(sec / MINUTE_S) * MINUTE_S;

/** The earliest second a minute-graded call's window needs, or null for a malformed post time. */
export function minuteNeededFrom(createdAtMs) {
  const ms = Number(createdAtMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return floorMin(Math.floor(ms / 1000)) - M1_PAD_S;
}

/** The UTC days [fromSec, toSec] touches, oldest first. */
export function daysBetween(fromSec, toSec) {
  const out = [];
  for (let d = Math.floor(fromSec / DAY_S) * DAY_S; d <= toSec; d += DAY_S) out.push(dayOf(d));
  return out;
}

export function validChunk(c) {
  return c && c.v === 1 && Number.isFinite(c.from) && Number.isFinite(c.to) && c.from <= c.to
    && Array.isArray(c.t) && [c.o, c.h, c.l, c.c].every((a) => Array.isArray(a) && a.length === c.t.length) ? c : null;
}

/**
 * The pages one day still needs for [needFrom, nowSec), in fetch order: the tail first (the minutes
 * the grader is waiting on), then head pages walking back. Pure.
 * @returns {{ kind:"tail"|"head", from:number, to:number }[]}
 */
export function planDayPages(chunk, day, needFrom, nowSec) {
  const ds = dayStartOf(day), de = ds + DAY_S;
  const lo = Math.max(ds, floorMin(needFrom)), hi = Math.min(de, nowSec);
  if (!(lo < hi)) return [];
  const pages = [];
  if (!chunk) {
    for (let a = lo; a < hi; a += M1_PAGE_S) pages.push({ kind: "tail", from: a, to: Math.min(hi, a + M1_PAGE_S) });
    return pages;
  }
  // Tail: from just before what's covered to now (or the day's end). A day already covered to its end
  // needs none.
  if (chunk.to < hi) {
    for (let a = Math.max(chunk.from, chunk.to - M1_OVERLAP_S); a < hi; a += M1_PAGE_S) pages.push({ kind: "tail", from: a, to: Math.min(hi, a + M1_PAGE_S) });
  }
  for (let b = chunk.from; b > lo; b -= M1_PAGE_S) pages.push({ kind: "head", from: Math.max(lo, b - M1_PAGE_S), to: b });
  return pages;
}

/** Bars from one /tv/history page that fall inside [from, to). "no_data" is an empty page. */
export function minuteBarsFrom(d, from, to) {
  if (d && d.s === "no_data") return [];
  if (!d || d.s !== "ok" || !Array.isArray(d.t) || !Array.isArray(d.h) || !Array.isArray(d.l) || !Array.isArray(d.c)) {
    throw new Error(`unusable minute page (${d && d.s})`);
  }
  const out = [];
  for (let i = 0; i < d.t.length; i++) {
    const bar = [Number(d.t[i]), Number(d.o?.[i] ?? d.c[i]), Number(d.h[i]), Number(d.l[i]), Number(d.c[i])];
    if (bar.every(Number.isFinite) && bar[0] >= from && bar[0] < to) out.push(bar);
  }
  return out;
}

/**
 * Merge one page into a day's chunk. Bars from the page replace bars at the same minute (the newest
 * one may have been partial). Throws on a page that would leave a hole. Pure.
 */
export function applyMinutePage(chunk, sym, day, page, bars) {
  if (chunk) {
    if (page.kind === "head" && page.to < chunk.from) throw new Error("head page leaves a gap");
    if (page.kind === "tail" && page.from > chunk.to) throw new Error("tail page leaves a gap");
  }
  const byT = new Map();
  if (chunk) chunk.t.forEach((t, i) => byT.set(t, [t, chunk.o[i], chunk.h[i], chunk.l[i], chunk.c[i]]));
  for (const b of bars) byT.set(b[0], b);
  const rows = [...byT.values()].sort((a, b) => a[0] - b[0]);
  return {
    v: 1, sym, day,
    from: chunk ? Math.min(chunk.from, page.from) : page.from,
    to: chunk ? Math.max(chunk.to, page.to) : page.to,
    t: rows.map((r) => r[0]), o: rows.map((r) => r[1]), h: rows.map((r) => r[2]), l: rows.map((r) => r[3]), c: rows.map((r) => r[4]),
  };
}

/**
 * One contiguous window [fromSec, …) from a symbol's day chunks, for gradeCall: { t, h, l, c, step: 60,
 * from, to }, or null when the chunks leave a hole (or don't reach back to fromSec). Pure.
 * @param {Map<string, object|null>|Record<string, object|null>} chunks day → chunk
 */
export function windowFrom(chunks, fromSec, nowSec) {
  const get = (d) => (chunks instanceof Map ? chunks.get(d) : chunks[d]) || null;
  const days = daysBetween(fromSec, nowSec);
  const out = { t: [], h: [], l: [], c: [], step: MINUTE_S, from: fromSec, to: fromSec };
  for (let k = 0; k < days.length; k++) {
    const c = get(days[k]);
    const ds = dayStartOf(days[k]);
    const need = Math.max(ds, fromSec);
    if (!c || c.from > need) return null;           // the day doesn't reach back to where the window is
    if (k < days.length - 1 && c.to < ds + DAY_S) return null;   // a past day not covered to its end
    for (let i = 0; i < c.t.length; i++) {
      if (c.t[i] < fromSec) continue;
      out.t.push(c.t[i]); out.h.push(c.h[i]); out.l.push(c.l[i]); out.c.push(c.c[i]);
    }
    out.to = c.to;
  }
  return out;
}

/** The [low, high] traded over bars at or after `sinceSec` in a window, or null when none printed. */
export function rangeSince(win, sinceSec) {
  if (!win) return null;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < win.t.length; i++) {
    if (win.t[i] < sinceSec) continue;
    if (win.l[i] < lo) lo = win.l[i];
    if (win.h[i] > hi) hi = win.h[i];
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? { lo, hi } : null;
}

async function readChunk(kv, sym, day) {
  try { const raw = kv ? await kv.get(M1_KEY(sym, day)) : null; return raw ? validChunk(JSON.parse(raw)) : null; }
  catch { return null; }
}

/**
 * A run's view of the archive: loads each symbol-day once, extends it within the run's page budget,
 * and writes back only what changed (flush). One instance per run.
 */
export function makeMinuteCandles(env, { budget = M1_RUN_BUDGET, fetchJson = orderlyJson, nowMs = () => Date.now() } = {}) {
  const kv = env && env.LAB_STORE;
  const chunks = new Map();   // `${sym}|${day}` → chunk | null
  const changed = new Set();
  const failed = new Set();
  const moved = new Map();    // sym → { lo, hi } over the bars this run added or changed
  let left = budget, used = 0;
  const k = (sym, day) => `${sym}|${day}`;

  async function load(sym, day) {
    if (!chunks.has(k(sym, day))) chunks.set(k(sym, day), await readChunk(kv, sym, day));
    return chunks.get(k(sym, day));
  }

  async function runPage(sym, day, page) {
    left -= 1; used += 1;
    const url = `${ORDERLY}/tv/history?symbol=${encodeURIComponent(sym)}&resolution=1&from=${page.from}&to=${page.to}`;
    const bars = minuteBarsFrom(await fetchJson(url), page.from, page.to);
    const prev = chunks.get(k(sym, day)) || null;
    // Only bars that are new, or whose high/low moved (the minute in progress), can move a grade. A
    // re-read minute that came back the same is not news, so a stamped touch doesn't re-trigger.
    const had = new Map(prev ? prev.t.map((t, i) => [t, [prev.h[i], prev.l[i]]]) : []);
    for (const b of bars) {
      const o = had.get(b[0]);
      if (o && o[0] === b[2] && o[1] === b[3]) continue;
      const r = moved.get(sym) || { lo: Infinity, hi: -Infinity };
      moved.set(sym, { lo: Math.min(r.lo, b[3]), hi: Math.max(r.hi, b[2]) });
    }
    chunks.set(k(sym, day), applyMinutePage(prev, sym, day, page, bars));
    changed.add(k(sym, day));
  }

  /**
   * Bring one symbol's archive up to now from `needFrom` (as far as the budget allows): the newest day's
   * tail first, then older days. A failed page stops the symbol for this run. Returns false when it
   * could not be brought fully up to date.
   */
  async function ensure(rawSym, needFrom) {
    const sym = gradeSymbol(rawSym);
    if (!sym || needFrom == null) return false;
    const nowSec = Math.floor(nowMs() / 1000);
    const days = daysBetween(needFrom, nowSec).reverse();   // today first: what the grader waits on
    for (const day of days) {
      if (failed.has(sym)) return false;
      for (;;) {
        const page = planDayPages(await load(sym, day), day, needFrom, nowSec)[0];
        if (!page) break;
        if (left <= 0) return false;
        try { await runPage(sym, day, page); }
        catch (e) { failed.add(sym); console.error("[m1]", sym, day, page.kind, String((e && e.message) || e)); return false; }
      }
    }
    return true;
  }

  /** The contiguous window from `fromSec` for a symbol (loads its days), or null. */
  async function window(rawSym, fromSec) {
    const sym = gradeSymbol(rawSym);
    if (!sym || fromSec == null) return null;
    const nowSec = Math.floor(nowMs() / 1000);
    const days = daysBetween(fromSec, nowSec);
    const map = new Map();
    for (const d of days) map.set(d, await load(sym, d));
    return windowFrom(map, fromSec, nowSec);
  }

  /** Write back every chunk this run extended. No expiry: this is the archive calls are graded on. */
  async function flush() {
    if (!kv) return;
    await Promise.all([...changed].map(async (key) => {
      const [sym, day] = key.split("|");
      try { await kv.put(M1_KEY(sym, day), JSON.stringify(chunks.get(key))); } catch { /* re-fetched next run */ }
    }));
    changed.clear();
  }

  return {
    ensure, window, flush,
    /** The [lo, hi] traded over the bars this run added or changed for a symbol, or null (nothing new). */
    movedRange: (rawSym) => moved.get(gradeSymbol(rawSym)) ?? null,
    pagesUsed: () => used,
  };
}

/** Read-only window from the archive (the on-read graders: call page, share card, /verify). */
export async function loadMinuteWindow(env, symbol, createdAtMs, nowMs = Date.now()) {
  const sym = gradeSymbol(symbol), from = minuteNeededFrom(createdAtMs);
  if (!sym || from == null || !env?.LAB_STORE) return null;
  const nowSec = Math.floor(nowMs / 1000);
  const map = new Map();
  for (const d of daysBetween(from, nowSec)) map.set(d, await readChunk(env.LAB_STORE, sym, d));
  return windowFrom(map, from, nowSec);
}

/** The public Orderly request for one day's minutes of a call's market (the /verify `source`). */
export const minuteSourceUrl = (sym, fromSec, toSec) =>
  `${ORDERLY}/tv/history?symbol=${encodeURIComponent(sym)}&resolution=1&from=${fromSec}&to=${toSec}`;

/**
 * GET /candles/1m/:symbol/:YYYY-MM-DD — one archived day, exactly as stored (public, read-only). The
 * bars a minute-graded call was graded on, so anyone can re-run the grade after Orderly ages them out.
 */
export async function handleMinuteArchive(parts, request, env) {
  if (!(parts[0] === "candles" && parts[1] === "1m" && parts.length === 4)) return null;
  const reply = (body, status, maxAge) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": `public, max-age=${maxAge}` },
  });
  if (request.method !== "GET") return reply({ error: "method not allowed" }, 405, 0);
  const sym = gradeSymbol(parts[2]);
  const day = String(parts[3] || "");
  if (!sym || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(dayStartOf(day))) return reply({ error: "bad symbol or day" }, 400, 60);
  const chunk = await readChunk(env.LAB_STORE, sym, day);
  if (!chunk) return reply({ error: "not archived", symbol: sym, day }, 404, 30);
  // A finished day never changes again; today's tail moves every minute.
  const closed = chunk.to >= dayStartOf(day) + DAY_S;
  return reply({ ...chunk, step: MINUTE_S, source: minuteSourceUrl(sym, chunk.from, chunk.to) }, 200, closed ? 86400 : 30);
}
