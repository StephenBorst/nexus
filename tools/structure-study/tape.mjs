// ── The 4H tape a structure read is built from: Orderly perp 1H candles, built into 4H bars ─────
// Levels come from the market's OWN perp tape on the venue the calls are graded on. Orderly's public
// /tv/history serves no 4H bars: resolution 240 answers "no_data" for every range (stage-1 run 1,
// 2026-09-30, got 0 candles on all 23 markets). So the tape is the market's 1H candles (resolution 60,
// the candles the call grader reads) built into 4-hour bars on the UTC windows starting 00, 04, 08,
// 12, 16 and 20 (Amendment 1 in the registration).
//
// Fetched sequentially in 20-day pages (Orderly allows 10 public req/s per IP), each read through
// orderlyGet (429 + challenge pages retried with backoff). A page that fails fails the MARKET, and so
// does a tape that comes back empty: its calls are left out and named (candles_unavailable), never
// classified on a partial or missing tape. Missing bars stay missing (counted in `gaps`), never filled.
import { orderlyGet } from "../../workers/nexus-lab-api/orderlyGet.mjs";
import { normalizeBars, H4_MS } from "../../app/lib/structure.mjs";
// 4H bars + page planning come from the shared module the app and lab-api use, so the study, the
// regime snapshot and the macro chart build 4H the same way. Re-exported for tape.test.mjs and run.mjs.
// (parseTvHistory stays local: unlike hourlyBarsFromTv it keeps non-finite rows for normalizeBars.)
import { fourHourBars, planPages } from "../../app/lib/fourHourBars.mjs";
export { fourHourBars, planPages };

export const ORDERLY = "https://api-evm.orderly.org";
export const HOUR_MS = 3600 * 1000;

/** Bare ticker ("ETH") or canonical id → "PERP_ETH_USDC"; anything else → null. */
export function orderlySymbol(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (/^PERP_[A-Z0-9]+_USDC$/.test(s)) return s;
  if (/^[A-Z0-9]{1,15}$/.test(s)) return `PERP_${s}_USDC`;
  return null;
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

/** Holes in a tape: consecutive bars more than one bar apart. (RWA market hours show here too.) */
export function countGaps(bars, barMs = H4_MS) {
  let gaps = 0;
  for (let i = 1; i < bars.length; i++) if (bars[i].t - bars[i - 1].t > barMs) gaps++;
  return gaps;
}

/**
 * One market's 4H bars over [fromMs, toMs], built from its 1H candles.
 * @returns {Promise<{symbol, orderly, bars, bars1h, pages, gaps, error?}>}
 */
export async function fetchTape(symbol, fromMs, toMs, {
  get = orderlyGet, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 300, pageDays = 20, resolution = "60",
} = {}) {
  const orderly = orderlySymbol(symbol);
  const none = { symbol, orderly, bars: [], bars1h: 0, pages: 0, gaps: 0 };
  if (!orderly) return { ...none, error: "not an Orderly market id" };
  if (String(resolution) !== "60") return { ...none, error: `resolution ${resolution} is not supported: the tape is built from 1H candles` };
  const pages = planPages(Math.floor(fromMs / 1000), Math.ceil(toMs / 1000), pageDays * 86400);
  const all = [];
  for (let i = 0; i < pages.length; i++) {
    if (i) await sleep(gapMs);
    const p = pages[i];
    const url = `${ORDERLY}/tv/history?symbol=${orderly}&resolution=60&from=${p.from}&to=${p.to}`;
    try {
      all.push(...parseTvHistory(await get(url, { tries: 4 })));
    } catch (e) {
      return { ...none, pages: i, error: String((e && e.message) || e).slice(0, 120) };
    }
  }
  const hourly = normalizeBars(all);
  // The calls were posted while this market traded, so an empty tape is a failed read, never "no history".
  if (!hourly.length) return { ...none, pages: pages.length, error: "no candles: every page came back empty" };
  const bars = fourHourBars(hourly);
  return { symbol, orderly, bars, bars1h: hourly.length, pages: pages.length, gaps: countGaps(bars) };
}
