// ── Auth v2 step 3b: the agent + TWAP on a trading session and the stored random key ──────────────
// (docs/auth-v2-spec.md, "Agent"). Two pieces, both answered only when AUTH_V2_KEYS === "true":
//
// 1. agentOwnerRefusal: the owner check every agent / TWAP mutation runs. A body with `session` is
//    checked as a 24h trading session for the wallet in the URL (it derives nothing); any other body
//    keeps the v1 check, walletSig = personal_sign("nexus-trading-key-v1") recovering to that wallet.
//
// 2. v2KeyPointer: going live on v2 links the agent to the wallet's ONE stored key (Q2: chat trading
//    and the agent share it). The agent's own record (`agent:key:{addr}`, `twap:key:{addr}`) becomes a
//    POINTER, `{ v: 2, ref: "v2key" }`, never a copy of the secret. Exec follows it to `v2key:{addr}`
//    (nexus-agent-exec/agentKey.mjs). So DEACTIVATE / KILL, which delete the agent's record, stop the
//    agent and leave the wallet's key alone, as the spec asks; removing the key is /v2/key/remove.
//    Activation never makes a key: no active key = 409 with the register step to call.
import { checkTradingSession } from "./routes-session.mjs";
import { wantsV2 } from "./tradingSigner.mjs";
import { V2_KEY, publicKeyStatus } from "./v2Keys.mjs";

export const V1_TRADING_MESSAGE = "nexus-trading-key-v1";
export const KEY_POINTER_REF = "v2key";

const refuse = (status, body) => ({ status, body });

/**
 * @returns {Promise<null | { status: number, body: object }>} null = the caller owns `address`
 */
export async function agentOwnerRefusal(env, address, body, { recover, now = Date.now() } = {}) {
  const wallet = String(address || "").toLowerCase();
  if (wantsV2(body)) {
    if (env.AUTH_V2_KEYS !== "true") return refuse(400, { error: "v2_keys_off", hint: "Trading sessions aren't switched on yet. Send walletSig." });
    if (body.walletSig) return refuse(400, { error: "pick_one_auth", hint: "Send a session or a walletSig, not both." });
    const v = await checkTradingSession(env, wallet, body.session, { now });
    if (!v.ok) return refuse(401, { error: "session_required", reason: v.reason, hint: "Sign a fresh trading session with this wallet and send it as `session`." });
    return null;
  }
  const sig = body?.walletSig;
  if (typeof sig === "string" && recover(V1_TRADING_MESSAGE, sig) === wallet) return null;
  return refuse(401, { error: "walletSig_required", hint: "This agent action requires walletSig = sign_message('nexus-trading-key-v1') from the agent's own wallet, or a trading session (`session`)." });
}

/**
 * The pointer record a live v2 agent (or TWAP) stores in place of a key, once the wallet's stored key
 * is checked active. Call only for a body that passed agentOwnerRefusal with a session.
 * @returns {Promise<{ ok: true, record: object, expiresAt: number, keyExpiresInDays: number } | { ok: false, status: number, body: object }>}
 */
export async function v2KeyPointer(env, address, { now = Date.now() } = {}) {
  const wallet = String(address || "").toLowerCase();
  let rec = null;
  try { rec = JSON.parse((await env.NEXUS_AGENT.get(V2_KEY(wallet))) || "null"); } catch { rec = null; }
  if (!rec || rec.v !== 2) return { ok: false, status: 409, body: { error: "key_required", hint: "This wallet has no Nexus trading key yet. Register one (POST /v2/key/begin or /v2/key/bankr-register), then go live." } };
  const st = publicKeyStatus(rec, now);
  if (!st.active) return { ok: false, status: 409, body: { error: "key_expired", expiresAt: rec.expiresAt, hint: "The trading key expired at Orderly. Register a new one (POST /v2/key/begin), then go live." } };
  return {
    ok: true,
    record: { v: 2, ref: KEY_POINTER_REF, accountId: rec.accountId, orderlyKey: rec.orderlyKey, linkedAt: now },
    expiresAt: rec.expiresAt,
    keyExpiresInDays: st.expiresInDays,
  };
}

/** A TWAP on a v2 key must finish (plus an hour's margin for late ticks) before the key expires. */
export const TWAP_KEY_MARGIN_MS = 3600000;
export function twapFitsKey({ now, durationMin, expiresAt }) {
  const end = Number(now) + Number(durationMin) * 60000 + TWAP_KEY_MARGIN_MS;
  return Number.isFinite(end) && Number(expiresAt) > end;
}

/**
 * Spec §C on the session path: does this config change need the per-request challenge? Arming
 * AUTONOMOUS, or raising its `capitalPerTrade` or `leverage`. Lowering, PAPER and ASSISTED never do.
 * The challenge itself is routes-key.mjs `checkChallenge`, enforced always (not behind AUTH_V2).
 */
export function configChallengeNeeded(prev, next) {
  if (next?.mode !== "AUTONOMOUS") return false;
  if (prev?.mode !== "AUTONOMOUS") return true;
  const up = (k) => {
    const a = Number(prev?.[k]), b = Number(next?.[k]);
    if (!Number.isFinite(b)) return false;
    return !Number.isFinite(a) || b > a;
  };
  return up("capitalPerTrade") || up("leverage");
}
