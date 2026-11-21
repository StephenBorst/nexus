// ── The scoreboard is built on a schedule, not while a visitor waits (2026-11-13) ─────────────────────────
// GET /intel/axis-backtest used to rebuild the whole scorecard (every registered read × every coin, random
// baselines, holdout line, stress study) inside the first request after its 1h cache expired. That rebuild sits
// near the Worker CPU limit and grows with every read registered: the pipeline watcher's first read on 2026-11-13
// hit Cloudflare 1102 (CPU exceeded). Everything hangs off this payload (/proof, the watcher, /calls/pulse, the
// landing's record, the x402 feed's grade label), so a failed rebuild in a request blanked all of them at once.
//
// Now: the minute cron rebuilds it once an hour in its own invocation (SCOREBOARD_REBUILD_MINUTE) and stores it
// with a TTL longer than the gap between builds, plus a last-good copy. A request serves the stored copy; only
// when there is none does it build (first deploy, a new cache key), and if that build fails it serves the last
// good copy marked `stale`, never an error page when an older board exists. The payload itself is unchanged.
//
// Pure apart from the injected KV and builder; tested in scoreboardCache.test.mjs.

export const SCOREBOARD_REBUILD_MINUTE = 53;     // away from :17 (hourly jobs), :41 (tape) and :47 (judge)
export const SCOREBOARD_TTL_S = 2 * 3600;        // outlives one missed hourly build
export const SCOREBOARD_LASTGOOD_TTL_S = 24 * 3600;

export const lastGoodKey = (key) => `${key}:lastgood`;
export const SCOREBOARD_REFRESH_AFTER_MS = 70 * 60_000; // one hourly build + 10 min slack
const rebuildMark = (key) => `${key}:rebuilding`;

/** One rebuild after the response, guarded by a short marker (KV has no compare-and-set: a rare double build only costs CPU). */
async function rebuildBehind(kv, key, build, waitUntil, now) {
  try { if (await kv.get(rebuildMark(key))) return; } catch { /* unreadable marker: try the build */ }
  try { await kv.put(rebuildMark(key), String(now), { expirationTtl: 120 }); } catch { /* best-effort */ }
  waitUntil((async () => {
    const t0 = Date.now();
    try { await rebuildScoreboard(kv, key, build); console.log(`[scoreboard] rebuilt behind a request in ${Date.now() - t0} ms`); }
    catch (e) { console.error("[scoreboard] background rebuild failed:", String(e?.message || e).slice(0, 300)); }
    finally { try { await kv.delete(rebuildMark(key)); } catch { /* expires on its own */ } }
  })());
}

async function getJson(kv, key) {
  try { const raw = await kv.get(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Build and store: the served copy and the last-good copy. Throws if the build throws (nothing is written). */
export async function rebuildScoreboard(kv, key, build) {
  const out = await build();
  const body = JSON.stringify(out);
  await kv.put(key, body, { expirationTtl: SCOREBOARD_TTL_S });
  try { await kv.put(lastGoodKey(key), body, { expirationTtl: SCOREBOARD_LASTGOOD_TTL_S }); } catch { /* best-effort */ }
  return out;
}

/**
 * What a request gets: the stored copy; else a build now (stored as above); else, if that build fails, the
 * last good copy with `stale: true` and why. Throws only when there is nothing at all to serve.
 */
export async function serveScoreboard(kv, key, build, { waitUntil = null, now = Date.now() } = {}) {
  const cached = await getJson(kv, key);
  // Stale-while-revalidate (2026-11-21): with the request's waitUntil, a visitor never waits on a build while ANY copy
  // exists. A copy older than an hourly build plus slack (the cron missed) is served and rebuilt after the response; the
  // served copy gone (two missed builds) = the last good one, marked stale with its age, and rebuilt after the response.
  const age = (c) => now - Date.parse(c?.asOf || "");
  if (cached) {
    if (waitUntil && age(cached) > SCOREBOARD_REFRESH_AFTER_MS) await rebuildBehind(kv, key, build, waitUntil, now);
    return cached;
  }
  if (waitUntil) {
    const last = await getJson(kv, lastGoodKey(key));
    if (last) {
      await rebuildBehind(kv, key, build, waitUntil, now);
      const mins = Math.round(age(last) / 60_000);
      return { ...last, stale: true, staleReason: `refreshing: this copy was built ${Number.isFinite(mins) ? `${mins} min` : "a while"} ago` };
    }
  }
  try {
    return await rebuildScoreboard(kv, key, build);
  } catch (e) {
    const last = await getJson(kv, lastGoodKey(key));
    if (last) return { ...last, stale: true, staleReason: `rebuild failed: ${String(e?.message || e).slice(0, 200)}` };
    throw e;
  }
}
