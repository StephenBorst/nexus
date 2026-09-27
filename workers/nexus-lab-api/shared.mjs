// ── Shared HTTP + crypto primitives for nexus-lab-api ──
//
// nexus-lab-api grew to ~5.7k lines and 74 route blocks inside a single fetch()
// handler. CLAUDE.md's rule was "split only if it starts hurting" — it now hurts, so
// routes are being lifted into route modules one FAMILY at a time.
//
// ⚠️ This is the MONEY-PATH backend (trade / deposit / withdraw / agent control /
// subscriptions). A big-bang rewrite is how a live payment rail breaks. The rule for
// this migration:
//   1. One route family per commit, verified before the next.
//   2. Byte-identical logic — moves only, no "while I'm here" improvements.
//   3. Read-only families first; anything that moves funds goes last, if at all.
//
// This module holds the primitives EVERY route needs, so a route module never has to
// import from index.js (which would be circular).
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { hexToBytes, bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { verifyLabAuth } from "../../app/lib/labAuth.mjs";

export const ALLOWED_ORIGINS = [
  "https://trade.nexustradinglabs.com",
  "http://localhost:5173",
  "http://localhost:3000",
];

export function cors(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    // "*" (not just Content-Type): @solana/web3.js Connection adds a custom `solana-client`
    // request header to every RPC POST, which forces a CORS preflight — with only Content-Type
    // allowed the browser BLOCKED web3.js's getBalance/simulate/send/getSignatureStatuses to
    // /sol/rpc while a plain fetch (Content-Type only) to the same URL returned 200. Requests are
    // non-credentialed so "*" is honored as a wildcard; auth is body walletSig, never a header.
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400",
  };
}

export function json(data, request, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(request) },
  });
}

export function normalizeAddress(addr) {
  return addr.toLowerCase().trim();
}

/**
 * Recover the signer address from an EIP-191 personal_sign signature.
 *
 * ⚠️ Security-critical: this is the ecrecover behind every owner-authed mutation
 * (agent kill/config, holders gate, desks, live publish). It returns null rather
 * than throwing on a malformed signature — callers MUST treat null as "not
 * authorized" and never as "skip the check".
 */
export function recoverEthAddress(message, sigHex) {
  const msgBytes = utf8ToBytes(message);
  const prefix = utf8ToBytes("\x19Ethereum Signed Message:\n" + msgBytes.length);
  const digest = keccak_256(new Uint8Array([...prefix, ...msgBytes]));
  const sb = hexToBytes(sigHex.replace(/^0x/, ""));
  if (sb.length !== 65) return null;
  const r = sb.slice(0, 32), s = sb.slice(32, 64);
  let v = sb[64]; if (v >= 27) v -= 27;
  try {
    const sig = secp256k1.Signature
      .fromHex(bytesToHex(new Uint8Array([...r, ...s])))
      .addRecoveryBit(v);
    const pub = sig.recoverPublicKey(digest).toBytes(false).slice(1);
    return ("0x" + bytesToHex(keccak_256(pub).slice(-20))).toLowerCase();
  } catch (_) {
    return null;
  }
}

/**
 * Verify a Solana wallet's ed25519 signature over `message` (UTF-8). The signer is the base58
 * public key AS THE WALLET REPORTS IT (case matters in base58). The signature arrives as 0x-hex
 * of the 64 raw bytes. Returns false (never throws) on anything malformed.
 */
export function verifySolSignature(message, sigHex, signerB58) {
  try {
    const sig = hexToBytes(String(sigHex).replace(/^0x/, ""));
    const pub = bs58.decode(String(signerB58));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed25519.verify(sig, utf8ToBytes(message), pub);
  } catch (_) {
    return false;
  }
}

/**
 * The owner check for Lab records (app/lib/labAuth.mjs): does `auth` prove the caller owns
 * `address`? EVM → secp256k1 recover; Solana → ed25519 verify. { ok, signer } | { ok:false, reason }.
 * ⚠️ Run it BEFORE any side effect of the route it guards.
 */
export function checkLabAuth(address, auth, now = Date.now()) {
  return verifyLabAuth({ address, auth, now, recoverEvm: recoverEthAddress, verifySol: verifySolSignature });
}

/**
 * Canonical Holders-Room challenge — client and server MUST build this identically or
 * ecrecover yields a different address and the gate silently denies everyone. Lives
 * here (not in a route module) because both the /feed/holders route and index.js's
 * auth paths construct it.
 */
export function holdersRoomMessage(address, ts) {
  return `Nexus Holders Room
Address: ${address.toLowerCase()}
Timestamp: ${ts}`;
}

/**
 * Append to a wallet's in-app notification list (newest first, capped at 50).
 * Lives here because both the /notifications route and the resolution fan-out write
 * it — importing it from index.js would make route modules circular.
 */
export async function appendNotification(env, wallet, notif, opts = {}) {
  const w = String(wallet).toLowerCase();
  const key = `notif:${w}`;
  const raw = await env.LAB_STORE.get(key);
  const list = raw ? JSON.parse(raw) : [];
  list.unshift(notif);
  await env.LAB_STORE.put(key, JSON.stringify(list.slice(0, 50)));

  // Fan the SAME alert out to Telegram if this wallet linked a chat — so comments,
  // reactions, follows and copies all reach the bot, not just call resolutions.
  // Best-effort: the in-app notification is already written above, so a Telegram
  // outage can't cost it. `opts.telegram === false` lets a caller that sends its own
  // richer Telegram message (notifyResolution) opt out of this generic one.
  if (opts.telegram === false) return;
  try {
    const AGENT_KV = env.NEXUS_AGENT || env.LAB_STORE;
    const chatId = await AGENT_KV.get(`tg:chat:${w}`);
    if (chatId && env.TELEGRAM_TOKEN && notif?.message) {
      const link = notif?.thesisId ? `\nhttps://trade.nexustradinglabs.com/feed/thesis/${w}/${notif.thesisId}` : "";
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: `🔔 ${notif.message}${link}`, disable_web_page_preview: true }),
      });
    }
  } catch (e) { console.error("[notif] telegram failed", e.message); }
}
