// ── Retiring a wallet's v1 key when it moves to v2 (PR #847 review, saltorious P1) ───────────────────
// The v1 trading key is derived from personal_sign("nexus-trading-key-v1"): a fixed message, so any
// old copy of that signature re-derives the key and keeps trading through Orderly and through every
// Nexus route that takes `walletSig`. Registering a v2 key alone closes none of that. So
// POST /v2/key/bankr-register, after its v2 key is active, also:
//   1. has Bankr sign the v1 message once, in memory, to learn the v1 key's PUBLIC string (the
//      signature must recover to the wallet; it is never stored, logged or returned, and the seed
//      is dropped as soon as the public key is known);
//   2. removes that key at Orderly, signed by the NEW v2 key (as a v2 rotation does), and confirms
//      with Orderly's public lookup;
//   3. once the v1 key is confirmed gone (or was never registered), writes `v1off:{addr}`.
// From then on, `v1RetiredRefusal` (run in front of every route, index.js) answers any request that
// presents that wallet's v1 `walletSig` with 401 `v1_retired`, and refuses the v1 Bankr flows that
// would sign the v1 message server-side (/proxy/bankr-register would re-add the derived key).
//
// Never under a v1 agent: if a v1 agent key (`agent:key`, not a v2 pointer) holds a live position,
// or a v1 TWAP is running, removing the key would leave the position with nothing that can close
// it. Then nothing is removed or flagged and the reply says `skipped_in_use`; register again once
// the agent is flat. Every other failure also leaves the flag unset, so a retry does the whole step
// again. A failed retire never fails the v2 registration: the reply carries `v1Retire.status`.
import { TRADING_MESSAGE } from "./revokedTrading.mjs";
import { keyFromTradingSig } from "./routes-removekey.mjs";
import { KEY_POINTER_REF } from "./agentAuth.mjs";

export const V1_OFF = (addr) => `v1off:${String(addr).toLowerCase()}`;

const ADDR = /^0x[0-9a-f]{40}$/;
const isPointer = (rec) => !!rec && rec.v === 2 && rec.ref === KEY_POINTER_REF;

/** Is a v1 agent or TWAP still signing with the v1 key? → null | { error, hint } */
export async function v1KeyInUse(kv, address) {
  const a = String(address).toLowerCase();
  const read = async (k) => { try { return JSON.parse((await kv.get(k)) || "null"); } catch { return null; } };
  const [agentKey, state, twapKey, twap] = await Promise.all([read(`agent:key:${a}`), read(`agent:state:${a}`), read(`twap:key:${a}`), read(`twap:${a}`)]);
  if (agentKey && !isPointer(agentKey) && state?.current_position && !state.current_position.paper) {
    return { error: "v1_agent_position_open", hint: "A v1 agent holds a live position on the old key. Kill the agent (it closes first), then register again to retire the old key." };
  }
  if (twapKey && !isPointer(twapKey) && twap?.status === "ACTIVE") {
    return { error: "v1_twap_active", hint: "A TWAP is running on the old key. Cancel it, then register again to retire the old key." };
  }
  return null;
}

async function bankrPersonalSign(bankrApiKey, message, fetchImpl, bankrBase) {
  try {
    const r = await fetchImpl(`${bankrBase}/wallet/sign`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": bankrApiKey },
      body: JSON.stringify({ signatureType: "personal_sign", message }),
    });
    const d = await r.json().catch(() => null);
    return typeof d?.signature === "string" ? d.signature : null;
  } catch { return null; }
}

/**
 * Retire the wallet's v1 key. Returns { status } only (never the signature or a seed):
 *   removed | not_registered   → the flag is written
 *   skipped_in_use | sign_failed | wrong_signer | still_active | lookup_failed → nothing written
 * @param {object} p
 * @param {(a: {orderlyKey: string}) => Promise<boolean>} p.remove  removes a key at Orderly, signed by the v2 key
 * @param {(a: {orderlyKey: string}) => Promise<boolean|null>} p.lookup  Orderly's public lookup
 */
export async function retireV1Key({ kv, wallet, bankrApiKey, fetchImpl, bankrBase, recover, remove, lookup, now }) {
  const a = String(wallet).toLowerCase();
  const busy = await v1KeyInUse(kv, a);
  if (busy) return { status: "skipped_in_use", ...busy };

  let sig = await bankrPersonalSign(bankrApiKey, TRADING_MESSAGE, fetchImpl, bankrBase);
  if (!sig) return { status: "sign_failed" };
  let signer = null;
  try { signer = String(recover(TRADING_MESSAGE, sig) || "").toLowerCase(); } catch { signer = null; }
  if (signer !== a) return { status: "wrong_signer" };
  let { orderlyKey, seed } = await keyFromTradingSig(sig);
  seed.fill(0); seed = null; sig = null;

  const before = await lookup({ orderlyKey });
  let status;
  if (before === false) status = "not_registered";
  else {
    let ok = false;
    try { ok = await remove({ orderlyKey }); } catch { ok = false; }
    const after = await lookup({ orderlyKey });
    if (after === false) status = "removed";
    else return { status: after === null ? "lookup_failed" : "still_active", orderlyRemoveOk: ok };
  }
  await kv.put(V1_OFF(a), JSON.stringify({ at: now, status }));
  return { status };
}

/** Bankr flows that sign the v1 message for `walletAddress` server-side (as revokedTrading.mjs lists). */
const BANKR_V1_SIGNING = new Set(["bankr-register", "bankr-deposit"]);

/**
 * The gate (index.js, in front of every route): null = let through; else the refusal.
 * A KV read only when the body carries a walletSig or names a wallet for a v1 Bankr flow.
 */
export async function v1RetiredRefusal({ method, parts, body, kv, recover }) {
  if (!kv || method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  if (!body || typeof body !== "object") return null;
  const wallets = new Set();
  if (typeof body.walletSig === "string" && body.walletSig) {
    try { const w = String(recover(TRADING_MESSAGE, body.walletSig) || "").toLowerCase(); if (ADDR.test(w)) wallets.add(w); } catch { /* not a v1 signature */ }
  }
  if (parts[0] === "proxy" && BANKR_V1_SIGNING.has(parts[1])) {
    const w = String(body.walletAddress || "").trim().toLowerCase();
    if (ADDR.test(w)) wallets.add(w);
  }
  if (wallets.size === 0) return null;
  for (const w of wallets) {
    let flag = null;
    try { flag = await kv.get(V1_OFF(w)); } catch { flag = null; }
    if (!flag) continue;
    return {
      status: 401,
      body: {
        error: "v1_retired",
        wallet: w,
        hint: "This wallet moved to auth v2 and its old nexus-trading-key-v1 key was removed. Sign a 24h trading session (GET /v2/session/new) and send it as `session`.",
      },
    };
  }
  return null;
}
