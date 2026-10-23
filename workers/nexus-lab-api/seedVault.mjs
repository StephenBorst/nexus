// ── The trading-account seed, encrypted at rest ────────────────────────────────────────────
// `user:{addr}.seed` = the order-only Orderly key seed (SHA-256 of the wallet's
// 'nexus-trading-key-v1' signature), cached by /order-history, /positions and bankr-register so
// /account-snapshot can sign reads for Bankr's tracker page. It sat in KV as plain hex: a KV dump
// alone could sign as that account (order-only: no withdrawals, but it can trade). Now it's sealed
// with AES-256-GCM under the same Worker secret as the agent keys (AGENT_ENC_KEY, format
// "v1:<b64 iv>:<b64 ct>"), so a dump without the secret is useless.
//
// Rules:
//   - never write a plaintext seed again: no secret ⇒ store no seed (the snapshot then says
//     "session_not_cached", as for a wallet that never cached one);
//   - read either form: a sealed seed is opened, a legacy plain one is used once and re-sealed;
//   - the hourly cron re-seals any plain seed left in KV (sealLegacySeeds), a page at a time.
// Pure crypto + a KV walk; no fetch. Tests: seedVault.test.mjs.

const PREFIX = "v1:";
const HEX64 = /^[0-9a-f]{64}$/i;
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
export const isPlainSeed = (v) => typeof v === "string" && HEX64.test(v);

/** The value to store for a seed, or null (no secret ⇒ store nothing, never plaintext). */
export async function sealSeed(seedHex, env) {
  if (!isPlainSeed(seedHex) || !env?.AGENT_ENC_KEY) return null;
  return aesGcmEncrypt(seedHex.toLowerCase(), env.AGENT_ENC_KEY);
}

/**
 * Open a stored seed. → { hex, reseal } where `reseal` is true for a legacy plain seed (the caller
 * writes the sealed form back). hex null = no usable seed (absent, garbled, or sealed with no secret).
 */
export async function openSeed(stored, env) {
  if (isPlainSeed(stored)) return { hex: stored.toLowerCase(), reseal: true };
  if (!isSealed(stored) || !env?.AGENT_ENC_KEY) return { hex: null, reseal: false };
  try {
    const hex = await aesGcmDecrypt(stored, env.AGENT_ENC_KEY);
    return { hex: isPlainSeed(hex) ? hex : null, reseal: false };
  } catch { return { hex: null, reseal: false }; }
}

/**
 * Cache a seed on `user:{addr}` sealed, when the record has none or still holds it in plain text.
 * Reads the record fresh and writes only the `seed` field onto it. → true if it wrote.
 */
export async function storeSealedSeed(kv, addr, seedHex, env) {
  const key = "user:" + String(addr).toLowerCase();
  const raw = await kv.get(key);
  if (!raw) return false;
  let rec; try { rec = JSON.parse(raw); } catch { return false; }
  if (isSealed(rec.seed)) return false;
  const sealed = await sealSeed(seedHex, env);
  if (!sealed) {
    // No secret: drop a plain seed rather than keep it in the clear.
    if (rec.seed === undefined) return false;
    const { seed: _drop, ...rest } = rec;
    await kv.put(key, JSON.stringify(rest));
    return true;
  }
  await kv.put(key, JSON.stringify({ ...rec, seed: sealed }));
  return true;
}

/**
 * Re-seal plain seeds left in KV, one `user:` page per run, resuming from a stored cursor until
 * the walk completes (then it records the finish and stops). Without the secret it does nothing.
 * → { scanned, sealed, done }.
 */
export const SEAL_CURSOR_KEY = "seedvault:cursor";
export const SEAL_DONE_KEY = "seedvault:done";
export async function sealLegacySeeds(kv, env, { pageSize = 200 } = {}) {
  if (!env?.AGENT_ENC_KEY) return { scanned: 0, sealed: 0, done: false, skipped: "no_secret" };
  if (await kv.get(SEAL_DONE_KEY)) return { scanned: 0, sealed: 0, done: true };
  const cursor = (await kv.get(SEAL_CURSOR_KEY)) || undefined;
  const page = await kv.list({ prefix: "user:", limit: pageSize, cursor });
  let sealed = 0;
  for (const { name } of page.keys || []) {
    const raw = await kv.get(name);
    if (!raw) continue;
    let rec; try { rec = JSON.parse(raw); } catch { continue; }
    if (!isPlainSeed(rec.seed)) continue;
    await kv.put(name, JSON.stringify({ ...rec, seed: await aesGcmEncrypt(rec.seed.toLowerCase(), env.AGENT_ENC_KEY) }));
    sealed++;
  }
  const scanned = (page.keys || []).length;
  if (page.list_complete || !page.cursor) {
    await kv.put(SEAL_DONE_KEY, new Date().toISOString());
    await kv.delete(SEAL_CURSOR_KEY);
    return { scanned, sealed, done: true };
  }
  await kv.put(SEAL_CURSOR_KEY, page.cursor);
  return { scanned, sealed, done: false };
}
