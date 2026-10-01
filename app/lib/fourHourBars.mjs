// ── 4H bars built from Orderly's 1H candles ─────────────────────────────────────────────────────
// Orderly's public /tv/history serves no 4H bars: resolution 240 answers {"s":"no_data"} for every
// range (TradeChart.tsx notes it; the structure study's run 1 read 0 candles on all 23 markets,
// 2026-09-30). So anything that wants 4H reads resolution 60 and builds the bars itself, on the UTC
// windows starting 00, 04, 08, 12, 16 and 20. Shared by the lab-api regime snapshot (4H EMA8/EMA21)
// and the Lab's macro-proxy chart, so the two can't build 4H differently.
//
// Fetching is injected (`getJson`): the worker passes orderlyGet (429/challenge retries), the
// browser passes a plain fetch. Pages are read one after another, 20 days each (the page size
// gradeCandles.mjs uses at resolution 60). A page that fails fails the whole read: a tape with a
// hole in the middle would give a wrong EMA or a chart that skips days without saying so.

export const HOUR_MS = 3600 * 1000;
export const H4_MS = 4 * HOUR_MS;
export const ORDERLY_TV = "https://api-evm.orderly.org/tv/history";
export const PAGE_DAYS = 20;

/**
 * Hourly bars from one /tv/history body: t in seconds → ms. "no_data" = a valid empty page; any
 * other non-"ok" body throws. Non-finite rows are dropped.
 */
export function hourlyBarsFromTv(d) {
  if (d && d.s === "no_data") return [];
  const cols = ["t", "o", "h", "l", "c"];
  if (!d || d.s !== "ok" || !cols.every((k) => Array.isArray(d[k]))) throw new Error(`unusable candle page (${d && d.s})`);
  const out = [];
  for (let i = 0; i < d.t.length; i++) {
    const bar = { t: Number(d.t[i]) * 1000, o: Number(d.o[i]), h: Number(d.h[i]), l: Number(d.l[i]), c: Number(d.c[i]) };
    if (Object.values(bar).every(Number.isFinite)) out.push(bar);
  }
  return out;
}

/** Sort by open time; a bar served twice (two pages share their edge hour) is kept once, the later copy. */
export function dedupeBars(bars) {
  const byT = new Map();
  for (const b of bars || []) byT.set(b.t, b);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/**
 * 4-hour bars from 1-hour bars. Windows start at 00, 04, 08, 12, 16 and 20 UTC; each bar is the first
 * open, highest high, lowest low and last close of the hourly bars that OPEN inside its window, and `n`
 * says how many there were. A window with no hourly bar is no bar. `bars1h` ascending (dedupeBars).
 */
export function fourHourBars(bars1h) {
  const out = [];
  let cur = null;
  for (const b of bars1h) {
    const w = Math.floor(b.t / H4_MS) * H4_MS;
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
  return out;
}

/** Contiguous [from, to] pages (seconds) covering fromSec → toSec, oldest first. */
export function planPages(fromSec, toSec, pageSec = PAGE_DAYS * 86400) {
  const pages = [];
  for (let from = fromSec; from < toSec; from += pageSec) pages.push({ from, to: Math.min(from + pageSec, toSec) });
  return pages;
}

/**
 * One market's 4H bars over [fromSec, toSec], built from its 1H candles.
 * @param {string} symbol  Orderly id, e.g. "PERP_BTC_USDC"
 * @param {{ getJson: (url: string) => Promise<any>, pageDays?: number }} opts
 * @returns {Promise<{ bars: {t,o,h,l,c,n}[], hourly: number, pages: number }>}  throws if any page fails
 */
export async function fetchFourHourBars(symbol, fromSec, toSec, { getJson, pageDays = PAGE_DAYS } = {}) {
  if (typeof getJson !== "function") throw new Error("fetchFourHourBars needs getJson");
  const pages = planPages(Math.floor(fromSec), Math.ceil(toSec), pageDays * 86400);
  const all = [];
  for (const p of pages) {
    const url = `${ORDERLY_TV}?symbol=${encodeURIComponent(symbol)}&resolution=60&from=${p.from}&to=${p.to}`;
    all.push(...hourlyBarsFromTv(await getJson(url)));
  }
  const hourly = dedupeBars(all);
  return { bars: fourHourBars(hourly), hourly: hourly.length, pages: pages.length };
}
