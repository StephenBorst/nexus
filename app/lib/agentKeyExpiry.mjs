// ── The agent's v2 key and its expiry (auth v2 build step 3b, docs/auth-v2-spec.md "Agent", Q3) ─────
// A v2 trading key expires at Orderly 30 days after it is registered, and Orderly enforces that, so
// after expiresAt the key can place nothing, not even a close. The rule: the agent opens no position
// whose max hold would run past the key's expiry, so a key never expires under a position the agent
// could no longer close. From 3 days out the owner is told to rotate.
//
// One rule, two users: exec gates every LIVE entry with it; lab-api gates a TWAP schedule with it.
// v1 records (the key derived from the static signature) carry no expiry and are left as they are.

export const KEY_ALERT_DAYS = 3;
// The timeout close runs on exec's 1-minute cron and an unconfirmed close retries next tick; an hour
// of room covers a few failed ticks before the key stops working.
export const KEY_EXPIRY_BUFFER_MS = 60 * 60 * 1000;
export const KEY_ALERT_EVERY_MS = 24 * 60 * 60 * 1000;
const H = 60 * 60 * 1000;
const DAY = 24 * H;

/** The pointer an agent (agent:key) or a TWAP (twap:key) stores when it runs on the wallet's v2 key. */
export const V2_KEY_LINK = (now) => ({ v: 2, source: "v2key", linkedAt: now });
export const isV2Link = (rec) => !!rec && rec.v === 2 && rec.source === "v2key";

/**
 * Why a position held up to `holdHours` can't be opened on this key, or null when it can.
 * `key` = { v, expiresAt }. v1 (or no v) = null: unchanged behaviour.
 */
export function keyEntryRefusal(key, { holdHours, now = Date.now() } = {}) {
  if (!key || key.v !== 2) return null;
  const exp = Number(key.expiresAt);
  if (!Number.isFinite(exp)) return "key_expiry_unknown";
  if (exp <= now) return "key_expired";
  const hold = Number(holdHours);
  if (!Number.isFinite(hold) || hold <= 0) return "no_max_hold";
  if (now + hold * H + KEY_EXPIRY_BUFFER_MS > exp) return "hold_runs_past_key";
  return null;
}

/** Whole days left on the key (floored, never negative), or null for a v1 key. */
export function keyDaysLeft(key, now = Date.now()) {
  if (!key || key.v !== 2 || !Number.isFinite(Number(key.expiresAt))) return null;
  return Math.max(0, Math.floor((Number(key.expiresAt) - now) / DAY));
}

/** Tell the owner now? From KEY_ALERT_DAYS out (expired included), at most once a day. */
export function keyAlertDue(key, { now = Date.now(), lastAlertAt = 0 } = {}) {
  if (!key || key.v !== 2) return false;
  const exp = Number(key.expiresAt);
  if (!Number.isFinite(exp) || exp - now > KEY_ALERT_DAYS * DAY) return false;
  return !(Number(lastAlertAt) > 0) || now - Number(lastAlertAt) >= KEY_ALERT_EVERY_MS;
}

/** The owner's alert (Telegram HTML). */
export function keyAlertText(key, now = Date.now()) {
  const exp = Number(key?.expiresAt);
  if (!(exp > now)) {
    return "🔑 <b>Your agent's trading key has expired</b>\nThe agent opens nothing until you register a new key. Positions it already holds were sized to close before this.";
  }
  const days = keyDaysLeft(key, now);
  const when = days >= 1 ? `in ${days} day${days === 1 ? "" : "s"}` : "within a day";
  return `🔑 <b>Your agent's trading key expires ${when}</b>\nIt opens no trade whose max hold runs past that. Register a new key to keep it trading: the agent picks the new one up on its own.`;
}

/** Plain words for a refusal (logs and route replies). */
export const KEY_REFUSAL_TEXT = {
  key_expired: "The trading key has expired. Register a new key.",
  key_expiry_unknown: "The trading key has no readable expiry. Register a new key.",
  no_max_hold: "No max hold is set, so the trade can't be bounded by the key's expiry. Set maxHoldHours.",
  hold_runs_past_key: "The max hold would run past the trading key's expiry. Register a new key, or shorten the hold.",
};
