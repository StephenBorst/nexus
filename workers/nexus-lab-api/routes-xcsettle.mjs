// ── GET /xc/settlement?depositAddress=0x… — did a 1Click swap really settle? ─────────────────────
// Read-only. Fetches 1Click's status for the deposit address, takes the SIGNED quote it echoes
// (re-verified against the pinned key, and required to be for this exact deposit address), then
// reads every transaction the status points at from its own chain and judges the delivery (or the
// refund) against the floor 1Click signed. Rules: app/lib/nearSettlement.mjs (tested).
// The card (CrossChainCard.tsx) calls it once 1Click reports SUCCESS / REFUNDED and shows the
// verdict, and also compares the verdict's recipient with the one it sent to.
// Nothing is signed, sent or stored. No Origin gate (it runs from curl too), its own per-IP budget.
import { makeRateLimiter } from "./keyProxy.mjs";
import { checkSettlement } from "../../app/lib/nearSettlement.mjs";
import { ONE_CLICK_API } from "../../app/lib/nearIntents.mjs";
import { json } from "./shared.mjs";

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
export const XC_RPCS = {
  arb: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
  base: ["https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://base.llamarpc.com"],
  eth: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
};
// Same upstream order as POST /sol/rpc (index.js solRpcServer).
const solUpstreams = (env) => [env.SOLANA_RPC, "https://solana-rpc.publicnode.com", "https://rpc.ankr.com/solana", "https://solana.drpc.org", "https://api.mainnet-beta.solana.com"].filter(Boolean);
export const BTC_APIS = ["https://mempool.space/api", "https://blockstream.info/api"];

const limiter = makeRateLimiter({ limit: 30, windowMs: 60_000 });

// JSON-RPC over a fallback list. The first non-null result wins (a lagging node may not have the
// tx yet); null only if every node that answered said null; throws if none answered.
export function rpcCaller(urls, fetchImpl) {
  return async (method, params) => {
    let answered = false;
    for (const url of urls) {
      try {
        const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        if (!r.ok) continue;
        const j = await r.json();
        if (!j || j.error || !("result" in j)) continue;
        answered = true;
        if (j.result != null) return j.result;
      } catch { /* next */ }
    }
    if (answered) return null;
    throw new Error(`${method}: no RPC answered`);
  };
}

export function restCaller(bases, fetchImpl) {
  return async (path) => {
    for (const base of bases) {
      try {
        const r = await fetchImpl(base + path);
        if (r.status === 404) continue;
        if (!r.ok) continue;
        return await r.json();
      } catch { /* next */ }
    }
    throw new Error(`${path}: no API answered`);
  };
}

export async function handleXcSettlement(parts, request, env, { fetchImpl = fetch, overLimit = limiter } = {}) {
  if (!(parts[0] === "xc" && parts[1] === "settlement")) return null;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, request, 405);
  const depositAddress = new URL(request.url).searchParams.get("depositAddress") || "";
  if (parts.length !== 2 || !EVM_ADDR.test(depositAddress))
    return json({ error: "bad_request", hint: "GET /xc/settlement?depositAddress=<0x deposit address from the quote>" }, request, 400);
  if (overLimit(request.headers.get("cf-connecting-ip") || "unknown")) return json({ error: "rate_limited", retryAfterSec: 60 }, request, 429);

  let status;
  try {
    const r = await fetchImpl(`${ONE_CLICK_API}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);
    if (r.status === 404) return json({ error: "unknown_deposit_address" }, request, 404);
    if (!r.ok) return json({ verdict: "UNREAD", final: false, reason: `1Click status HTTP ${r.status}` }, request);
    status = await r.json();
  } catch (e) {
    return json({ verdict: "UNREAD", final: false, reason: `1Click status unreachable: ${String(e?.message || e).slice(0, 80)}` }, request);
  }
  if (!status?.quoteResponse) return json({ verdict: "UNREAD", final: false, reason: "the status carries no signed quote" }, request);

  const callers = {
    evm: Object.fromEntries(Object.entries(XC_RPCS).map(([c, urls]) => [c, rpcCaller(urls, fetchImpl)])),
    sol: rpcCaller(solUpstreams(env), fetchImpl),
    btc: restCaller(BTC_APIS, fetchImpl),
  };
  const result = await checkSettlement(status.quoteResponse, status, { callers, depositAddress });
  return json({ depositAddress, ...result }, request);
}
