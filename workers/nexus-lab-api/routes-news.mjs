// GET /intel/news[?coin=ETH] — the news wire (rules app/lib/newsWire.mjs, borst 2026-11-20). lab-api reads the feeds
// itself (no third-party relay sees the reader), at most once per NEWS_TTL_MS, and keeps a rolling 48h wire in
// LAB_STORE, so one feed going down never blanks the list: its stories stay until they age out and the feed is named
// in `unread`. Read-only; no key, no wallet.

import { NEWS_FEEDS, feedItems, mergeNews, newsForCoin } from "../../app/lib/newsWire.mjs";
import { json } from "./shared.mjs";

export const NEWS_CACHE_KEY = "intel:news:v1";
export const NEWS_TTL_MS = 5 * 60_000;
export const NEWS_FETCH_TIMEOUT_MS = 8000;
const UA = "Mozilla/5.0 (compatible; news-reader)";

async function readFeed(fetchImpl, feed) {
  try {
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(NEWS_FETCH_TIMEOUT_MS) : undefined;
    const r = await fetchImpl(feed.url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", "user-agent": UA }, signal });
    if (!r.ok) return { xml: null, err: `http ${r.status}` };
    return { xml: await r.text(), err: null };
  } catch (e) { return { xml: null, err: `fetch: ${String(e?.message ?? e).slice(0, 80)}` }; }
}

/** Read every feed once, merge into the stored wire, store it. deps: fetchImpl, now. */
export async function refreshNews(env, { fetchImpl = globalThis.fetch, now = Date.now(), prev = null } = {}) {
  const reads = await Promise.all(NEWS_FEEDS.map((f) => readFeed(fetchImpl, f)));
  const fresh = [];
  const prevSources = new Map((prev?.sources || []).map((s) => [s.id, s]));
  const sources = NEWS_FEEDS.map((f, i) => {
    const { xml, err } = reads[i];
    const items = xml ? feedItems(xml, f, now) : [];
    fresh.push(...items);
    // a reply with no stories in it is a failed read (a block page, an empty body), never "no news"
    const ok = !!xml && items.length > 0;
    const before = prevSources.get(f.id);
    return {
      id: f.id, name: f.name, kind: f.kind, ok, n: items.length,
      err: ok ? null : (err || "no stories in the reply"),
      lastOkAt: ok ? now : (before?.lastOkAt ?? null),
    };
  });
  const items = mergeNews(prev?.items || [], fresh, now);
  const out = { v: 1, at: now, items, sources };
  try { await env.LAB_STORE.put(NEWS_CACHE_KEY, JSON.stringify(out), { expirationTtl: 3 * 86400 }); } catch { /* best-effort */ }
  return out;
}

/** The stored wire, refreshed when older than NEWS_TTL_MS. */
export async function readNews(env, deps = {}) {
  const now = deps.now ?? Date.now();
  let stored = null;
  try { stored = JSON.parse((await env.LAB_STORE.get(NEWS_CACHE_KEY)) || "null"); } catch { stored = null; }
  if (stored && now - stored.at < NEWS_TTL_MS) return stored;
  return refreshNews(env, { ...deps, now, prev: stored });
}

/** What a reader gets: the wire (or one coin's part of it), plus each source's state; a failed feed is named. */
export function newsView(wire, { coin = null, limit = 60 } = {}) {
  const items = coin ? newsForCoin(wire.items, coin) : wire.items;
  const lim = Math.max(1, Math.min(90, Number(limit) || 60));
  return {
    v: 1, at: wire.at, coin: coin ? String(coin).toUpperCase() : null,
    items: items.slice(0, lim),
    // a failed feed says why ("http 403", "no stories in the reply"): a status, never a secret, so the fix is targeted
    sources: wire.sources.map(({ id, name, kind, ok, n, lastOkAt, err }) => ({ id, name, kind, ok, n, lastOkAt, err: ok ? null : err })),
    unread: wire.sources.filter((s) => !s.ok).map((s) => s.name),
  };
}

export async function handleNews(parts, request, env, deps = {}) {
  if (!(parts[0] === "intel" && parts[1] === "news" && !parts[2] && request.method === "GET")) return null;
  const url = new URL(request.url);
  const coin = (url.searchParams.get("coin") || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 24) || null;
  const wire = await readNews(env, deps);
  return json(newsView(wire, { coin, limit: url.searchParams.get("limit") }), request);
}
