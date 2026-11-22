// ── /sealed — a sealed read's fires become public calls (docs/research/sealed-reads.md, signed 2026-11-20) ───────────
//   GET  /sealed/:name       → the read's public record: fingerprint, wallet, start, every fire (posted or missed).
//   POST /sealed/fire        { name, coin, side, fireAt, sig, dryRun? } → sig = the read's OWN wallet signing
//        sealedFireMessage. The call is built here from the public contract (app/lib/sealedFire.mjs) and sealed into
//        that wallet's Lab record through the same prepareSeal → commit as any call. A fire received more than 5 min
//        late is recorded as a MISS, never a call. dryRun returns the call without writing (works before the start).
// Moves nothing, trades nothing. Rules: app/lib/sealedFire.mjs + app/lib/sealedReads.mjs.
import { json, recoverEthAddress } from "./shared.mjs";
import { withLock, LOCK_KEYS, LockBusy } from "./lock.mjs";
import { prepareSeal } from "./labWrite.mjs";
import { readPublishMark } from "./publishMark.mjs";
import { orderlyGet } from "./orderlyGet.mjs";
import { barsFrom } from "./gradeCandles.mjs";
import { normalizeSymbol } from "./logic.mjs";
import { h4Atr14Frac } from "../../app/lib/atr.mjs";
import { GRADED_EXIT_LOOKBACK_H } from "../../app/lib/gradedExit.mjs";
import { SEALED_READS, sealedCountsFrom } from "../../app/lib/sealedReads.mjs";
import { sealedFireMessage, fireRefusal, sealedCall } from "../../app/lib/sealedFire.mjs";

const ORDERLY = "https://api-evm.orderly.org";
export const sealedLogKey = (name) => `sealed:log:${name}`;
// Signature-checked dry runs (borst 2026-11-22: "check the dry runs"): the poster's sends while MODE = "dry", kept so
// they can be read. Never a fire on the record, never a call. Last DRY_MAX.
export const sealedDryKey = (name) => `sealed:dry:${name}`;
const LOG_MAX = 2000, DRY_MAX = 50;

async function readLog(env, name) {
  try { const raw = await env.LAB_STORE.get(sealedLogKey(name)); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; }
  catch { return []; }
}
const writeLog = (env, name, log) => env.LAB_STORE.put(sealedLogKey(name), JSON.stringify(log.slice(-LOG_MAX)));
async function readDry(env, name) {
  try { const raw = await env.LAB_STORE.get(sealedDryKey(name)); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; }
  catch { return []; }
}

/** The coin's H4 ATR-14 fraction from Orderly's last GRADED_EXIT_LOOKBACK_H + 1 hourly bars, or null. */
export async function readAtrFrac(coin, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const sym = normalizeSymbol(coin);
  if (!sym) return null;
  const to = Math.floor(now() / 1000), from = to - (GRADED_EXIT_LOOKBACK_H + 6) * 3600;
  try {
    const d = await orderlyGet(`${ORDERLY}/tv/history?symbol=${encodeURIComponent(sym)}&resolution=60&from=${from}&to=${to}`, { tries: 2, fetchImpl });
    const bars = barsFrom(d).map(([t, h, l, c]) => ({ t, h, l, c }));
    return h4Atr14Frac(bars.slice(-(GRADED_EXIT_LOOKBACK_H + 1)));
  } catch { return null; }
}

export async function handleSealed(parts, request, env, {
  now = Date.now, lock = withLock, readMark = readPublishMark, readAtr = readAtrFrac, reads = SEALED_READS,
} = {}) {
  if (parts[0] !== "sealed") return null;
  if (!env.LAB_STORE) return json({ error: "store_unbound" }, request, 503);

  if (parts.length === 2 && parts[1] !== "fire") {
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method not allowed", received: request.method, allowed: ["GET"] }, request, 405);
    const read = reads.find((r) => r.name === parts[1]);
    if (!read) return json({ error: "unknown_read" }, request, 404);
    const [log, dryRuns] = await Promise.all([readLog(env, read.name), readDry(env, read.name)]);
    return json({
      name: read.name, label: read.label, fingerprint: read.fingerprint, wallet: read.wallet,
      committedAt: read.committedAt, xPost: read.xPost, countsFrom: sealedCountsFrom(read),
      posted: log.filter((e) => e.status === "POSTED").length, missed: log.filter((e) => e.status === "MISSED").length,
      fires: log, dryRuns,
    }, request);
  }
  if (!(parts.length === 2 && parts[1] === "fire")) return json({ error: "not found" }, request, 404);
  if (request.method !== "POST") return json({ error: "method not allowed", received: request.method, allowed: ["POST"] }, request, 405);

  let body; try { body = await request.json(); } catch { return json({ error: "invalid json" }, request, 400); }
  const read = reads.find((r) => r.name === body?.name);
  const coin = typeof body?.coin === "string" ? body.coin.toUpperCase() : body?.coin;
  const side = body?.side, fireAt = Number(body?.fireAt), dryRun = body?.dryRun === true;
  if (!read) return json({ error: "unknown_read" }, request, 404);
  // The read's own wallet, and nothing else, can say it fired.
  const signer = typeof body?.sig === "string" && Number.isSafeInteger(fireAt) ? recoverEthAddress(sealedFireMessage(read.name, coin, side, fireAt), body.sig) : null;
  if (!signer || signer !== read.wallet.toLowerCase()) return json({ error: "bad_signature", hint: "Sign sealedFireMessage with the read's own wallet." }, request, 401);

  const at = now();
  try {
    return await lock(env, LOCK_KEYS.sealedFire(read.name), async () => {
      const log = await readLog(env, read.name);
      const refusal = fireRefusal({ read, coin, side, fireAt, now: at, log, dryRun });
      if (refusal) {
        if (refusal.code === "late" && !dryRun) {
          await writeLog(env, read.name, [...log, { coin, side, fireAt, receivedAt: at, status: "MISSED" }]);
        }
        return json({ error: refusal.code, hint: refusal.hint }, request, refusal.status);
      }
      const [mark, atrFrac] = await Promise.all([readMark(coin), readAtr(coin)]);
      const call = sealedCall({ read, coin, side, fireAt, markPx: mark?.px, atrFrac, now: at });
      if (!call) return json({ error: "levels_unread", hint: "The mark or the ATR could not be read; retry inside the 5-minute window." }, request, 503);
      if (dryRun) {
        const row = { coin, side, fireAt, receivedAt: at, entryPrice: call.entryPrice, stopLoss: call.stopLoss, takeProfit1: call.takeProfit1 };
        try { await env.LAB_STORE.put(sealedDryKey(read.name), JSON.stringify([...(await readDry(env, read.name)), row].slice(-DRY_MAX))); }
        catch { /* the dry log is a convenience: a failed write never turns into an error */ }
        return json({ dryRun: true, call }, request);
      }

      const wallet = read.wallet.toLowerCase();
      const raw = await env.LAB_STORE.get(`lab:${wallet}`);
      const data = raw ? JSON.parse(raw) : { theses: [], notes: {} };
      const existing = data.theses || [];
      const prep = await prepareSeal(env, wallet, existing, [call, ...existing], at, { readMark });
      if (prep.error) return json({ error: prep.error }, request, 400);
      const refused = prep.sealed.refused?.find((r) => r.id === call.id);
      if (refused) return json({ error: "publish_refused", reason: refused.reason }, request, 422);
      await prep.commit(data);
      await writeLog(env, read.name, [...log, { coin, side, fireAt, receivedAt: at, status: "POSTED", callId: call.id }]);
      return json({ ok: true, call: { id: call.id, symbol: call.symbol, direction: call.direction, entryPrice: call.entryPrice, stopLoss: call.stopLoss, takeProfit1: call.takeProfit1, timeStopH: call.timeStopH } }, request);
    }, { ttlMs: 30_000, waitMs: 5_000 });
  } catch (e) {
    if (e instanceof LockBusy) return json({ error: "busy" }, request, 409);
    return json({ error: "lock_unavailable" }, request, 503);
  }
}
