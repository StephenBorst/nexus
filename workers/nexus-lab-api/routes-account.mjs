// ── Orderly account setup: what we store about a wallet's trading key ─────────────────────────
// Moved out of index.js (2026-10-17). POST /proxy/register-key stored the record `user:{addr}`
// ({ accountId, orderlyKey, registeredAt }) when Orderly answered `success || data`, with the key
// taken from a body field Orderly never sees. Now: only on `success === true`, the key Orderly
// actually registered (message.orderlyKey), for the address Orderly checked the signature against
// (userAddress). Orderly verifies that signature, so this is hardening, not a hole someone could
// use to rewrite another wallet's record.
//
// GET /account-snapshot?wallet= (retired 2026-10-26, borst) returned ANY registered wallet's Orderly
// positions and open orders with no signature, by signing with a seed cached in that record. It now
// answers 410 and reads nothing; nothing stores a seed and the cron removes the ones stored
// (seedVault.mjs scrubStoredSeeds). Same data, signed: POST /positions, POST /order-history.
// Its caller was Bankr's Nexus Trade Tracker page; the replacement read path is docs/bankr-tracker-spec.md.
import { json } from "./shared.mjs";
import { SCRUB_STATE_KEY } from "./seedVault.mjs";

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

/**
 * POST /order-history's answer, from Orderly's reply to GET /v1/orders. It used to map
 * `data.rows ?? []`, so a refused read (bad key, rate limit, a challenge page) came back as
 * `{ count: 0, orders: [] }`: an empty book that wasn't. Now only `success === true` with a rows
 * array is a list; anything else is a 502 naming what Orderly said. Returns { status, body }.
 */
export function orderHistoryResult(upstreamStatus, text, now = Date.now()) {
  let d = null;
  try { d = JSON.parse(text); } catch { d = null; }
  if (d?.success === true && Array.isArray(d?.data?.rows)) {
    const orders = d.data.rows.map((o) => ({
      orderId: o.order_id, symbol: o.symbol, side: o.side, type: o.type,
      status: o.status, price: o.price, quantity: o.quantity,
      executedQty: o.executed, avgPrice: o.average_executed_price,
      fee: o.total_fee, feeCurrency: o.fee_asset,
      createdAt: o.created_time, updatedAt: o.updated_time,
    }));
    return { status: 200, body: { ok: true, count: orders.length, orders, fetchedAt: now } };
  }
  return {
    status: 502,
    body: {
      ok: false,
      error: "orderly_error",
      upstreamStatus,
      code: d?.code ?? null,
      message: d ? (typeof d.message === "string" ? d.message.slice(0, 200) : null) : "Orderly did not answer with JSON",
      hint: "Orders were not read. Nothing here means the account has no orders.",
    },
  };
}

export async function handleAccount(parts, request, env, { fetch: f = fetch } = {}) {
  // GET /account-snapshot: retired. One log line per call so a caller we missed shows up (no wallet).
  if (parts[0] === "account-snapshot" && parts.length === 1) {
    console.warn(`[account-snapshot] retired route called · ua=${(request.headers.get("User-Agent") || "-").slice(0, 120)}`);
    return json({
      error: "gone",
      hint: "Retired: it answered without a signature. Positions: GET /smart/xray?address= (public). Positions and orders, signed: POST /positions or POST /order-history with { walletAddress, walletSig }.",
    }, request, 410);
  }

  // GET /ops/seed-scrub: progress of removing stored seeds. Counts only.
  if (parts[0] === "ops" && parts[1] === "seed-scrub" && parts.length === 2 && request.method === "GET") {
    let st = {};
    try { st = JSON.parse((await env.LAB_STORE.get(SCRUB_STATE_KEY)) || "{}"); } catch { st = {}; }
    return json({ done: !!st.done, passes: st.passes || 0, scanned: st.scanned || 0, scrubbed: st.scrubbed || 0, startedAt: st.startedAt || null, doneAt: st.doneAt || null }, request);
  }

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
