// ── Orderly account setup: what we store about a wallet's trading key ─────────────────────────
// Moved out of index.js (2026-10-17). POST /proxy/register-key stored the record `user:{addr}`
// ({ accountId, orderlyKey, registeredAt }) when Orderly answered `success || data`, with the key
// taken from a body field Orderly never sees. Now: only on `success === true`, the key Orderly
// actually registered (message.orderlyKey), for the address Orderly checked the signature against
// (userAddress). Orderly verifies that signature, so this is hardening, not a hole someone could
// use to rewrite another wallet's record.
import { json } from "./shared.mjs";

const ORDERLY = "https://api-evm.orderly.org";
const BROKER = "nexus_trading";
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const KEY_RE = /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,64}$/;

const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

/**
 * Which record does a register-key request get to write, if Orderly accepts it?
 * { ok, wallet, orderlyKey } or { ok:false, error }. Checked BEFORE the request goes to Orderly.
 */
export function registerKeyTarget(body) {
  const wallet = typeof body?.userAddress === "string" ? body.userAddress.trim() : "";
  if (!EVM_RE.test(wallet)) return { ok: false, error: "userAddress required" };
  const key = body?.message?.orderlyKey;
  if (typeof key !== "string" || !KEY_RE.test(key)) return { ok: false, error: "message.orderlyKey required" };
  // The app also sends the key at the top level; if it does, it must be the one being registered.
  if (body.orderlyKey !== undefined && body.orderlyKey !== key) return { ok: false, error: "orderlyKey does not match message.orderlyKey" };
  return { ok: true, wallet: wallet.toLowerCase(), orderlyKey: key };
}

export async function handleAccount(parts, request, env, { fetch: f = fetch } = {}) {
  // POST /proxy/register-key — forward a browser-signed AddOrderlyKey to Orderly; store the result.
  if (parts[0] === "proxy" && parts[1] === "register-key" && parts.length === 2 && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid json" }, request, 400); }
    const target = registerKeyTarget(body);
    if (!target.ok) return json({ error: target.error }, request, 400);
    try {
      let accountId = null;
      try {
        const ar = await f(`${ORDERLY}/v1/get_account?address=${target.wallet}&broker_id=${BROKER}`);
        accountId = (await ar.json())?.data?.account_id ?? null;
      } catch { /* best-effort */ }
      const rh = { "Content-Type": "application/json" };
      if (accountId) rh["X-Account-Id"] = accountId;
      const r = await f(`${ORDERLY}/v1/orderly_key`, { method: "POST", headers: rh, body: JSON.stringify(body) });
      const d = await r.json();
      if (!accountId) accountId = d?.data?.account_id ?? null;
      if (d?.success === true && accountId) {
        await env.LAB_STORE.put("user:" + target.wallet, JSON.stringify({
          accountId, orderlyKey: target.orderlyKey, registeredAt: Date.now(),
        }));
      }
      return new Response(JSON.stringify({ ...d, accountId }), { status: 200, headers: cors });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
    }
  }
  return null;
}
