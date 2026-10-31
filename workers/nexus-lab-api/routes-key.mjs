// ── /v2/key/* — auth v2 build step 2: random trading keys (docs/auth-v2-spec.md §A, flows) ───────────
// OFF unless worker var AUTH_V2_KEYS === "true": every route answers 404 v2_keys_off, so merging this
// changes no live behaviour. Nothing reads the stored key yet: the trading routes and exec still use
// the v1 derived key until build step 3, which is why /proxy/bankr-register is not switched here (a
// v2-only registration would leave v1 trading with no key at Orderly). Keys live in their own record
// (v2key:{addr}), not agent:key, so v1 DEACTIVATE (which deletes agent:key) can't delete one.
//
//   GET  /v2/key/:wallet          public status (never the secret)
//   POST /v2/key/begin            {wallet, session}                          → {pendingId, typedData}
//   POST /v2/key/complete         {wallet, session, pendingId, nonce, v2Sig, eip712Sig}
//   POST /v2/key/remove           {wallet, session, nonce, v2Sig}
//   POST /v2/key/bankr-register   {walletAddress, bankrApiKey}               (begin → Bankr signs → complete)
//
// Auth: `session` = the 24h trading session (tradingSession.mjs, derives nothing). Registering and
// removing a key also need the per-request challenge (GET /auth/challenge, action key.register /
// key.remove), checked here ALWAYS, not behind AUTH_V2. The Bankr route is authorised the way every
// Bankr route is: Bankr signs as the wallet with the caller's API key, and the EIP-712 signature must
// recover to that wallet. Every key change for a wallet runs under one NexusLock lease.
import { recoverTypedDataAddress } from "viem";
import { json, recoverEthAddress } from "./shared.mjs";
import { checkTradingSession } from "./routes-session.mjs";
import { verifyV2, orderlyAccountId } from "./logic.mjs";
import { withLock, LOCK_KEYS, LockBusy, LockError } from "./lock.mjs";
import { aesGcmEncrypt, aesGcmDecrypt } from "./seedVault.mjs";
import { keyPresent } from "./routes-removekey.mjs";
import bs58 from "bs58";
import {
  BROKER_ID, ORDERLY_CHAIN_ID, ORDERLY_VC, V2_KEY, V2_PENDING, V2_PENDING_TTL_S,
  newKeyMaterial, orderlyKeyOf, addKeyMessage, addKeyTypedData, addKeyRefusal, keyRecord, publicKeyStatus, orderlyHeaders,
} from "./v2Keys.mjs";

export const ORDERLY_BASE = "https://api-evm.orderly.org";
export const BANKR_BASE = "https://api.bankr.bot";
const ADDR = /^0x[0-9a-f]{40}$/;
const kvOf = (env) => env.NEXUS_AGENT;

class Refused extends Error {
  constructor(status, body) { super(body?.error || "refused"); this.status = status; this.body = body; }
}

async function readJson(r) { try { return await r.json(); } catch { return null; } }

/** The per-request challenge, always enforced here. Burns the nonce on success. */
async function checkChallenge(env, { action, wallet, nonce, v2Sig, now }) {
  if (!nonce || !v2Sig) throw new Refused(401, { error: "challenge_required", hint: `GET /auth/challenge?wallet=${wallet}&action=${action}, sign it, send {nonce, v2Sig}.` });
  const raw = await kvOf(env).get(`auth:nonce:${nonce}`);
  if (!raw) throw new Refused(401, { error: "challenge_unknown_or_expired" });
  let record; try { record = JSON.parse(raw); } catch { throw new Refused(401, { error: "challenge_corrupt" }); }
  const v = verifyV2({ record, sig: v2Sig, expected: { action, wallet, amount: null }, now, recover: recoverEthAddress });
  if (!v.ok) throw new Refused(401, { error: "challenge_failed", reason: v.reason });
  await kvOf(env).delete(`auth:nonce:${nonce}`);
}

async function requireSession(env, wallet, session, now) {
  const v = await checkTradingSession(env, wallet, session, { now });
  if (!v.ok) throw new Refused(401, { error: "session_required", reason: v.reason, hint: "Sign a fresh trading session with this wallet and send it as `session`." });
}

const lockKey = (wallet) => LOCK_KEYS.v2Key(wallet);
async function locked(env, wallet, fn) {
  try { return await withLock(env, lockKey(wallet), fn); }
  catch (e) {
    if (e instanceof Refused) throw e;
    if (e instanceof LockBusy) throw new Refused(409, { error: "in_flight", hint: "Another key change for this wallet is running. Try again in a moment." });
    if (e instanceof LockError) throw new Refused(503, { error: "lock_unavailable" });
    throw e;
  }
}

/** Begin: a fresh random key, held pending (sealed) for 10 minutes. Replaces any earlier pending one. */
export async function beginKey(env, wallet, { now = Date.now(), randomBytes } = {}) {
  return locked(env, wallet, async () => {
    const mat = await newKeyMaterial({ randomBytes });
    const message = addKeyMessage({ orderlyKey: mat.orderlyKey, now });
    const pendingId = Array.from(randomBytes ? randomBytes(16) : crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    const sealed = await aesGcmEncrypt(mat.secret, env.AGENT_ENC_KEY);
    await kvOf(env).put(V2_PENDING(wallet), JSON.stringify({ pendingId, sealed, message, createdAt: now }), { expirationTtl: V2_PENDING_TTL_S });
    return { pendingId, orderlyKey: mat.orderlyKey, expiresAt: message.expiration, typedData: addKeyTypedData(message) };
  });
}

/** Ask Orderly to remove `orderlyKey` from the account, signed by the active key `secret`. true / false. */
async function removeAtOrderly({ secret, signerKey, accountId, orderlyKey, fetchImpl, now }) {
  const path = "/v1/client/remove_orderly_key";
  const body = JSON.stringify({ orderly_key: orderlyKey });
  const headers = await orderlyHeaders({ seed: bs58.decode(secret), orderlyKey: signerKey, accountId, method: "POST", path, body, now });
  const r = await readJson(await fetchImpl(ORDERLY_BASE + path, { method: "POST", headers, body }));
  return r?.success === true;
}

async function lookupKey({ accountId, orderlyKey, fetchImpl }) {
  try {
    return keyPresent(await readJson(await fetchImpl(`${ORDERLY_BASE}/v1/get_orderly_key?account_id=${accountId}&orderly_key=${encodeURIComponent(orderlyKey)}`, { method: "GET" })));
  } catch { return null; }
}

/**
 * Complete: the wallet's EIP-712 signature over the STORED message is relayed to Orderly; on
 * success === true the key becomes active. A rotation retires the previous key and removes it at
 * Orderly signed by the new one; a removal that fails stays listed (`retired`) for the next try.
 */
export async function completeKey(env, wallet, { pendingId, eip712Sig }, { now = Date.now(), fetchImpl = fetch } = {}) {
  return locked(env, wallet, async () => {
    const kv = kvOf(env);
    let pending = null;
    try { pending = JSON.parse((await kv.get(V2_PENDING(wallet))) || "null"); } catch { pending = null; }
    if (!pending || pending.pendingId !== pendingId) throw new Refused(409, { error: "pending_unknown", hint: "Begin again: a begun key lasts 10 minutes, and a newer begin replaces it." });
    const why = addKeyRefusal(pending.message);
    if (why) throw new Refused(409, { error: "pending_invalid", reason: why });
    const secret = await aesGcmDecrypt(pending.sealed, env.AGENT_ENC_KEY);
    if ((await orderlyKeyOf(secret)) !== pending.message.orderlyKey) throw new Refused(500, { error: "pending_mismatch" });
    let signer = null;
    try { signer = await recoverTypedDataAddress({ ...addKeyTypedData(pending.message), signature: eip712Sig }); } catch { signer = null; }
    if (!signer || signer.toLowerCase() !== wallet) throw new Refused(401, { error: "eip712_wrong_signer", hint: "The AddOrderlyKey signature must come from this wallet, over the typed data begin returned." });

    const accountId = orderlyAccountId(wallet, BROKER_ID);
    const res = await fetchImpl(`${ORDERLY_BASE}/v1/orderly_key`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Account-Id": accountId },
      body: JSON.stringify({ message: pending.message, signature: eip712Sig, userAddress: wallet, orderlyKey: pending.message.orderlyKey }),
    });
    const out = await readJson(res);
    if (out?.success !== true) {
      await kv.delete(V2_PENDING(wallet));
      throw new Refused(502, { error: "orderly_refused", code: out?.code ?? null, message: out?.message ?? null, hint: "Nothing was stored. Begin again." });
    }

    let prev = null;
    try { prev = JSON.parse((await kv.get(V2_KEY(wallet))) || "null"); } catch { prev = null; }
    const toRetire = prev?.v === 2 ? [...(prev.retired || []), prev.orderlyKey].filter((k) => k && k !== pending.message.orderlyKey) : [];
    const rec = keyRecord({ sealed: pending.sealed, accountId, message: pending.message, now, retired: toRetire });
    await kv.put(V2_KEY(wallet), JSON.stringify(rec));
    await kv.delete(V2_PENDING(wallet));

    const stillLive = [];
    for (const k of rec.retired) {
      let ok = false;
      try { ok = await removeAtOrderly({ secret, signerKey: rec.orderlyKey, accountId, orderlyKey: k, fetchImpl, now }); } catch { ok = false; }
      if (!ok) stillLive.push(k);
    }
    if (stillLive.length !== rec.retired.length) { rec.retired = stillLive; await kv.put(V2_KEY(wallet), JSON.stringify(rec)); }
    return { ok: true, ...publicKeyStatus(rec, now), rotated: toRetire.length > 0, retiredStillLive: stillLive };
  });
}

/** Remove: retired keys first, then the active key itself (self-signed), confirmed by Orderly's lookup. */
export async function removeKey(env, wallet, { now = Date.now(), fetchImpl = fetch } = {}) {
  return locked(env, wallet, async () => {
    const kv = kvOf(env);
    let rec = null;
    try { rec = JSON.parse((await kv.get(V2_KEY(wallet))) || "null"); } catch { rec = null; }
    if (!rec || rec.v !== 2) return { ok: true, status: "no_key" };
    const secret = await aesGcmDecrypt(rec.tradingKey, env.AGENT_ENC_KEY);
    const keys = [...(rec.retired || []), rec.orderlyKey];
    const left = [];
    for (const k of keys) {
      let ok = false;
      try { ok = await removeAtOrderly({ secret, signerKey: rec.orderlyKey, accountId: rec.accountId, orderlyKey: k, fetchImpl, now }); } catch { ok = false; }
      if (!ok && (await lookupKey({ accountId: rec.accountId, orderlyKey: k, fetchImpl })) !== false) left.push(k);
    }
    const activeGone = !left.includes(rec.orderlyKey) && (await lookupKey({ accountId: rec.accountId, orderlyKey: rec.orderlyKey, fetchImpl })) === false;
    if (activeGone && left.length === 0) { await kv.delete(V2_KEY(wallet)); return { ok: true, status: "removed", orderlyKey: rec.orderlyKey }; }
    throw new Refused(502, { error: "not_removed", stillLive: left, hint: "Orderly didn't confirm the removal. The record is kept so it can be tried again." });
  });
}

/** Bankr: make sure the Orderly account exists (Bankr signs Registration), as /proxy/bankr-register does. */
async function ensureAccount(wallet, bankrApiKey, { fetchImpl, now }) {
  const got = await readJson(await fetchImpl(`${ORDERLY_BASE}/v1/get_account?address=${wallet}&broker_id=${BROKER_ID}`));
  if (got?.data?.account_id) return got.data.account_id;
  const nonce = (await readJson(await fetchImpl(`${ORDERLY_BASE}/v1/registration_nonce`)))?.data?.registration_nonce;
  if (!nonce) throw new Refused(502, { error: "registration_nonce_unavailable" });
  const message = { brokerId: BROKER_ID, chainId: ORDERLY_CHAIN_ID, timestamp: now, registrationNonce: String(nonce) };
  const typedData = {
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      Registration: [{ name: "brokerId", type: "string" }, { name: "chainId", type: "uint256" }, { name: "timestamp", type: "uint64" }, { name: "registrationNonce", type: "uint256" }],
    },
    primaryType: "Registration",
    domain: { name: "Orderly", version: "1", chainId: ORDERLY_CHAIN_ID, verifyingContract: ORDERLY_VC },
    message,
  };
  const signature = await bankrSignTyped(bankrApiKey, typedData, fetchImpl);
  const acct = await readJson(await fetchImpl(`${ORDERLY_BASE}/v1/register_account`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, signature, userAddress: wallet }),
  }));
  const id = acct?.data?.account_id;
  if (!id) throw new Refused(502, { error: "orderly_account_registration_failed", code: acct?.code ?? null, message: acct?.message ?? null });
  return id;
}

async function bankrSignTyped(bankrApiKey, typedData, fetchImpl) {
  let d = null;
  try {
    d = await readJson(await fetchImpl(`${BANKR_BASE}/wallet/sign`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": bankrApiKey },
      body: JSON.stringify({ signatureType: "eth_signTypedData_v4", typedData }),
    }));
  } catch (e) { throw new Refused(502, { error: "bankr_unreachable", message: String(e?.message || e) }); }
  if (!d?.success || typeof d.signature !== "string") throw new Refused(502, { error: "bankr_sign_failed", message: d?.message || d?.error || null });
  return d.signature;
}

export async function handleKey(parts, request, env, deps = {}) {
  if (!(parts[0] === "v2" && parts[1] === "key")) return null;
  if (env.AUTH_V2_KEYS !== "true") return json({ error: "v2_keys_off" }, request, 404);
  if (!kvOf(env) || !env.AGENT_ENC_KEY) return json({ error: "key_store_unavailable" }, request, 503);
  const now = (deps.now || Date.now)();
  const fetchImpl = deps.fetchImpl || fetch;
  const action = parts[2];

  if (request.method === "GET" && parts.length === 3) {
    const wallet = String(action || "").toLowerCase();
    if (!ADDR.test(wallet)) return json({ error: "bad_wallet" }, request, 400);
    let rec = null;
    try { rec = JSON.parse((await kvOf(env).get(V2_KEY(wallet))) || "null"); } catch { rec = null; }
    return json({ wallet, ...publicKeyStatus(rec, now) }, request);
  }
  if (request.method !== "POST" || parts.length !== 3) return json({ error: "not_found" }, request, 404);

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, request, 400); }
  try {
    if (action === "bankr-register") {
      const wallet = String(body?.walletAddress || "").trim().toLowerCase();
      if (!ADDR.test(wallet) || !body?.bankrApiKey) return json({ error: "walletAddress (0x…) and bankrApiKey required" }, request, 400);
      await ensureAccount(wallet, body.bankrApiKey, { fetchImpl, now });
      const begun = await beginKey(env, wallet, { now, randomBytes: deps.randomBytes });
      const eip712Sig = await bankrSignTyped(body.bankrApiKey, begun.typedData, fetchImpl);
      return json(await completeKey(env, wallet, { pendingId: begun.pendingId, eip712Sig }, { now, fetchImpl }), request);
    }
    const wallet = String(body?.wallet || "").trim().toLowerCase();
    if (!ADDR.test(wallet)) return json({ error: "bad_wallet" }, request, 400);
    await requireSession(env, wallet, body?.session, now);
    if (action === "begin") return json({ ok: true, ...(await beginKey(env, wallet, { now, randomBytes: deps.randomBytes })) }, request);
    if (action === "complete") {
      await checkChallenge(env, { action: "key.register", wallet, nonce: body?.nonce, v2Sig: body?.v2Sig, now });
      return json(await completeKey(env, wallet, { pendingId: body?.pendingId, eip712Sig: body?.eip712Sig }, { now, fetchImpl }), request);
    }
    if (action === "remove") {
      await checkChallenge(env, { action: "key.remove", wallet, nonce: body?.nonce, v2Sig: body?.v2Sig, now });
      return json(await removeKey(env, wallet, { now, fetchImpl }), request);
    }
    return json({ error: "not_found" }, request, 404);
  } catch (e) {
    if (e instanceof Refused) return json(e.body, request, e.status);
    console.error("[v2key]", e?.message || e);
    return json({ error: "key_route_failed" }, request, 500);
  }
}
