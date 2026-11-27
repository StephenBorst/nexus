// ── GET /signals/read/:axis — a registered read's live signals for the paid x402 feed, ONLY once it is CLEARED ────────
// Rules: app/lib/soldRead.mjs (borst 2026-11-27; pipeline-if-then.md "Only a CLEARED read may be marketed or promoted:
// … the paid feed"). Every request re-reads the gate: the stored scoreboard (or its last-good copy), the recorded paper
// judgment `pjudge:{axis}` and the promotion locks. Not cleared = 403 `not_cleared` with no signals at all (the read is
// never given away through this route either); anything unread = 503. Cleared = per main coin the brain's own live read
// (registeredReadLive.mjs, the scoreboard's generator on the series the brain records, BTC as context), with the live
// grade attached. The computed rows are kept 5 min (`signals:read:{axis}:v1`), served only behind a fresh gate.
// Read-only: writes only that cache key. bankr-x402/nexus-signals.ts falls back to the funding-fade feed on anything
// but a cleared 200.
import { soldReadGate, soldGrade, soldRows, judgmentFromRecord, SOLD_COINS } from "../../app/lib/soldRead.mjs";
import { PROMOTION_LOCKS } from "../../app/lib/promotionLocks.mjs";
import { PJUDGE_KEY } from "./paperJudge.mjs";
import { registeredReadLive, READ_SERIES } from "./registeredReadLive.mjs";

export const SOLD_CACHE_KEY = (axis) => `signals:read:${axis}:v1`;
const SOLD_CACHE_MS = 5 * 60_000;

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": status === 200 ? "public, max-age=60" : "no-store", "Access-Control-Allow-Origin": "*" },
});
const readJson = async (kv, key) => { const raw = await kv.get(key); return raw ? JSON.parse(raw) : null; };

export async function storedScoreboard(env, scorecardKey) {
  for (const key of [scorecardKey, `${scorecardKey}:lastgood`]) {
    try { const sc = await readJson(env.LAB_STORE, key); if (Array.isArray(sc?.pipeline?.reads)) return sc; } catch { /* next */ }
  }
  return null;
}

/** The brain's live read on every sold coin + BTC (context), read from the series the brain records. */
export async function liveRead(env, axis, now) {
  const sets = [];
  for (const coin of [...new Set([...SOLD_COINS, "BTC"])]) {
    const cs = { coin };
    for (const [k, keyOf] of Object.entries(READ_SERIES)) {
      try { cs[k] = (await readJson(env.NEXUS_AGENT, keyOf(coin))) || []; } catch { cs[k] = null; }
    }
    sets.push(cs);
  }
  const unread = sets.filter((cs) => Object.keys(READ_SERIES).some((k) => cs[k] === null)).map((cs) => cs.coin);
  // btc_lead_lag reads BTC's tape for every coin: no BTC = no coin is read (as the brain does)
  const blind = axis === "btc_lead_lag" && unread.includes("BTC") ? [...SOLD_COINS] : unread;
  const byCoin = registeredReadLive(axis, sets.filter((cs) => !unread.includes(cs.coin)), now);
  return soldRows(byCoin, blind);
}

export async function handleReadSignals(parts, request, env, { scorecardKey, now = Date.now, locks = PROMOTION_LOCKS, read = liveRead } = {}) {
  if (!(parts[0] === "signals" && parts[1] === "read" && parts.length === 3)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "method not allowed" }, 405);
  const axis = String(parts[2] || "").slice(0, 64);
  if (!env.LAB_STORE || !env.NEXUS_AGENT) return reply({ error: "store_unbound" }, 503);

  const scoreboard = await storedScoreboard(env, scorecardKey);
  let judgment = null;
  try { judgment = judgmentFromRecord(await readJson(env.LAB_STORE, PJUDGE_KEY(axis))); } catch { judgment = null; }
  const gate = soldReadGate({ axis, scoreboard, judgment, locks });
  if (!gate.ok) return reply({ ok: false, cleared: false, axis, error: gate.error, stage: gate.stage ?? null, line: gate.line }, gate.status);

  const t = now();
  const grade = soldGrade(axis, gate.reg, judgment, scoreboard.asOf);
  let rows = null, at = null;
  try {
    const c = await readJson(env.LAB_STORE, SOLD_CACHE_KEY(axis));
    if (c && Array.isArray(c.signals) && t - Date.parse(c.at) < SOLD_CACHE_MS) { rows = c.signals; at = c.at; }
  } catch { /* rebuild */ }
  if (!rows) {
    try { rows = await read(env, axis, t); } catch (e) { return reply({ ok: false, cleared: true, axis, error: "read_failed", detail: String(e?.message || e).slice(0, 120) }, 503); }
    at = new Date(t).toISOString();
    try { await env.LAB_STORE.put(SOLD_CACHE_KEY(axis), JSON.stringify({ at, signals: rows }), { expirationTtl: 600 }); } catch { /* serve anyway */ }
  }
  return reply({ ok: true, cleared: true, axis, grade, generated_at: at, signals: rows });
}
