// ── Trading session signature (auth v2, docs/auth-v2-spec.md §B) ───────────────────────────────
// Proves who is calling for at most 24 hours, and derives NOTHING. It replaces the identity half of
// the static personal_sign("nexus-trading-key-v1"), whose signature is also the wallet's trading key
// (seed = SHA-256 of it) and never changes or expires. v2's trading keys are random and registered at
// Orderly (spec §A), so this signature never needs to double as a key.
//
// ONE message builder for both sides (the client signs it, the worker rebuilds it), like labAuth.mjs.
// Pure: the worker injects secp256k1 recover. EVM only (Nexus trading accounts are EVM).
//
// Deliberately NOT the Lab signature: that one says "No funds move. No trades." and must stay true.
// A leaked copy of this one proves the wallet until `expires` and can't outlive 24 hours; the owner
// ends it sooner with the per-wallet "sessions issued before" switch (`sessionsAfter`).

export const TRADING_SESSION_MAX_MS = 24 * 3600 * 1000;
export const TRADING_SESSION_SKEW_MS = 5 * 60 * 1000;    // "issued in the future" by more than this = refused
export const TRADING_SESSION_DOMAIN = "og.nexustradinglabs.com";

const isEvm = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
const isSessionId = (s) => typeof s === "string" && /^[0-9a-f]{32}$/.test(s);

/** The exact text the wallet signs. ASCII only, so every wallet renders it the same way. */
export function tradingSessionMessage({ address, session, issued, expires, domain = TRADING_SESSION_DOMAIN }) {
  return "Nexus trading: sign in with this wallet\n"
    + "Lets Nexus use this wallet's Nexus trading key for orders, positions and your agent.\n"
    + "It can't withdraw.\n"
    + `Address: ${String(address).toLowerCase()}\n`
    + `Session: ${session}\n`
    + `Issued: ${issued}\n`
    + `Expires: ${expires}\n`
    + `Domain: ${domain}`;
}

/** A fresh session for `address` (the client signs `.message`, then sends {session, issued, expires, sig}). */
export function newTradingSession({ address, now = Date.now(), ttlMs = TRADING_SESSION_MAX_MS, randomBytes }) {
  const bytes = randomBytes ? randomBytes(16) : crypto.getRandomValues(new Uint8Array(16));
  const session = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const issued = now;
  const expires = now + Math.min(ttlMs, TRADING_SESSION_MAX_MS);
  return { session, issued, expires, message: tradingSessionMessage({ address, session, issued, expires }) };
}

/**
 * Does `auth` = { session, issued, expires, sig } prove the caller owns `address`, right now?
 * @param {{ address: string, auth: unknown, now?: number, sessionsAfter?: number,
 *           recover: (message: string, sigHex: string) => string|null, domain?: string }} p
 *   sessionsAfter: the wallet's "sessions issued before this are ended" stamp (0 = none).
 * @returns {{ ok: true, wallet: string, session: string, issued: number, expires: number } | { ok: false, reason: string }}
 */
export function verifyTradingSession({ address, auth, now = Date.now(), sessionsAfter = 0, recover, domain = TRADING_SESSION_DOMAIN }) {
  const wallet = String(address || "").trim().toLowerCase();
  if (!isEvm(wallet)) return { ok: false, reason: "bad_address" };
  if (!auth || typeof auth !== "object") return { ok: false, reason: "missing" };
  const { session, sig } = auth;
  const issued = Number(auth.issued), expires = Number(auth.expires);
  if (!isSessionId(session) || !Number.isSafeInteger(issued) || !Number.isSafeInteger(expires)
    || typeof sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(sig)) return { ok: false, reason: "malformed" };
  if (expires <= issued || expires - issued > TRADING_SESSION_MAX_MS) return { ok: false, reason: "bad_lifetime" };
  if (issued - now > TRADING_SESSION_SKEW_MS) return { ok: false, reason: "future" };
  if (now > expires) return { ok: false, reason: "expired" };
  if (Number(sessionsAfter) > 0 && issued < Number(sessionsAfter)) return { ok: false, reason: "ended" };
  let rec = null;
  try { rec = recover(tradingSessionMessage({ address: wallet, session, issued, expires, domain }), sig); } catch { rec = null; }
  if (!rec || String(rec).toLowerCase() !== wallet) return { ok: false, reason: "wrong_signer" };
  return { ok: true, wallet, session, issued, expires };
}
