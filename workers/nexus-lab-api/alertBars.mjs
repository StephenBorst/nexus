// Orderly's public bars for price alerts (priceWatch.mjs) and their share card (routes-alertshare.mjs). One
// /tv/history read; every caller paces its fan-out (mapLimit). Read-only. A refused or empty read = [] (the caller
// then fires nothing / draws "couldn't read"), never a guess.
import { orderlyGet } from "./orderlyGet.mjs";

const ORDERLY = "https://api-evm.orderly.org";

/** Bars [{t (ms, bar open), o, h, l, c}] oldest first. resolution: 1 | 15 | 60 … (minutes). */
export async function readBars(coin, fromMs, toMs, resolution = 1, { get = orderlyGet } = {}) {
  const c = String(coin || "").toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(c)) return [];
  const url = `${ORDERLY}/tv/history?symbol=PERP_${c}_USDC&resolution=${resolution}&from=${Math.floor(fromMs / 1000)}&to=${Math.ceil(toMs / 1000)}`;
  try {
    const d = await get(url);
    if (!d || d.s !== "ok" || !Array.isArray(d.t)) return [];
    const out = [];
    for (let i = 0; i < d.t.length; i++) {
      const t = Number(d.t[i]) * 1000, o = Number(d.o?.[i]), h = Number(d.h?.[i]), l = Number(d.l?.[i]), cl = Number(d.c?.[i]);
      if (Number.isFinite(t) && h > 0 && l > 0 && cl > 0) out.push({ t, o, h, l, c: cl });
    }
    return out.sort((a, b) => a.t - b.t);
  } catch { return []; }
}

/** The coin's mark now (Orderly public futures row), or null. */
export async function readMark(coin, { get = orderlyGet } = {}) {
  const c = String(coin || "").toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(c)) return null;
  try {
    const d = await get(`${ORDERLY}/v1/public/futures/PERP_${c}_USDC`);
    const m = Number(d?.data?.mark_price);
    return m > 0 ? m : null;
  } catch { return null; }
}
