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
export async function serveScoreboard(kv, key, build) {
  const cached = await getJson(kv, key);
  if (cached) return cached;
  try {
    return await rebuildScoreboard(kv, key, build);
  } catch (e) {
    const last = await getJson(kv, lastGoodKey(key));
    if (last) return { ...last, stale: true, staleReason: `rebuild failed: ${String(e?.message || e).slice(0, 200)}` };
    throw e;
  }
}
