// ── Owner signature for Lab records ───────────────────────────────────────────
// A wallet's calls, journal notes and profile live at og./lab/:address and og./profile/:address.
// Those routes used to trust the URL: whoever named an address could replace, delete or read the
// whole record, private calls and notes included. Now every write, and the full (private) read,
// carries `labAuth: { ts, sig, signer? }` in the JSON body: the wallet's signature over
// labSaveMessage(signer, ts). The worker checks it BEFORE any side effect.
//
// ONE message builder for both sides (the browser signs it, the worker rebuilds it), so the two can't
// drift into "every signature is wrong". Pure: the worker injects the crypto (secp256k1 recover for
// EVM, ed25519 verify for Solana) so this file stays dependency-free for the browser bundle.
//
// Deliberately NOT the 'nexus-trading-key-v1' signature: that one seeds agent trading keys, so it must
// not become a bearer token for everyday saves. This one only opens the Lab record, for a day.

export const LAB_AUTH_MAX_AGE_MS = 24 * 3600 * 1000;   // the worker accepts a signature this long
export const LAB_AUTH_REUSE_MS = 23 * 3600 * 1000;     // the browser re-signs an hour early (clock drift)
export const LAB_AUTH_SKEW_MS = 5 * 60 * 1000;         // "signed in the future" by more than this = refused

export const isEvmAddress = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
// Solana: a base58 ed25519 public key. Case-sensitive, so the signer travels with its original case
// (the Lab keys records by the LOWERCASED address; the signature needs the real one).
export const isSolAddress = (a) => typeof a === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);

/** The exact text the wallet signs. ASCII only (every wallet renders it the same way). */
export function labSaveMessage(signer, ts) {
  const who = isEvmAddress(signer) ? signer.toLowerCase() : String(signer);
  return `Nexus Lab: save and open my calls, notes and profile\nAddress: ${who}\nTimestamp: ${ts}\nNo funds move. Valid 24 hours.`;
}

/**
 * Does `auth` prove the caller owns `address` (the route's lowercased key)?
 * @param {{ address: string, auth: unknown, now?: number,
 *           recoverEvm: (message: string, sigHex: string) => string|null,
 *           verifySol: (message: string, sigHex: string, signerB58: string) => boolean }} p
 * @returns {{ ok: true, signer: string } | { ok: false, reason: string }}
 */
export function verifyLabAuth({ address, auth, now = Date.now(), recoverEvm, verifySol }) {
  const addr = String(address || "").trim().toLowerCase();
  if (!auth || typeof auth !== "object") return { ok: false, reason: "missing" };
  const ts = Number(auth.ts);
  const sig = auth.sig;
  if (!Number.isSafeInteger(ts) || typeof sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(sig)) return { ok: false, reason: "malformed" };
  if (now - ts > LAB_AUTH_MAX_AGE_MS) return { ok: false, reason: "expired" };
  if (ts - now > LAB_AUTH_SKEW_MS) return { ok: false, reason: "future" };

  if (isEvmAddress(addr)) {
    let who = null;
    try { who = recoverEvm(labSaveMessage(addr, ts), sig); } catch { who = null; }
    return who && String(who).toLowerCase() === addr ? { ok: true, signer: addr } : { ok: false, reason: "wrong_signer" };
  }
  // Solana: the signer must BE this record's owner (same key, case aside) and must have signed.
  const signer = auth.signer;
  if (!isSolAddress(signer) || signer.toLowerCase() !== addr) return { ok: false, reason: "wrong_signer" };
  let good = false;
  try { good = verifySol(labSaveMessage(signer, ts), sig, signer) === true; } catch { good = false; }
  return good ? { ok: true, signer } : { ok: false, reason: "wrong_signer" };
}

const toHex = (b) => "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Sign the Lab message with the CONNECTED wallet (the browser side of verifyLabAuth).
 * EVM: an EIP-1193 provider → personal_sign (message as 0x-hex of its UTF-8 bytes, the standard
 * wire the worker's recover expects). Solana: a provider with signMessage(Uint8Array) → the raw
 * 64-byte ed25519 signature, sent as 0x-hex with the signer's REAL (mixed-case) address.
 * Throws a user-readable Error when it can't sign. Pure (no React), so the wire is testable
 * against the worker's own check.
 * @param {string} addr the record's address (any case)
 * @param {{ provider?: any, address?: string|null } | null} wallet
 * @param {{ fallbackSigner?: string|null, now?: number }} [opts]
 * @returns {Promise<{ ts: number, sig: string, signer?: string }>}
 */
export async function signLabAuth(addr, wallet, { fallbackSigner = null, now = Date.now() } = {}) {
  const provider = wallet?.provider;
  if (!provider) throw new Error("Connect your wallet to save.");
  const ts = now;
  const lower = String(addr).toLowerCase();
  if (isEvmAddress(addr)) {
    if (typeof provider.request !== "function") throw new Error("This wallet can't sign messages here.");
    const accounts = (await provider.request({ method: "eth_accounts" }).catch(() => [])) || [];
    const account = accounts.find((a) => typeof a === "string" && a.toLowerCase() === lower)
      || (typeof wallet?.address === "string" && wallet.address.toLowerCase() === lower ? wallet.address : null);
    if (!account) throw new Error(`Switch your wallet to ${addr.slice(0, 6)}…${addr.slice(-4)} to save.`);
    const sig = await provider.request({ method: "personal_sign", params: [toHex(new TextEncoder().encode(labSaveMessage(lower, ts))), account] });
    if (typeof sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(sig)) throw new Error("The wallet returned no signature.");
    return { ts, sig };
  }
  const signer = [wallet?.address, fallbackSigner].find((a) => isSolAddress(a) && a.toLowerCase() === lower);
  if (!signer) throw new Error("Switch your wallet to this account to save.");
  if (typeof provider.signMessage !== "function") throw new Error("This wallet can't sign messages here.");
  const out = await provider.signMessage(new TextEncoder().encode(labSaveMessage(signer, ts)));
  const bytes = out instanceof Uint8Array ? out : out?.signature instanceof Uint8Array ? out.signature : null;
  if (!bytes || bytes.length !== 64) throw new Error("The wallet returned no signature.");
  return { ts, sig: toHex(bytes), signer };
}

/**
 * What anyone may read without the owner's signature: the calls the owner made PUBLIC.
 * Private and holders-only calls stay out, and so do journal notes. The Holders Room serves
 * holders-only calls through its own gate (/feed/holders).
 */
export function publicLabView(record) {
  const theses = Array.isArray(record?.theses) ? record.theses : [];
  // `=== true`, exactly as /feed filters: the public view can't show more than the feed does.
  // A copy of a call another wallet is proven to have made (duplicateOf, lab-api callDedupe.mjs) isn't
  // this wallet's call: its owner's public view shows it.
  return { theses: theses.filter((t) => t && t.isPublic === true && !t.holdersOnly && !t.duplicateOf), notes: {} };
}
