// Daily bars for the forecast board's base rates (app/lib/forecastOdds.mjs, 2026-11-23). One Orderly /tv/history read
// per coin that has a price-target market, at most once every 6h per coin (LAB_STORE `intel:forecasts:bars:v1:{COIN}`),
// paced like every other Orderly fan-out (mapLimit). A coin whose read fails is simply missing: its strikes get no
// history and so no lean, never a guess. Read-only; nothing here trades or grades.
import { orderlyGet, mapLimit, ORDERLY_CONCURRENCY } from "./orderlyGet.mjs";
import { dailyBars, LOOKBACK_DAYS } from "../../app/lib/forecastOdds.mjs";

const DAY = 86_400_000;
export const FORECAST_BARS_TTL_MS = 6 * 3600 * 1000;
export const forecastBarsKey = (coin) => `intel:forecasts:bars:v1:${coin}`;

/**
 * @param {{ get: Function, put: Function } | null} kv LAB_STORE
 * @param {string[]} coins bare coins
 * @returns {Promise<Record<string, {t:number,h:number,l:number,c:number}[]>>}
 */
export async function loadForecastBars(kv, coins, { now = Date.now(), get = orderlyGet, limit = ORDERLY_CONCURRENCY, mapOpts } = {}) {
  const out = {};
  const want = [...new Set((coins || []).map((c) => String(c || "").toUpperCase()).filter((c) => /^[A-Z0-9]{2,12}$/.test(c)))];
  const missing = [];
  for (const coin of want) {
    try {
      const raw = kv ? await kv.get(forecastBarsKey(coin)) : null;
      const hit = raw ? JSON.parse(raw) : null;
      if (hit && Array.isArray(hit.bars) && now - (hit.at || 0) < FORECAST_BARS_TTL_MS) { out[coin] = hit.bars; continue; }
    } catch { /* cache miss */ }
    missing.push(coin);
  }
  const fromS = Math.floor((now - (LOOKBACK_DAYS + 30) * DAY) / 1000), toS = Math.floor(now / 1000);
  await mapLimit(missing, limit, async (coin) => {
    try {
      const tv = await get(`https://api-evm.orderly.org/tv/history?symbol=PERP_${coin}_USDC&resolution=D&from=${fromS}&to=${toS}`);
      const bars = dailyBars(tv, now);
      if (!bars.length) return;
      out[coin] = bars;
      try { await kv?.put(forecastBarsKey(coin), JSON.stringify({ at: now, bars }), { expirationTtl: 86400 }); } catch { /* best-effort */ }
    } catch { /* this coin's strikes get no history: no lean */ }
  }, mapOpts);
  return out;
}
