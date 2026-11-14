// GET /intel/market/:coin — every lens on one coin, composed server-side in ONE request (the market drawer,
// 2026-11-14). It reads the existing boards through the worker's own handler, in-process (no network hop), so each
// keeps its own cache and logic: /intel/mispriced, /signals, /smart/consensus, /theses/consensus,
// /intel/forecasts/:coin, /intel/catalysts-board, /calls/pulse. Rules: app/lib/marketRead.mjs (tested).
// Read-only. A board that fails or is slow drops its lens ("unread"), never the drawer. Cached 60 s per coin.

import { composeMarket, marketCoin } from "../../app/lib/marketRead.mjs";
import { json } from "./shared.mjs";
import { fadeFamilyGrade } from "../../app/lib/fadeGrade.mjs";
import { marketSnapshot, normCoins } from "../../app/lib/marketAlerts.mjs";

export const MARKET_CACHE_PREFIX = "intel:market:v1:";
export const MARKET_TTL_MS = 60_000;
const SOURCE_TIMEOUT_MS = 8_000;

export const MARKET_SOURCES = (coin) => ({
  mispriced: "/intel/mispriced",
  signals: "/signals",
  smart: "/smart/consensus",
  callers: "/theses/consensus",
  forecasts: `/intel/forecasts/${coin}`,
  catalysts: "/intel/catalysts-board",
  pulse: "/calls/pulse",
  scorecard: "/intel/axis-backtest", // each lens's nearest graded relative (stored copy, built on the minute cron)
});

/** One board through the worker's own handler, JSON or null (timeout, non-2xx, bad JSON). */
async function readBoard(dispatch, path, timeoutMs) {
  let timer;
  try {
    const res = await Promise.race([
      dispatch(path),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string[]} parts  URL path parts
 * @param {Request} request
 * @param {object} env
 * @param {{ dispatch: (path: string) => Promise<Response>, now?: number, timeoutMs?: number }} deps
 * @returns {Promise<Response|null>} null when the route isn't ours
 */
export async function handleMarket(parts, request, env, { dispatch, now = Date.now(), timeoutMs = SOURCE_TIMEOUT_MS }) {
  if (!(parts[0] === "intel" && parts[1] === "market" && request.method === "GET")) return null;
  const coin = marketCoin(parts[2]);
  if (!coin) return json({ error: "coin required — GET /intel/market/BTC" }, request, 400);

  const key = MARKET_CACHE_PREFIX + coin;
  try {
    const hit = await env.LAB_STORE.get(key);
    if (hit) {
      const c = JSON.parse(hit);
      if (c && now - c.builtAt < MARKET_TTL_MS) return json(c, request);
    }
  } catch { /* cache is best-effort */ }

  const sources = MARKET_SOURCES(coin);
  const names = Object.keys(sources);
  const boards = await Promise.all(names.map((n) => readBoard(dispatch, sources[n], timeoutMs)));
  const input = Object.fromEntries(names.map((n, i) => [n, boards[i]]));
  const out = { ...composeMarket({ coin, ...input }), builtAt: now, unread: names.filter((n, i) => !boards[i]) };
  try { await env.LAB_STORE.put(key, JSON.stringify(out), { expirationTtl: 120 }); } catch { /* best-effort */ }
  return json(out, request);
}

// ── GET /intel/fade-grade — the plain funding fade's grade only (the Board's and Briefing's FADE line). The Lab used
// to download the whole scoreboard (~200 KB) on first paint for this one line; same rule (app/lib/fadeGrade.mjs),
// read from the stored scoreboard through the worker's own handler. { grade: null } when the board is unread.
export async function handleFadeGrade(parts, request, { dispatch }) {
  if (!(parts[0] === "intel" && parts[1] === "fade-grade" && request.method === "GET")) return null;
  let grade = null;
  try {
    const r = await dispatch("/intel/axis-backtest");
    if (r && r.ok) grade = fadeFamilyGrade(await r.json());
  } catch { grade = null; }
  const res = json({ grade }, request);
  if (grade) res.headers.set("Cache-Control", "public, max-age=300");
  return res;
}

// ── GET /intel/markets?coins=ETH,BTC — the watchlist panel (app/lib/watchlist.mjs) in ONE request: each coin's
// price, 24h move and the alert snapshot (marketAlerts.mjs marketSnapshot), from three boards read once through
// the worker's own handler. ≤ 10 coins, 60 s cache per coin set. A failing board leaves its fields null (unread).
export const MARKETS_SOURCES = Object.freeze({ mispriced: "/intel/mispriced", smart: "/smart/consensus", forecasts: "/intel/forecasts" });
export async function handleMarkets(parts, request, env, { dispatch, now = Date.now(), timeoutMs = SOURCE_TIMEOUT_MS }) {
  if (!(parts[0] === "intel" && parts[1] === "markets" && !parts[2] && request.method === "GET")) return null;
  const coins = normCoins(String(new URL(request.url).searchParams.get("coins") || "").split(","));
  if (!coins.length) return json({ error: "coins required — GET /intel/markets?coins=BTC,ETH" }, request, 400);
  const key = `intel:markets:v1:${[...coins].sort().join(",")}`;
  try {
    const hit = await env.LAB_STORE.get(key);
    if (hit) { const c = JSON.parse(hit); if (c && now - c.builtAt < MARKET_TTL_MS) return json(c, request); }
  } catch { /* best-effort */ }
  const names = Object.keys(MARKETS_SOURCES);
  const boards = await Promise.all(names.map((n) => readBoard(dispatch, MARKETS_SOURCES[n], timeoutMs)));
  const b = Object.fromEntries(names.map((n, i) => [n, boards[i]]));
  const rows = coins.map((coin) => {
    const mp = (b.mispriced?.markets ?? []).find((m) => marketCoin(m?.coin ?? m?.symbol) === coin) ?? null;
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return { coin, price: num(mp?.markPrice), change24hPct: num(mp?.change24hPct), snap: marketSnapshot(coin, b) };
  });
  const out = { coins: rows, builtAt: now, unread: names.filter((n, i) => !boards[i]) };
  try { await env.LAB_STORE.put(key, JSON.stringify(out), { expirationTtl: 120 }); } catch { /* best-effort */ }
  return json(out, request);
}
