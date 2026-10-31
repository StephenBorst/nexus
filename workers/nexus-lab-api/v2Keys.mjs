// ── Auth v2 trading keys: random, registered once, expiring at Orderly (docs/auth-v2-spec.md §A) ─────
// Pure parts of build step 2 (routes in routes-key.mjs). A v2 key is 32 random bytes, never derived from
// any signature, registered at Orderly with the wallet's own AddOrderlyKey EIP-712 signature for
// scope "read,trading" (never "asset": it can't withdraw) and a 30-day expiry that Orderly enforces
// itself, so the bound holds even if Nexus is breached.
//
// The typed data is built HERE, once, from the stored pending record; a client's typed data is never
// trusted. Same domain and types as the v1 registration (/proxy/bankr-register): brokerId
// nexus_trading, Arbitrum 42161, verifyingContract = the all-C sentinel.
import * as ed from "@noble/ed25519";
import bs58 from "bs58";

export const BROKER_ID = "nexus_trading";
export const ORDERLY_CHAIN_ID = 42161;
export const ORDERLY_VC = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC";
export const V2_KEY_SCOPE = "read,trading";
export const V2_KEY_DAYS = 30;                      // borst Q1/Q3, 2026-10-27
export const V2_PENDING_TTL_S = 600;                // a begun key must be completed within 10 minutes
export const V2_KEY = (addr) => `v2key:${String(addr).toLowerCase()}`;
export const V2_PENDING = (addr) => `v2key:pending:${String(addr).toLowerCase()}`;

const DAY = 86400000;

/** A fresh random key: { seed (32 bytes), secret (bs58 seed, what exec decodes), orderlyKey }. */
export async function newKeyMaterial({ randomBytes } = {}) {
  const seed = randomBytes ? Uint8Array.from(randomBytes(32)) : crypto.getRandomValues(new Uint8Array(32));
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  const pub = await ed.getPublicKeyAsync(seed);
  return { seed, secret: bs58.encode(seed), orderlyKey: "ed25519:" + bs58.encode(pub) };
}

/** The orderlyKey a stored bs58 secret signs as (so a record can be checked against itself). */
export async function orderlyKeyOf(secret) {
  return "ed25519:" + bs58.encode(await ed.getPublicKeyAsync(bs58.decode(secret)));
}

/** The AddOrderlyKey message for a key: issued now, expiring in 30 days. */
export function addKeyMessage({ orderlyKey, now = Date.now() }) {
  return { brokerId: BROKER_ID, chainId: ORDERLY_CHAIN_ID, orderlyKey, scope: V2_KEY_SCOPE, timestamp: now, expiration: now + V2_KEY_DAYS * DAY };
}

/** The full EIP-712 typed data the wallet signs (eth_signTypedData_v4 shape). */
export function addKeyTypedData(message) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      AddOrderlyKey: [
        { name: "brokerId", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "orderlyKey", type: "string" },
        { name: "scope", type: "string" },
        { name: "timestamp", type: "uint64" },
        { name: "expiration", type: "uint64" },
      ],
    },
    primaryType: "AddOrderlyKey",
    domain: { name: "Orderly", version: "1", chainId: ORDERLY_CHAIN_ID, verifyingContract: ORDERLY_VC },
    message,
  };
}

/** Refuse a message that isn't exactly a v2 key: our broker, our chain, read+trading only, ≤ 30 days. */
export function addKeyRefusal(m) {
  if (!m || typeof m !== "object") return "no_message";
  if (m.brokerId !== BROKER_ID) return "wrong_broker";
  if (m.chainId !== ORDERLY_CHAIN_ID) return "wrong_chain";
  if (m.scope !== V2_KEY_SCOPE) return "wrong_scope";
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(String(m.orderlyKey))) return "bad_key";
  if (!Number.isSafeInteger(m.timestamp) || !Number.isSafeInteger(m.expiration)) return "bad_times";
  if (m.expiration <= m.timestamp || m.expiration - m.timestamp > V2_KEY_DAYS * DAY) return "bad_lifetime";
  return null;
}

/**
 * The active key record (KV v2key:{addr}). `tradingKey` is the bs58 seed sealed with AES-256-GCM under
 * AGENT_ENC_KEY ("v1:<iv>:<ct>", the format exec's decryptTradingKey already reads). `retired` lists
 * keys replaced by a rotation whose removal at Orderly hasn't been confirmed (public key strings only).
 */
export function keyRecord({ sealed, accountId, message, now = Date.now(), retired = [] }) {
  return {
    v: 2, enc: "v1", tradingKey: sealed, accountId, orderlyKey: message.orderlyKey, scope: message.scope,
    registeredAt: now, issuedAt: message.timestamp, expiresAt: message.expiration, retired: [...new Set(retired)],
  };
}

/** What anyone may read about a wallet's key: never the sealed secret. */
export function publicKeyStatus(rec, now = Date.now()) {
  if (!rec || rec.v !== 2) return { active: false };
  const live = Number(rec.expiresAt) > now;
  return {
    active: live, expired: !live, orderlyKey: rec.orderlyKey, scope: rec.scope, accountId: rec.accountId,
    registeredAt: rec.registeredAt, expiresAt: rec.expiresAt, expiresInDays: Math.max(0, Math.floor((rec.expiresAt - now) / DAY)),
    retiredPending: Array.isArray(rec.retired) ? rec.retired.length : 0,
  };
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Orderly REST auth headers for a request signed by `seed` (ts + method + path + body, base64url). */
export async function orderlyHeaders({ seed, orderlyKey, accountId, method, path, body = "", now = Date.now() }) {
  const ts = now;
  const sig = await ed.signAsync(new TextEncoder().encode(`${ts}${method}${path}${body}`), seed);
  return {
    "Content-Type": method === "GET" ? "application/x-www-form-urlencoded" : "application/json",
    "orderly-timestamp": String(ts), "orderly-account-id": accountId, "orderly-key": orderlyKey, "orderly-signature": b64url(sig),
  };
}
