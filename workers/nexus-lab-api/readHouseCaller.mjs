// ── The house caller for a CLEARED registered read (rules: app/lib/readHouseCall.mjs, borst 2026-11-27) ───────────────
// Runs on lab-api's */5 cron every 15 min. OFF by construction until the read is CLEARED: each run re-reads the paid
// feed's gate (soldRead.mjs soldReadGate → isCleared, on the stored scoreboard + pjudge:{axis} + promotion locks), and a
// refusal posts nothing. Also off while HOUSE_READ_CALLER_ADDRESS isn't a wallet address. Cleared = the brain's own
// live read per main coin (routes-readsignals.mjs liveRead), each new event posted once as a call under that wallet
// through the same seal as any publish, under a NexusLock lease (one run at a time). GET /signals/read-house = status
// (never the read's signals while it isn't cleared). The last run's line is kept 7 days at `house:lastrun:read-<axis>`.
import { soldReadGate, judgmentFromRecord } from "../../app/lib/soldRead.mjs";
import { READ_HOUSE_READS, readHouseDue, readHouseCall } from "../../app/lib/readHouseCall.mjs";
import { PROMOTION_LOCKS } from "../../app/lib/promotionLocks.mjs";
import { storedScoreboard, liveRead } from "./routes-readsignals.mjs";
import { PJUDGE_KEY } from "./paperJudge.mjs";
import { prepareSeal } from "./labWrite.mjs";
import { readPublishMark } from "./publishMark.mjs";
import { readAtrFrac } from "./routes-sealed.mjs";
import { withLock, LOCK_KEYS, LockBusy } from "./lock.mjs";
import { json } from "./shared.mjs";

export const READ_HOUSE_RUN_MINUTES = Object.freeze([8, 23, 38, 58]); // clear of :41 tape, :47 judge, :49 digest, :53 scoreboard
const runKey = (axis) => `house:lastrun:read-${axis}`;

export function readHouseAddress(env) {
  const a = String(env.HOUSE_READ_CALLER_ADDRESS || "").trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(a) ? a : null;
}

async function gateFor(env, axis, { scorecardKey, locks }) {
  const scoreboard = await storedScoreboard(env, scorecardKey);
  let judgment = null;
  try { const raw = await env.LAB_STORE.get(PJUDGE_KEY(axis)); judgment = judgmentFromRecord(raw ? JSON.parse(raw) : null); } catch { judgment = null; }
  return soldReadGate({ axis, scoreboard, judgment, locks });
}

/** One run for one read. dryRun = what it would post (still behind the gate), no write. */
export async function generateReadHouseCalls(env, axis, {
  dryRun = false, scorecardKey, now = Date.now, locks = PROMOTION_LOCKS, read = liveRead,
  readMark = readPublishMark, readAtr = readAtrFrac, lock = withLock,
} = {}) {
  if (!READ_HOUSE_READS[axis]) return { skipped: "not_a_house_read" };
  const wallet = readHouseAddress(env);
  if (!wallet) return { skipped: "HOUSE_READ_CALLER_ADDRESS not set" };
  const gate = await gateFor(env, axis, { scorecardKey, locks });
  if (!gate.ok) return { skipped: gate.error, stage: gate.stage ?? null, line: gate.line };
  const run = async () => {
    const t = now();
    const rows = await read(env, axis, t);
    const raw = await env.LAB_STORE.get(`lab:${wallet}`);
    const data = raw ? JSON.parse(raw) : { theses: [], notes: {} };
    const existing = data.theses || [];
    const due = readHouseDue({ axis, rows, existing, now: t });
    if (!due.length) return { posted: [], note: "no new event this hour" };
    const calls = [];
    const unread = [];
    for (const d of due) {
      const [mark, atrFrac] = await Promise.all([readMark(d.coin), readAtr(d.coin)]);
      const call = readHouseCall({ axis, ...d, markPx: mark?.px, atrFrac, now: t });
      if (call) calls.push(call); else unread.push(d.coin);
    }
    if (dryRun) return { dryRun: true, house: wallet, candidates: calls, unread };
    if (!calls.length) return { posted: [], unread, note: "levels unread; retried next run" };
    const prep = await prepareSeal(env, wallet, existing, [...calls, ...existing], t, { readMark });
    if (prep.error) return { error: prep.error };
    await prep.commit(data);
    const refused = new Set((prep.sealed?.refused || []).map((r) => r.id));
    return { house: wallet, unread, posted: calls.filter((c) => !refused.has(c.id)).map((c) => ({ id: c.id, symbol: c.symbol, direction: c.direction, entry: c.entryPrice, tp: c.takeProfit1, sl: c.stopLoss })) };
  };
  if (dryRun) return run();
  try { return await lock(env, LOCK_KEYS.readHouse(axis), run, { ttlMs: 60_000, waitMs: 2_000 }); }
  catch (e) { return { error: e instanceof LockBusy ? "busy" : "lock_unavailable" }; }
}

/** The cron: every read, one log line + a 7-day note each. Off reads cost one KV read of the board. */
export async function runReadHouseCallers(env, { scorecardKey } = {}) {
  const out = {};
  for (const axis of Object.keys(READ_HOUSE_READS)) {
    let r;
    try { r = await generateReadHouseCalls(env, axis, { scorecardKey }); }
    catch (e) { r = { error: String(e?.message || e).slice(0, 120) }; }
    out[axis] = r;
    if (r.skipped) continue; // off (not cleared / no address): nothing to log every 15 minutes
    try { await env.LAB_STORE.put(runKey(axis), JSON.stringify({ at: new Date().toISOString(), result: r }), { expirationTtl: 7 * 86400 }); } catch { /* best-effort */ }
  }
  return out;
}

/** GET /signals/read-house — status only. The read's events are never shown here while it isn't cleared. */
export async function handleReadHouse(parts, request, env, { scorecardKey, locks = PROMOTION_LOCKS } = {}) {
  if (!(parts[0] === "signals" && parts[1] === "read-house" && parts.length === 2)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method not allowed" }, request, 405);
  const reads = {};
  for (const axis of Object.keys(READ_HOUSE_READS)) {
    const gate = await gateFor(env, axis, { scorecardKey, locks });
    let lastRun = null;
    try { const raw = await env.LAB_STORE.get(runKey(axis)); lastRun = raw ? JSON.parse(raw) : null; } catch { lastRun = null; }
    reads[axis] = { cleared: gate.ok, stage: gate.ok ? gate.reg.stage : gate.stage ?? null, line: gate.ok ? "Cleared: new events post as calls." : gate.line, lastRun };
  }
  const wallet = readHouseAddress(env);
  return json({ wallet, enabled: !!wallet && Object.values(reads).some((r) => r.cleared), reads }, request);
}
