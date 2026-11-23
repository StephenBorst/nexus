// Price alerts: the runner (lab-api */5 cron, beside runMarketWatch). Rules: app/lib/priceAlerts.mjs.
// READS each wallet's alert list (`palert:{w}`, written only by routes-pricealerts.mjs) and Orderly's public 1-minute
// bars for the coins with an armed alert, once per coin per run (paced). WRITES only `palert:fired:{w}` (the fired
// stamps: the runner never rewrites a list a person may be editing) and its cursor, then notifies. The fired stamp is
// saved BEFORE any send: a failed send misses one alert rather than repeating it. Trades, signs and moves nothing.
import { mergeFired, isArmed, crossedIn, alertMessage, normChannels } from "../../app/lib/priceAlerts.mjs";
import { mapLimit, ORDERLY_CONCURRENCY } from "./orderlyGet.mjs";
import { readBars } from "./alertBars.mjs";

export const PRICE_INDEX_KEY = "palert:index";
export const PRICE_CURSOR_KEY = "palert:cursor:v1";
export const priceListKey = (w) => `palert:${String(w).toLowerCase()}`;
export const priceFiredKey = (w) => `palert:fired:${String(w).toLowerCase()}`;
export const PRICE_WATCH_WALLETS_MAX = 500;
export const PRICE_WATCH_COINS_MAX = 40;
const LOOKBACK_MAX_MS = 6 * 3600 * 1000; // a cron that was down for hours still sees the wicks it missed (up to 6h)

const readJson = async (kv, key, fallback) => {
  try { const r = await kv.get(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
};

/**
 * @param {object} env
 * @param {(wallet: string, notif: object, opts: object) => Promise<unknown>} notify  appendNotification
 */
export async function runPriceWatch(env, notify, { now = Date.now(), getBars = readBars, mapOpts } = {}) {
  const kv = env.LAB_STORE;
  const wallets = (await readJson(kv, PRICE_INDEX_KEY, [])).slice(0, PRICE_WATCH_WALLETS_MAX);
  if (!wallets.length) return { wallets: 0, coins: 0, fired: 0 };
  const cursor = Number(await kv.get(PRICE_CURSOR_KEY)) || 0;
  const from = Math.max(cursor ? cursor - 2 * 60_000 : now - 15 * 60_000, now - LOOKBACK_MAX_MS);

  const armedBy = new Map(); // wallet → { fired, armed[] }
  const coins = new Set();
  for (const w of wallets) {
    const list = await readJson(kv, priceListKey(w), []);
    const fired = await readJson(kv, priceFiredKey(w), {});
    const armed = mergeFired(list, fired).filter(isArmed);
    if (!armed.length) continue;
    armedBy.set(w, { fired, armed });
    for (const a of armed) if (coins.size < PRICE_WATCH_COINS_MAX || coins.has(a.coin)) coins.add(a.coin);
  }
  const coinList = [...coins];
  const barsBy = new Map();
  await mapLimit(coinList, ORDERLY_CONCURRENCY, async (c) => { barsBy.set(c, await getBars(c, from, now, 1)); }, mapOpts);

  let firedN = 0;
  for (const [w, { fired, armed }] of armedBy) {
    const hits = [];
    for (const a of armed) {
      const bars = barsBy.get(a.coin);
      if (!bars || !bars.length) continue; // unread = stays armed, checked next run
      const hit = crossedIn(a, bars);
      if (hit) hits.push({ a, hit });
    }
    if (!hits.length) continue;
    const next = { ...fired };
    for (const { a, hit } of hits) next[a.id] = { at: hit.at, px: hit.px };
    await kv.put(priceFiredKey(w), JSON.stringify(next));
    for (const { a, hit } of hits) {
      const ch = normChannels(a.channels);
      try {
        await notify(w, {
          id: `price_${a.id}`,
          type: "price_alert",
          message: alertMessage(a, hit),
          url: `/lab?tab=intel&market=${a.coin}`,
          coin: a.coin, level: a.level, dir: a.dir, firedAt: hit.at, firedPx: hit.px, alertId: a.id,
          createdAt: now,
          read: false,
        }, { push: ch.phone, telegram: ch.telegram });
        firedN++;
      } catch (e) { console.error(`[price-watch] notify ${String(w).slice(0, 10)} failed`, e?.message || e); }
    }
  }
  // A coin whose bars couldn't be read keeps the cursor where it was, so the next run re-reads the minutes it missed
  // (up to LOOKBACK_MAX_MS). Re-reading is safe: a fired alert never fires twice.
  const unread = coinList.filter((c) => !(barsBy.get(c) || []).length);
  if (!unread.length) await kv.put(PRICE_CURSOR_KEY, String(now));
  return { wallets: armedBy.size, coins: coinList.length, fired: firedN, unread };
}
