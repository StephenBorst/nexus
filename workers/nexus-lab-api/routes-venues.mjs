// GET /intel/funding-venues — the same coin's funding on Orderly, Hyperliquid and OKX, annualized the same way
// (rules app/lib/crossFunding.mjs, 2026-11-15). Orderly from the Mispriced Board (read in-process); Hyperliquid in ONE
// request (metaAndAssetCtxs, hourly funding for every asset); OKX one request per coin, paced, only for the recorded
// universe. Cached 5 min. A venue that fails is named unread and its column stays null, never 0. Read-only.

import { hlFunding, okxFunding, venueRows } from "../../app/lib/crossFunding.mjs";
import { RECORDED_COINS, HOLDOUT_COINS } from "../../app/lib/recordedUniverse.mjs";
import { json } from "./shared.mjs";

export const VENUES_CACHE_KEY = "intel:venues:v1";
export const VENUES_TTL_MS = 5 * 60_000;
export const OKX_COINS = Object.freeze([...RECORDED_COINS, ...HOLDOUT_COINS]);
const OKX_GAP_MS = 120; // OKX allows ~20 req / 2 s on this route; 17 coins, one at a time

const marketCoin = (s) => String(s ?? "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");

async function readJson(fetchImpl, url, init) {
  try { const r = await fetchImpl(url, init); return r.ok ? await r.json() : null; } catch { return null; }
}

/** Every venue, composed. deps: dispatch (worker's own handler), fetchImpl, sleep. */
export async function composeVenues({ dispatch, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now() } = {}) {
  const unread = [];
  let mp = null;
  try { const r = await dispatch("/intel/mispriced"); mp = r && r.ok ? await r.json() : null; } catch { mp = null; }
  const orderly = {};
  for (const m of mp?.markets ?? []) {
    const c = marketCoin(m?.coin ?? m?.symbol);
    const f = Number(m?.fundingAnnualPct);
    if (c && Number.isFinite(f)) orderly[c] = f;
  }
  if (!Object.keys(orderly).length) unread.push("orderly");

  const hlReply = await readJson(fetchImpl, "https://api.hyperliquid.xyz/info", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }),
  });
  const hyperliquid = hlFunding(hlReply);
  if (!Object.keys(hyperliquid).length) unread.push("hyperliquid");

  const okx = {};
  for (const c of OKX_COINS) {
    if (!(c in orderly)) continue;
    const a = okxFunding(await readJson(fetchImpl, `https://www.okx.com/api/v5/public/funding-rate?instId=${c}-USDT-SWAP`));
    if (a != null) okx[c] = a;
    await sleep(OKX_GAP_MS);
  }
  if (!Object.keys(okx).length) unread.push("okx");

  return { v: 1, builtAt: now, rows: venueRows({ orderly, hyperliquid, okx }), unread };
}

export async function handleVenues(parts, request, env, deps = {}) {
  if (!(parts[0] === "intel" && parts[1] === "funding-venues" && request.method === "GET")) return null;
  const now = deps.now ?? Date.now();
  try {
    const hit = await env.LAB_STORE.get(VENUES_CACHE_KEY);
    if (hit) { const c = JSON.parse(hit); if (c && now - c.builtAt < VENUES_TTL_MS) return coinView(c, parts[2], request); }
  } catch { /* best-effort */ }
  const out = await composeVenues({ ...deps, now });
  if (!out.unread.includes("orderly")) {
    try { await env.LAB_STORE.put(VENUES_CACHE_KEY, JSON.stringify(out), { expirationTtl: 900 }); } catch { /* best-effort */ }
  }
  return coinView(out, parts[2], request);
}

// /intel/funding-venues/ETH → just that coin's row (the drawer).
function coinView(board, coin, request) {
  if (!coin) return json(board, request);
  const c = marketCoin(coin);
  return json({ v: board.v, builtAt: board.builtAt, row: board.rows.find((r) => r.coin === c) ?? null, unread: board.unread }, request);
}
