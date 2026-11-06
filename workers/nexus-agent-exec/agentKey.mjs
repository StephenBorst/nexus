// ── Auth v2 step 3b, exec side: the agent's key record may be a POINTER to the wallet's v2 key ──────
// lab-api (agentAuth.mjs v2KeyPointer) writes `agent:key:{addr}` / `twap:key:{addr}` as
// `{ v: 2, ref: "v2key" }` when a wallet goes live on a trading session. Exec follows it to
// `v2key:{addr}` (the ONE stored random key, registered at Orderly with a 30-day expiry) and signs with
// that. A v1 record (a sealed key in the record itself) reads exactly as before.
//
// No flag here: only lab-api writes a pointer, and only with AUTH_V2_KEYS on. A pointer whose key is
// missing THROWS (never "no key"): closePosition treats "no key" as "clear the record", which would
// abandon a live position, while a throw keeps it for the next tick.
//
// The expiry rule (spec "Agent", Q3): no entry whose max hold could run past the key's expiry, so a
// key never lapses under a position the agent could no longer close; from 3 days out, one alert a day.
export const V2_POINTER_REF = "v2key";
export const KEY_ALERT_DAYS = 3;
const DAY = 86400000;
const HOUR = 3600000;

export const isKeyPointer = (rec) => !!rec && rec.v === 2 && rec.ref === V2_POINTER_REF;

/**
 * The signing record for a stored agent/TWAP key record: { tradingKey (bs58 seed), accountId, v, expiresAt? }.
 * @param {object} rec      the parsed agent:key / twap:key record
 * @param {object} o        { address, kv (get), decrypt(sealed) → bs58 seed }
 */
export async function resolveKeyRecord(rec, { address, kv, decrypt }) {
  if (isKeyPointer(rec)) {
    let key = null;
    try { key = JSON.parse((await kv.get(`v2key:${String(address).toLowerCase()}`)) || "null"); } catch { key = null; }
    if (!key || key.v !== 2 || typeof key.tradingKey !== "string") throw new Error("v2 key record missing");
    return { tradingKey: await decrypt(key.tradingKey), accountId: key.accountId, orderlyKey: key.orderlyKey, expiresAt: Number(key.expiresAt), v: 2 };
  }
  if (!rec || typeof rec.tradingKey !== "string") throw new Error("key record unreadable");
  return { ...rec, tradingKey: await decrypt(rec.tradingKey), v: 1 };
}

/**
 * May a NEW position open on this key? v1 keys (365-day, derived) aren't bounded here.
 * @returns {string|null} null = ok, else why not
 */
export function keyHoldRefusal({ keyData, now, maxHoldHours }) {
  if (!keyData || keyData.v !== 2) return null;
  const exp = Number(keyData.expiresAt);
  if (!Number.isFinite(exp) || exp <= now) return "trading key expired";
  const hold = Number(maxHoldHours);
  if (!Number.isFinite(hold) || hold <= 0) return "no max hold set, so the position could outlast the key";
  if (now + hold * HOUR > exp) return `the ${hold}h max hold would run past the key's expiry`;
  return null;
}

/**
 * The daily "rotate your key" alert: from KEY_ALERT_DAYS before expiry (and after it), once per UTC day.
 * @returns {{ due: boolean, day: string, hoursLeft: number, expired: boolean }}
 */
export function keyAlertDue({ expiresAt, now, lastAlertDay }) {
  const day = new Date(now).toISOString().slice(0, 10);
  const exp = Number(expiresAt);
  if (!Number.isFinite(exp)) return { due: false, day, hoursLeft: NaN, expired: false };
  const left = exp - now;
  const expired = left <= 0;
  const due = left <= KEY_ALERT_DAYS * DAY && lastAlertDay !== day;
  return { due, day, hoursLeft: Math.max(0, Math.floor(left / HOUR)), expired };
}

export function keyAlertText({ hoursLeft, expired }) {
  if (expired) return "🔑 <b>Your Nexus trading key has expired</b>\nThe agent can't open new trades. Register a new key in the Lab (or via Bankr) to keep it trading.";
  const when = hoursLeft >= 48 ? `in about ${Math.round(hoursLeft / 24)} days` : `in about ${hoursLeft}h`;
  return `🔑 <b>Your Nexus trading key expires ${when}</b>\nThe agent won't open a trade whose max hold runs past that. Rotate the key in the Lab (or via Bankr) to keep it trading.`;
}
