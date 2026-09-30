// ── The 4H tape a structure read is built from: Orderly perp, public /tv/history ────────────────
// Levels come from the market's OWN perp tape on the venue the calls are graded on. Fetched
// sequentially in fixed pages (Orderly allows 10 public req/s per IP), each read through
// orderlyGet (429 + challenge pages retried with backoff). A page that fails fails the MARKET:
// its calls are left out and named, never classified on a partial tape. Missing bars inside a
// fetched range stay missing (counted in `gaps`), never filled.
import { orderlyGet } from "../../workers/nexus-lab-api/orderlyGet.mjs";
import { normalizeBars, H4_MS } from "../../app/lib/structure.mjs";

export const ORDERLY = "https://api-evm.orderly.org";

/** Bare ticker ("ETH") or canonical id → "PERP_ETH_USDC"; anything else → null. */
export function orderlySymbol(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (/^PERP_[A-Z0-9]+_USDC$/.test(s)) return s;
  if (/^[A-Z0-9]{1,15}$/.test(s)) return `PERP_${s}_USDC`;
  return null;
}

/** Contiguous [from, to] pages (seconds) covering fromSec → toSec, oldest first. */
export function planPages(fromSec, toSec, pageSec) {
  const pages = [];
  for (let from = fromSec; from < toSec; from += pageSec) pages.push({ from, to: Math.min(from + pageSec, toSec) });
  return pages;
}

/** Bars from one /tv/history body (t in seconds → ms). "no_data" = a valid empty page. */
export function parseTvHistory(d) {
  if (d && d.s === "no_data") return [];
  const cols = ["t", "o", "h", "l", "c"];
  if (!d || d.s !== "ok" || !cols.every((k) => Array.isArray(d[k]))) throw new Error(`unusable candle page (${d && d.s})`);
  const out = [];
  for (let i = 0; i < d.t.length; i++) out.push({ t: Number(d.t[i]) * 1000, o: d.o[i], h: d.h[i], l: d.l[i], c: d.c[i] });
  return out;
}

/** Holes in a crypto tape: consecutive bars more than one bar apart. (RWA market hours show here too.) */
export function countGaps(bars, barMs = H4_MS) {
  let gaps = 0;
  for (let i = 1; i < bars.length; i++) if (bars[i].t - bars[i - 1].t > barMs) gaps++;
  return gaps;
}

/**
 * One market's 4H bars over [fromMs, toMs].
 * @returns {Promise<{symbol, orderly, bars, pages, gaps, error?}>}
 */
export async function fetchTape(symbol, fromMs, toMs, {
  get = orderlyGet, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 300, pageDays = 40,
} = {}) {
  const orderly = orderlySymbol(symbol);
  if (!orderly) return { symbol, orderly: null, bars: [], pages: 0, gaps: 0, error: "not an Orderly market id" };
  const pages = planPages(Math.floor(fromMs / 1000), Math.ceil(toMs / 1000), pageDays * 86400);
  const all = [];
  for (let i = 0; i < pages.length; i++) {
    if (i) await sleep(gapMs);
    const p = pages[i];
    const url = `${ORDERLY}/tv/history?symbol=${orderly}&resolution=240&from=${p.from}&to=${p.to}`;
    try {
      all.push(...parseTvHistory(await get(url, { tries: 4 })));
    } catch (e) {
      return { symbol, orderly, bars: [], pages: i, gaps: 0, error: String((e && e.message) || e).slice(0, 120) };
    }
  }
  const bars = normalizeBars(all);
  return { symbol, orderly, bars, pages: pages.length, gaps: countGaps(bars) };
}
