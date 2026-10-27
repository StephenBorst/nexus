// ── GET /flash/settlement[/:orderId]?funderAddress=0x… — did a settled Flash order pay us? ─────────
// Without an order id it checks the wallet's newest FILLED order.
// Read-only. Reads the order + its fills from Flash with our key (the same GET the Spot ticket's
// status poll uses), then each fill's settlement tx from a public Base RPC, and grades:
//   fee  = our integrator fee (FLASH_FEE_BPS) asked on the order AND paid on each fill
//   code = our Base builder code (FLASH_ATTRIBUTION_CODE) at the end of each settlement tx's calldata
// Rules: app/lib/flashSettlement.mjs (tested). Nothing is signed, sent or stored.
// No Origin gate (so the check runs from curl), its own small per-IP budget instead. Flash order
// ids are random UUIDs and the reply carries only that order's own fills.
import { flashFeeBps, flashAttributionCode, makeRateLimiter } from "./keyProxy.mjs";
import { settlementReport } from "../../app/lib/flashSettlement.mjs";
import { json } from "./shared.mjs";

const FLASH_V1 = "https://flash.definitive.fi/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
export const BASE_RPCS = ["https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://base.llamarpc.com"];
const MAX_FILLS_READ = 10;

const limiter = makeRateLimiter({ limit: 10, windowMs: 60_000 });

async function readBaseTx(hash, fetchImpl) {
  for (const rpc of BASE_RPCS) {
    try {
      const r = await fetchImpl(rpc, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [hash] }),
      });
      const j = await r.json();
      if (j && j.result && typeof j.result.input === "string") return { input: j.result.input, to: j.result.to ?? null };
    } catch { /* next RPC */ }
  }
  return null;
}

export async function handleFlashSettlement(parts, request, env, { fetchImpl = fetch, overLimit = limiter } = {}) {
  if (!(parts[0] === "flash" && parts[1] === "settlement")) return null;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, request, 405);
  let id = parts[2] || "";
  const funder = new URL(request.url).searchParams.get("funderAddress") || "";
  if (parts.length > 3 || (parts.length === 3 && !UUID.test(id)) || !EVM_ADDR.test(funder))
    return json({ error: "bad_request", hint: "GET /flash/settlement[/<order uuid>]?funderAddress=<0x wallet that placed it>" }, request, 400);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (overLimit(ip)) return json({ error: "rate_limited" }, request, 429);
  const key = env.FLASH_API_KEY || "";
  if (!key) return json({ error: "flash_not_configured" }, request, 503);

  if (!id) {
    // Newest filled order for this wallet.
    try {
      const r = await fetchImpl(`${FLASH_V1}/orders?funderAddress=${funder}&statuses=ORDER_STATUS_FILLED&pageSize=50`, { headers: { "x-definitive-api-key": key } });
      if (!r.ok) return json({ error: "flash_read_failed", status: r.status }, request, 502);
      const orders = (await r.json())?.orders || [];
      const t = (o) => Date.parse(o?.closedAt || o?.acceptedAt || o?.placedAt || "") || 0;
      const newest = orders.filter((o) => UUID.test(String(o?.orderId || ""))).sort((a, b) => t(b) - t(a))[0];
      if (!newest) return json({ error: "no_filled_orders", hint: "This wallet has no filled Flash order yet." }, request, 404);
      id = newest.orderId;
    } catch (e) {
      return json({ error: "flash_read_failed", detail: String(e?.message || e).slice(0, 120) }, request, 502);
    }
  }
  let body;
  try {
    const r = await fetchImpl(`${FLASH_V1}/orders/${id}?funderAddress=${funder}`, { headers: { "x-definitive-api-key": key } });
    if (r.status === 404) return json({ error: "order_not_found", hint: "Check the id and the wallet that placed it." }, request, 404);
    if (!r.ok) return json({ error: "flash_read_failed", status: r.status }, request, 502);
    body = await r.json();
  } catch (e) {
    return json({ error: "flash_read_failed", detail: String(e?.message || e).slice(0, 120) }, request, 502);
  }
  const order = body?.order || null;
  const fills = Array.isArray(body?.fills) ? body.fills : [];
  if (!order) return json({ error: "flash_read_failed", detail: "no order in reply" }, request, 502);

  const txByHash = {};
  const hashes = [...new Set(fills.map((f) => f?.transactionId).filter((h) => typeof h === "string" && TX_HASH.test(h)))].slice(0, MAX_FILLS_READ);
  for (const h of hashes) txByHash[h] = await readBaseTx(h, fetchImpl);

  const report = settlementReport({ order, fills, txByHash, expectFeeBps: flashFeeBps(env), expectCode: flashAttributionCode(env) });
  return json({
    ok: true, ...report,
    note: "fee: our integrator fee asked on the order and paid on each fill (Flash's own record). code: our Base builder code at the end of each settlement tx's calldata (ERC-8021), read from a public Base RPC. Read-only.",
  }, request);
}
