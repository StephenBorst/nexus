// ── AES-256-GCM for stored secrets, and the removal of trading-account seeds ───────────────────
// `aesGcmEncrypt`/`aesGcmDecrypt` = the "v1:<b64 iv>:<b64 ct>" format the agent keys use (Worker secret
// AGENT_ENC_KEY; exec decryptTradingKey reads it). lab-api's encryptSecret calls it.
//
// `user:{addr}.seed` held the order-only Orderly key seed (SHA-256 of the wallet's
// 'nexus-trading-key-v1' signature), cached by /order-history, /positions and bankr-register so
// GET /account-snapshot could sign reads with NO signature from the caller: anyone who knew a
// registered wallet could read its positions and open orders. Sealed at rest since 2026-10-23, but the
// hole was the route, not the storage. Retired 2026-10-26 (borst): the route answers 410 and nothing
// stores a seed. A key the server doesn't hold can't leak; sealing it kept a server-held trading key
// for a route nobody may use. `scrubStoredSeeds` (hourly cron) removes the ones already stored.
// Pure crypto + a KV walk; no fetch. Tests: seedVault.test.mjs.

const PREFIX = "v1:";
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(secretB64) {
  return crypto.subtle.importKey("raw", unb64(secretB64), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM, "v1:<b64 iv>:<b64 ct>". The same format the agent keys use (exec decryptTradingKey). */
export async function aesGcmEncrypt(plaintext, secretB64) {
  if (!secretB64) throw new Error("AGENT_ENC_KEY not configured");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secretB64), new TextEncoder().encode(plaintext));
  return `${PREFIX}${b64(iv)}:${b64(ct)}`;
}

export async function aesGcmDecrypt(stored, secretB64) {
  if (!secretB64) throw new Error("AGENT_ENC_KEY not configured");
  const [, iv, ct] = String(stored).split(":");
  if (!iv || !ct) throw new Error("bad sealed value");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(secretB64), unb64(ct));
  return new TextDecoder().decode(pt);
}

export const isSealed = (v) => typeof v === "string" && v.startsWith(PREFIX);

/**
 * Remove the `seed` field (plain or sealed) from `user:` records, a page per run, resuming from a
 * stored cursor. Two full passes: a worker copy still on the old code for a few minutes after the
 * deploy can store one more seed, and the second pass catches it. A record is rewritten only if it
 * still reads the same right before the write, so a registration landing mid-run isn't reverted.
 * Idempotent; a no-op once done. → { ran, done, passes, scanned, scrubbed }.
 */
export const SCRUB_STATE_KEY = "ops:seedscrub";
export const SCRUB_PAGE = 200;
export async function scrubStoredSeeds(kv, { page = SCRUB_PAGE, now = Date.now } = {}) {
  let state = {};
  try { state = JSON.parse((await kv.get(SCRUB_STATE_KEY)) || "{}"); } catch { state = {}; }
  if (state.done) return { ...state, ran: false };
  const listed = await kv.list({ prefix: "user:", cursor: state.cursor || undefined, limit: page });
  let scanned = 0, scrubbed = 0;
  for (const { name } of listed.keys || []) {
    scanned++;
    const raw = await kv.get(name);
    if (!raw) continue;
    let rec; try { rec = JSON.parse(raw); } catch { continue; }
    if (!rec || typeof rec !== "object" || !("seed" in rec)) continue;
    const { seed: _drop, ...rest } = rec;
    if ((await kv.get(name)) !== raw) continue; // changed under us; the next pass looks again
    await kv.put(name, JSON.stringify(rest));
    scrubbed++;
  }
  const passEnded = !!listed.list_complete || !listed.cursor;
  const passes = (state.passes || 0) + (passEnded ? 1 : 0);
  const done = passes >= 2;
  const next = {
    done, passes,
    cursor: passEnded ? null : listed.cursor,
    scanned: (state.scanned || 0) + scanned,
    scrubbed: (state.scrubbed || 0) + scrubbed,
    startedAt: state.startedAt || now(),
    updatedAt: now(),
    ...(done ? { doneAt: now() } : {}),
  };
  await kv.put(SCRUB_STATE_KEY, JSON.stringify(next));
  return { ...next, ran: true };
}
