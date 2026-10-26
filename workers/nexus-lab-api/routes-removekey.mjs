// ── POST /proxy/bankr-remove-key — kill a leaked trading key at Orderly ───────────────────────
// The order-only Orderly key Nexus registers for a wallet is derived from its trading signature
// (seed = SHA-256 of personal_sign("nexus-trading-key-v1")). That message is fixed, so a leaked
// signature is a leaked key, and the revoked-wallet gate (revokedTrading.mjs) only closes Nexus's
// own routes: the key still works directly against Orderly. Removing it at Orderly closes that
// too. Re-adding a key needs the wallet's own EIP-712 signature, which a leaked copy can't make.
//
// Owner-only: Bankr signs the message for `walletAddress` with the caller's Bankr API key, and the
// signature must recover to that wallet. It never accepts a walletSig, so a leaked copy can't
// drive it. The signature and seed stay inside this request: never returned, never logged.
//
// Steps, each reported:
//   1. Orderly's public lookup (GET /v1/get_orderly_key) — not on the account ⇒ "not_registered".
//   2. Holdings + open positions read WITH that key. Funds still there ⇒ 409 "withdraw_first":
//      /proxy/bankr-withdraw needs this key, so removing it first would strand the funds.
//      `force: true` skips this (e.g. the read fails but the account is known to be empty).
//   3. POST /v1/client/remove_orderly_key { orderly_key }, signed by the key itself.
//   4. The public lookup again ⇒ "removed" or "still_active". Orderly's refusal is passed through.
import * as ed from "@noble/ed25519";
import bs58 from "bs58";
import { json, recoverEthAddress } from "./shared.mjs";
import { orderlyAccountId } from "./logic.mjs";
import { TRADING_MESSAGE } from "./revokedTrading.mjs";

export const ORDERLY_BASE = "https://api-evm.orderly.org";
export const BANKR_BASE = "https://api.bankr.bot";
export const BROKER_ID = "nexus_trading";
const DUST_USDC = 0.01;

const hexBytes = (hex) => new Uint8Array(String(hex).replace(/^0x/, "").match(/.{2}/g).map((b) => parseInt(b, 16)));
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The Orderly key a trading signature derives: { seed, orderlyKey: "ed25519:<bs58 pubkey>" }. */
export async function keyFromTradingSig(sig) {
  const seed = new Uint8Array(await crypto.subtle.digest("SHA-256", hexBytes(sig)));
  const pub = await ed.getPublicKeyAsync(seed);
  return { seed, orderlyKey: "ed25519:" + bs58.encode(pub) };
}

/** Is the key on the account, per Orderly's public lookup? true / false, or null when unreadable. */
export function keyPresent(lookup) {
  if (!lookup || typeof lookup !== "object") return null;
  if (lookup.success === true && lookup.data) return lookup.data.key_status ? lookup.data.key_status === "ACTIVE" : true;
  if (lookup.success === false) return false;
  return null;
}

/** USDC-equivalent holdings above dust + open positions, from Orderly's holding/positions reads. */
export function fundsLeft(holding, positions) {
  const rows = Array.isArray(holding?.data?.holding) ? holding.data.holding : null;
  const pos = Array.isArray(positions?.data?.rows) ? positions.data.rows : null;
  if (!rows || !pos) return null;
  const balances = rows
    .map((h) => ({ token: h.token, amount: Number(h.holding || 0) + Number(h.pending_short || 0) }))
    .filter((h) => Math.abs(h.amount) > DUST_USDC);
  const open = pos.filter((p) => Number(p.position_qty) !== 0).map((p) => ({ symbol: p.symbol, qty: Number(p.position_qty) }));
  return { balances, open, empty: balances.length === 0 && open.length === 0 };
}

export async function handleRemoveKey(parts, request, env, deps = {}) {
  if (!(parts[0] === "proxy" && parts[1] === "bankr-remove-key" && parts.length === 2)) return null;
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, request, 405);
  const fetchImpl = deps.fetchImpl || fetch;
  const now = deps.now || Date.now;
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, request, 400); }
  const wallet = String(body?.walletAddress || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet) || !body?.bankrApiKey) {
    return json({ error: "walletAddress (0x…) and bankrApiKey required" }, request, 400);
  }

  // Bankr signs the trading message for this wallet; it must be this wallet's signature.
  let sig = null;
  try {
    const r = await fetchImpl(`${BANKR_BASE}/wallet/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": body.bankrApiKey },
      body: JSON.stringify({ signatureType: "personal_sign", message: TRADING_MESSAGE }),
    });
    const d = await r.json().catch(() => null);
    sig = typeof d?.signature === "string" ? d.signature : null;
    if (!sig) return json({ error: "bankr_sign_failed", status: r.status, message: d?.message || d?.error || null }, request, 502);
  } catch (e) {
    return json({ error: "bankr_unreachable", message: String(e?.message || e) }, request, 502);
  }
  if (recoverEthAddress(TRADING_MESSAGE, sig) !== wallet) {
    return json({ error: "signature_mismatch", hint: "Bankr signed with a different wallet than walletAddress." }, request, 401);
  }

  const { seed, orderlyKey } = await keyFromTradingSig(sig);
  sig = null;
  const accountId = orderlyAccountId(wallet, BROKER_ID);
  const lookupUrl = `${ORDERLY_BASE}/v1/get_orderly_key?account_id=${accountId}&orderly_key=${encodeURIComponent(orderlyKey)}`;
  const lookup = async () => {
    try { return await (await fetchImpl(lookupUrl, { method: "GET" })).json(); } catch { return null; }
  };
  const signed = async (method, path, data) => {
    const bs = data ? JSON.stringify(data) : "";
    const ts = now();
    const msg = new TextEncoder().encode(`${ts}${method}${path}${bs}`);
    const signature = b64url(await ed.signAsync(msg, seed));
    const headers = {
      "Content-Type": method === "GET" ? "application/x-www-form-urlencoded" : "application/json",
      "orderly-timestamp": String(ts), "orderly-account-id": accountId, "orderly-key": orderlyKey, "orderly-signature": signature,
    };
    try { return await (await fetchImpl(ORDERLY_BASE + path, { method, headers, body: bs || undefined })).json(); } catch { return null; }
  };
  const out = { wallet, accountId, orderlyKey };

  const before = await lookup();
  const present = keyPresent(before);
  if (present === null) return json({ ...out, error: "lookup_unreadable", hint: "Orderly's key lookup didn't answer. Nothing was removed; try again." }, request, 502);
  if (present === false) return json({ ...out, ok: true, status: "not_registered", hint: "Orderly has no such key on this account. Nothing to remove." }, request);

  if (body.force !== true) {
    const funds = fundsLeft(await signed("GET", "/v1/client/holding"), await signed("GET", "/v1/positions"));
    if (!funds) return json({ ...out, error: "funds_unreadable", hint: "Couldn't read this account's holdings with the key. Nothing was removed. If you know it's empty, send force: true." }, request, 502);
    if (!funds.empty) {
      return json({ ...out, error: "withdraw_first", balances: funds.balances, openPositions: funds.open,
        hint: "Close positions and withdraw first (/proxy/bankr-withdraw needs this key). Nothing was removed." }, request, 409);
    }
  }

  const removed = await signed("POST", "/v1/client/remove_orderly_key", { orderly_key: orderlyKey });
  if (!removed || removed.success !== true) {
    return json({ ...out, error: "orderly_refused", code: removed?.code ?? null, message: removed?.message ?? null,
      hint: "Orderly didn't remove the key. If it refuses a key removing itself, remove it with another key on this account (e.g. from the web app)." }, request, 502);
  }
  const after = keyPresent(await lookup());
  return json({ ...out, ok: after === false, status: after === false ? "removed" : after === true ? "still_active" : "removed_unconfirmed" }, request);
}
