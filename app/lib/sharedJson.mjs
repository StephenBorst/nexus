// One request per URL per short window, shared by every component that asks (2026-11-14 speed pass). On Lab home
// /signals, /theses/consensus and /agents/live were each fetched by two components at once (four times in dev);
// /theses/consensus takes ~2 s. Same JSON either way: callers share the in-flight promise and, for ttlMs, its result.
// A failed or non-2xx read resolves null and is NOT cached, so the next caller tries again. Pure enough to test.

const cache = new Map(); // url -> { at, p }
export const SHARED_TTL_MS = 30_000;

/**
 * @param {string} url
 * @param {{ ttlMs?: number, now?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<any|null>}
 */
export function sharedJson(url, { ttlMs = SHARED_TTL_MS, now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  const hit = cache.get(url);
  if (hit && now - hit.at < ttlMs) return hit.p;
  const p = Promise.resolve()
    .then(() => fetchImpl(url))
    .then((r) => (r && r.ok ? r.json() : null))
    .catch(() => null)
    .then((j) => { if (j == null && cache.get(url)?.p === p) cache.delete(url); return j; });
  cache.set(url, { at: now, p });
  return p;
}

/** Tests only. */
export function _clearSharedJson() { cache.clear(); }
