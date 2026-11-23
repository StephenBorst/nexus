// Market alerts on change: the runner (lab-api */5 cron, beside runAgentWatch). Rules: app/lib/marketAlerts.mjs.
// READS push devices (push:marketwatch → push:wallet → push:sub, devices with the markets switch on and coins
// picked), the boards it needs ONCE per run through the worker's own handler (in-process), and its own last look
// (push:marketseen:v1). WRITES only push:marketseen:v1 and the notifications it sends (appendNotification: the bell,
// the phone, Telegram when linked). Trades, signs and moves nothing. The baseline is saved before any send: a failed
// send misses one alert rather than repeating it.
import { marketSnapshot, marketTransitions, marketAlertMessage, marketAlertUrl, normCoins, MARKET_WATCH_UNIVERSE_MAX } from "../../app/lib/marketAlerts.mjs";
import { normTopics, pushEnabled, MARKET_WATCH_WALLETS_MAX } from "./push.mjs";
import { moveLines, currentMove, unusualMove, moveDue, MOVE_LOOKBACK_DAYS } from "../../app/lib/unusualMove.mjs";
import { mapLimit, ORDERLY_CONCURRENCY } from "./orderlyGet.mjs";
import { readBars } from "./alertBars.mjs";

// Unusual moves (2026-11-23, app/lib/unusualMove.mjs): each watched coin's own 10/90 lines of its 4-hour moves over
// 90 days, from Orderly hourly bars, kept 6h per coin; the move now from the last few hourly bars, every run.
export const MOVE_LINES_TTL_MS = 6 * 3600 * 1000;
export const moveLinesKey = (coin) => `move:lines:v1:${coin}`;
async function linesFor(kv, coin, now, getBars) {
  try {
    const hit = JSON.parse((await kv.get(moveLinesKey(coin))) || "null");
    if (hit && now - (hit.at || 0) < MOVE_LINES_TTL_MS) return hit.lines;
  } catch { /* rebuild */ }
  const bars = await getBars(coin, now - (MOVE_LOOKBACK_DAYS + 1) * 86_400_000, now, 60);
  const lines = moveLines(bars, { now });
  if (lines) { try { await kv.put(moveLinesKey(coin), JSON.stringify({ at: now, lines }), { expirationTtl: 86_400 }); } catch { /* best-effort */ } }
  return lines;
}

export const MARKET_SEEN_KEY = "push:marketseen:v1";
export const MARKET_ALERTS_PER_WALLET_RUN = 5;

const readJson = async (kv, key, fallback) => {
  try { const r = await kv.get(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
};

async function readBoard(dispatch, path) {
  try { const r = await dispatch(path); return r && r.ok ? await r.json() : null; } catch { return null; }
}

/** coin → wallets watching it (devices with the markets switch on). */
export async function watchersByCoin(kv) {
  const wallets = (await readJson(kv, "push:marketwatch", [])).slice(0, MARKET_WATCH_WALLETS_MAX);
  const byCoin = new Map();
  for (const w of wallets) {
    const ids = await readJson(kv, `push:wallet:${w}`, []);
    const coins = new Set();
    for (const id of ids) {
      const rec = await readJson(kv, `push:sub:${id}`, null);
      if (rec && normTopics(rec.topics).markets) for (const c of normCoins(rec.coins)) coins.add(c);
    }
    for (const c of coins) {
      if (!byCoin.has(c) && byCoin.size >= MARKET_WATCH_UNIVERSE_MAX) continue;
      if (!byCoin.has(c)) byCoin.set(c, []);
      byCoin.get(c).push(w);
    }
  }
  return byCoin;
}

/**
 * @param {object} env
 * @param {(wallet: string, notif: object) => Promise<unknown>} notify  appendNotification
 * @param {(path: string) => Promise<Response>} dispatch  the worker's own handler, in-process
 */
export async function runMarketWatch(env, notify, dispatch, { now = Date.now(), getBars = readBars, mapOpts } = {}) {
  if (!pushEnabled(env)) return { coins: 0, events: 0, skipped: "off" };
  const kv = env.LAB_STORE;
  const byCoin = await watchersByCoin(kv);
  if (!byCoin.size) return { coins: 0, events: 0 };

  const [mispriced, smart, forecasts] = await Promise.all([
    readBoard(dispatch, "/intel/mispriced"),
    readBoard(dispatch, "/smart/consensus"),
    readBoard(dispatch, "/intel/forecasts"),
  ]);
  const seenAll = await readJson(kv, MARKET_SEEN_KEY, {});
  // Unusual moves: the coin's own lines + the move now, read once per coin per run (paced). Unread = no move alert.
  const moves = new Map();
  await mapLimit([...byCoin.keys()], ORDERLY_CONCURRENCY, async (coin) => {
    try {
      const lines = await linesFor(kv, coin, now, getBars);
      const mv = lines ? currentMove(await getBars(coin, now - 6 * 3600_000, now, 60)) : null;
      moves.set(coin, unusualMove(lines, mv));
    } catch { /* unread: no move alert this run */ }
  }, mapOpts);
  const nextSeen = {};
  const events = [];
  for (const coin of byCoin.keys()) {
    const prev = seenAll[coin] ?? null;
    const { seen, events: evs } = marketTransitions(coin, prev, marketSnapshot(coin, { mispriced, smart, forecasts }));
    // The move's last alert per coin ({side, at}); the first look only records it (never replays an old move).
    const u = moves.get(coin);
    seen.um = prev?.um ?? null;
    if (u?.side) {
      if (prev && moveDue(prev.um, u.side, now)) evs.push({ kind: "UNUSUAL_MOVE", coin, move: u });
      if (!prev || moveDue(prev.um, u.side, now)) seen.um = { side: u.side, at: now };
    }
    nextSeen[coin] = seen;
    for (const ev of evs) events.push(ev);
  }
  await kv.put(MARKET_SEEN_KEY, JSON.stringify(nextSeen));

  const perWallet = new Map();
  let sent = 0;
  for (const ev of events) {
    for (const w of byCoin.get(ev.coin) ?? []) {
      const n = perWallet.get(w) ?? 0;
      if (n >= MARKET_ALERTS_PER_WALLET_RUN) continue;
      perWallet.set(w, n + 1);
      try {
        await notify(w, {
          id: `market_${ev.coin}_${ev.kind}_${now}`,
          type: "market_alert",
          message: marketAlertMessage(ev),
          url: marketAlertUrl(ev.coin),
          createdAt: now,
          read: false,
        });
        sent++;
      } catch (e) { console.error(`[market-watch] notify ${String(w).slice(0, 10)} failed`, e?.message || e); }
    }
  }
  return { coins: byCoin.size, events: events.length, sent };
}
