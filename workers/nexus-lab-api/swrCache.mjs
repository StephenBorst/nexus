// ── Serve the stored copy, refresh behind the visitor (stale-while-revalidate, 2026-11-21) ─────────────────────────
// The Wire, the bell and the market table are composed from other boards in-process. They used to rebuild inside the
// request of the first visitor after their 60 s cache lapsed; when the scoreboard behind them was cold that build ran
// ~30 s and could hit Cloudflare's CPU limit (error 1102), so the Lab's front panel failed for that visitor.
// Now a visitor never waits on a build while ANY copy exists:
//   - a copy younger than `freshMs` is served as is;
//   - an older one is served at once, and one rebuild runs after the response (ctx.waitUntil), guarded by a short
//     marker so a crowd of visitors doesn't start a crowd of rebuilds (KV has no compare-and-set: a rare double
//     rebuild only costs time, it writes the same kind of payload);
//   - only when nothing is stored (first deploy, a new key, an hour of silence) does a request build inline.
// Copies live `ttlS` (an hour): every payload carries its own `builtAt`, and the screens print that age, so an older
// copy is shown as older, never as "now". Pure apart from the injected KV; tested in swrCache.test.mjs.

export const SWR_FRESH_MS = 60_000;
export const SWR_TTL_S = 3600;
export const SWR_MARK_TTL_S = 60; // KV's minimum expiry

const markKey = (key) => `${key}:refreshing`;

/**
 * @param {{ kv: any, key: string, compose: () => Promise<any>, now?: number, freshMs?: number, ttlS?: number,
 *           keep?: (out: any) => boolean, waitUntil?: ((p: Promise<any>) => void) | null }} o
 * @returns {Promise<{ body: any, served: "fresh" | "stale" | "built" }>}
 */
export async function swrServe({ kv, key, compose, now = Date.now(), freshMs = SWR_FRESH_MS, ttlS = SWR_TTL_S, keep = () => true, waitUntil = null }) {
  let hit = null;
  try { hit = JSON.parse((await kv.get(key)) || "null"); } catch { hit = null; }
  const store = async (out) => { if (keep(out)) { try { await kv.put(key, JSON.stringify(out), { expirationTtl: ttlS }); } catch { /* best-effort */ } } return out; };
  if (hit && Number.isFinite(hit.builtAt) && now - hit.builtAt < freshMs) return { body: hit, served: "fresh" };
  if (hit && waitUntil) {
    let busy = false;
    try { busy = !!(await kv.get(markKey(key))); } catch { busy = false; }
    if (!busy) {
      try { await kv.put(markKey(key), String(now), { expirationTtl: SWR_MARK_TTL_S }); } catch { /* best-effort */ }
      waitUntil((async () => {
        try { await store(await compose()); }
        catch (e) { console.error(`[swr] ${key} refresh failed:`, String(e?.message || e)); }
        finally { try { await kv.delete(markKey(key)); } catch { /* the marker expires on its own */ } }
      })());
    }
    return { body: hit, served: "stale" };
  }
  return { body: await store(await compose()), served: "built" };
}
