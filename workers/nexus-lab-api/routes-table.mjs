// GET /intel/table — the market table (rules app/lib/marketTable.mjs, borst 2026-11-20): one row per Orderly perp with
// ≥ $30k open interest, each input in its own column. Reads Orderly's all-markets list once (the same reader as the
// mispriced board), then, in-process: the venues board, smart-money consensus, the forecasts board, the news wire and
// every registered read's paper run. Read-only, 60 s cache. A failed source leaves its column unread and named.

import { marketTable } from "../../app/lib/marketTable.mjs";
import { readNews } from "./routes-news.mjs";
import { readBoard, readPaperRuns } from "./routes-wire.mjs";
import { json } from "./shared.mjs";

export const TABLE_CACHE_KEY = "intel:table:v1";
export const TABLE_TTL_MS = 60_000;
const SOURCE_TIMEOUT_MS = 8_000;

/** deps: futures() → Orderly rows (index.js fetchAllFutures), dispatch, news, now, timeoutMs. */
export async function composeTable(env, { futures, dispatch, news = (e) => readNews(e), now = Date.now(), timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  const [rows, venues, smart, forecasts, wire, paperRuns] = await Promise.all([
    Promise.resolve().then(() => futures()).then((r) => (Array.isArray(r) && r.length ? r : null)).catch(() => null),
    readBoard(dispatch, "/intel/funding-venues", timeoutMs),
    readBoard(dispatch, "/smart/consensus", timeoutMs),
    readBoard(dispatch, "/intel/forecasts", timeoutMs),
    Promise.resolve().then(() => news(env)).catch(() => null),
    readPaperRuns(dispatch, timeoutMs).catch(() => null),
  ]);
  const t = marketTable({ futures: rows, venues, smart, forecasts, news: wire, paperRuns, now });
  return { v: 1, builtAt: now, ...t };
}

export async function handleTable(parts, request, env, deps = {}) {
  if (!(parts[0] === "intel" && parts[1] === "table" && !parts[2] && request.method === "GET")) return null;
  const now = deps.now ?? Date.now();
  try {
    const hit = JSON.parse((await env.LAB_STORE.get(TABLE_CACHE_KEY)) || "null");
    if (hit && now - hit.builtAt < TABLE_TTL_MS) return json(hit, request);
  } catch { /* best-effort */ }
  const out = await composeTable(env, { ...deps, now });
  // a build with no markets is never cached: the next request tries again
  if (out.rows.length) { try { await env.LAB_STORE.put(TABLE_CACHE_KEY, JSON.stringify(out), { expirationTtl: 300 }); } catch { /* best-effort */ } }
  return json(out, request);
}
