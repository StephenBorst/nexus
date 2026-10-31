// ── The v2 signer for the trading routes (auth v2 build step 3a, docs/auth-v2-spec.md) ──────────────
// A route that signs Orderly calls for a wallet takes EITHER:
//   • v1: `walletSig` (the static personal_sign, hashed into the key): unchanged, still the default;
//   • v2: `{ walletAddress | wallet, session }`: the 24h trading session (derives nothing) proves the
//     wallet, and the route signs with that wallet's stored random key (v2key:{addr}, routes-key.mjs).
// v2 is answered only when worker var AUTH_V2_KEYS === "true"; otherwise a `session` gets 400
// v2_keys_off and the caller falls back to walletSig. Each route keeps its v1 code byte-for-byte in
// an else branch; this file is the whole v2 path, so it's the part the tests cover.
//
// Returns a non-extractable WebCrypto Ed25519 key, the same object the v1 branches build, so the
// routes' signing code doesn't change. The secret never leaves this function.
import bs58 from "bs58";
import { checkTradingSession } from "./routes-session.mjs";
import { aesGcmDecrypt } from "./seedVault.mjs";
import { V2_KEY, publicKeyStatus } from "./v2Keys.mjs";

const PKCS8_ED25519 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
const ADDR = /^0x[0-9a-f]{40}$/;

/** Does this request body ask for the v2 path? */
export const wantsV2 = (body) => !!(body && typeof body === "object" && body.session);

const refuse = (status, body) => ({ ok: false, status, body });

/**
 * @returns {Promise<{ ok: true, wallet: string, accountId: string, orderlyKey: string, signingKey: CryptoKey, keyExpiresInDays: number }
 *                 | { ok: false, status: number, body: object }>}
 */
export async function v2Signer(env, body, { now = Date.now() } = {}) {
  if (env.AUTH_V2_KEYS !== "true") return refuse(400, { error: "v2_keys_off", hint: "Trading sessions aren't switched on yet. Send walletSig." });
  const wallet = String(body?.walletAddress || body?.wallet || "").trim().toLowerCase();
  if (!ADDR.test(wallet)) return refuse(400, { error: "bad_wallet", hint: "Send walletAddress (0x…) with the session." });
  if (body?.walletSig) return refuse(400, { error: "pick_one_auth", hint: "Send a session or a walletSig, not both." });
  const v = await checkTradingSession(env, wallet, body.session, { now });
  if (!v.ok) return refuse(401, { error: "session_required", reason: v.reason, hint: "Sign a fresh trading session with this wallet and send it as `session`." });
  let rec = null;
  try { rec = JSON.parse((await env.NEXUS_AGENT.get(V2_KEY(wallet))) || "null"); } catch { rec = null; }
  const st = publicKeyStatus(rec, now);
  if (!rec || rec.v !== 2) return refuse(409, { error: "key_required", hint: "This wallet has no Nexus trading key yet. Register one: POST /v2/key/begin (or /v2/key/bankr-register)." });
  if (!st.active) return refuse(409, { error: "key_expired", expiresAt: rec.expiresAt, hint: "The trading key expired at Orderly. Register a new one: POST /v2/key/begin." });
  let seed;
  try { seed = bs58.decode(await aesGcmDecrypt(rec.tradingKey, env.AGENT_ENC_KEY)); } catch { return refuse(500, { error: "key_unreadable" }); }
  if (seed.length !== 32) return refuse(500, { error: "key_unreadable" });
  const pk8 = new Uint8Array(48);
  pk8.set(PKCS8_ED25519, 0);
  pk8.set(seed, 16);
  const signingKey = await crypto.subtle.importKey("pkcs8", pk8, { name: "Ed25519" }, false, ["sign"]);
  pk8.fill(0);
  seed.fill(0);
  return { ok: true, wallet, accountId: rec.accountId, orderlyKey: rec.orderlyKey, signingKey, keyExpiresInDays: st.expiresInDays };
}
