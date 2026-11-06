// ── The agent on auth v2 (build step 3b, docs/auth-v2-spec.md "Agent", §B, §C) ──────────────────────
// Every agent mutation, and /twap, proves the wallet one of two ways:
//   • v1: `walletSig` = personal_sign("nexus-trading-key-v1"), unchanged and still the default;
//   • v2: `session` = the 24h trading session (tradingSession.mjs), only when AUTH_V2_KEYS === "true".
// On the v2 path a live agent (or a TWAP) runs on the wallet's ONE v2 key (v2key:{addr}): activation
// needs an active key and never makes one, and it stores only a link (agentKeyExpiry.mjs
// V2_KEY_LINK) where the v1 path stores a derived key. Exec reads the key through the link
// (nexus-agent-exec/agentKey.mjs), so DEACTIVATE and KILL delete the link and the wallet keeps its key.
//
// §C on the v2 path, always (not behind AUTH_V2): arming AUTONOMOUS, or raising capitalPerTrade or
// leverage on an AUTONOMOUS agent, needs the per-request challenge too. Kill needs a session only
// (borst 2026-10-31: stopping stays cheap); so does a TWAP (orders take no challenge either).
import { checkTradingSession } from "./routes-session.mjs";
import { checkChallenge, Refused } from "./routes-key.mjs";
import { V2_KEY, publicKeyStatus } from "./v2Keys.mjs";
import { V2_KEY_LINK, keyEntryRefusal, KEY_REFUSAL_TEXT } from "../../app/lib/agentKeyExpiry.mjs";

export { Refused };
const TRADING_MESSAGE = "nexus-trading-key-v1";
const WALLET_SIG_HINT = "This agent action requires walletSig = sign_message('nexus-trading-key-v1') from the agent's own wallet, or a trading session.";

/**
 * Who is asking. → { ok: true, via: "v1" | "v2" } | { ok: false, status, body }.
 * `recover(message, sig)` = the lab-api ecrecover (shared.mjs recoverEthAddress).
 */
export async function agentOwner(env, address, body, { recover, now = Date.now(), hint = WALLET_SIG_HINT } = {}) {
  const wallet = String(address).toLowerCase();
  if (body && typeof body === "object" && body.session) {
    if (env.AUTH_V2_KEYS !== "true") return { ok: false, status: 400, body: { error: "v2_keys_off", hint: "Trading sessions aren't switched on yet. Send walletSig." } };
    if (body.walletSig) return { ok: false, status: 400, body: { error: "pick_one_auth", hint: "Send a session or a walletSig, not both." } };
    const v = await checkTradingSession(env, wallet, body.session, { now });
    if (!v.ok) return { ok: false, status: 401, body: { error: "session_required", reason: v.reason, hint: "Sign a fresh trading session with this wallet and send it as `session`." } };
    return { ok: true, via: "v2" };
  }
  const sig = body?.walletSig;
  let who = null;
  try { who = typeof sig === "string" && sig ? String(recover(TRADING_MESSAGE, sig) || "").toLowerCase() : null; } catch { who = null; }
  if (who && who === wallet) return { ok: true, via: "v1" };
  return { ok: false, status: 401, body: { error: "walletSig_required", hint } };
}

/**
 * The wallet's v2 key, ready for a live agent (or TWAP). `holdHours` = the longest a position (or a
 * schedule) can run; pass null to skip that check (ASSISTED places nothing). A missing hold
 * (undefined) is checked, and refused as no_max_hold. Throws Refused(409).
 */
export async function v2KeyReady(env, address, { holdHours, now = Date.now() } = {}) {
  let rec = null;
  try { rec = JSON.parse((await env.NEXUS_AGENT.get(V2_KEY(address))) || "null"); } catch { rec = null; }
  if (!rec || rec.v !== 2) throw new Refused(409, { error: "key_required", hint: "This wallet has no Nexus trading key yet. Register one: POST /v2/key/begin (or /v2/key/bankr-register). Activation never makes one." });
  const st = publicKeyStatus(rec, now);
  if (!st.active) throw new Refused(409, { error: "key_expired", expiresAt: rec.expiresAt, hint: "The trading key expired at Orderly. Register a new one: POST /v2/key/begin." });
  if (holdHours !== null) {
    const why = keyEntryRefusal({ v: 2, expiresAt: rec.expiresAt }, { holdHours, now });
    if (why) throw new Refused(409, { error: why, expiresAt: rec.expiresAt, keyExpiresInDays: st.expiresInDays, hint: KEY_REFUSAL_TEXT[why] });
  }
  return { keyExpiresAt: rec.expiresAt, keyExpiresInDays: st.expiresInDays };
}

/** Store the link (agent:key:{addr} or twap:key:{addr}). It replaces a v1 record: the agent moves to v2. */
export async function writeV2Link(kv, recordKey, now = Date.now()) {
  await kv.put(recordKey, JSON.stringify(V2_KEY_LINK(now)));
}

/** §C: does this config change need the challenge? Arming AUTONOMOUS, or raising its size or leverage. */
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

/** The challenge itself (GET /auth/challenge?wallet=&action=), burned on success. Throws Refused(401). */
export async function armChallenge(env, { action, address, body, now = Date.now() }) {
  await checkChallenge(env, { action, wallet: String(address).toLowerCase(), nonce: body?.nonce, v2Sig: body?.v2Sig, now });
}
