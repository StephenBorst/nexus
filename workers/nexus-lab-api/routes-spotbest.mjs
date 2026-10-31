// ── GET /spot/best?chain=<id>&tokenOut=0x…&amount=<USDC base units> — which router gives more? ────
// For an EVM USDC buy: spanDEX's quote (spotQuote, preview, our fee on) and Flash's market quote (our
// key + our fee, no funder), compared on each router's own "you receive" estimate (app/lib/spotBest.mjs).
// The token's decimals come from the chain. Read-only: nothing is signed or placed. Cached 20 s per
// (chain, token, amount) in the isolate; origin-gated + a per-IP budget like the other key proxies.
// Gas: Flash prices its own gas into `to.amount`; with spanDEX the wallet pays it. So we estimate the
// spanDEX swap's gas (live eth_gasPrice × SWAP_GAS_UNITS, + the OP-stack L1 data fee upper bound on
// Base/Optimism, priced in ETH from Orderly's ETH mark) and turn it into the bought token at the
// quote's own rate. The approval tx isn't counted: both routers need one. Unreadable → no estimate,
// and the line says so (never a guessed zero).
import { spotQuote } from "./spotQuote.mjs";
import { withFlashFee } from "./keyProxy.mjs";
import { pickBest } from "../../app/lib/spotBest.mjs";
import { json } from "./shared.mjs";
import { orderlyGet } from "./orderlyGet.mjs";

// native = the gas token we can price ("ETH" from Orderly's mark; Polygon's POL isn't priced → no estimate).
// opStack = the chain charges an L1 data fee, read from its GasPriceOracle.
export const BEST_CHAINS = {
  8453: { flash: "base", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", rpc: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"], native: "ETH", opStack: true },
  42161: { flash: "arbitrum", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", rpc: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"], native: "ETH" },
  1: { flash: "ethereum", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", rpc: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"], native: "ETH" },
  10: { flash: "optimism", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", rpc: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"], native: "ETH", opStack: true },
  137: { flash: "polygon", usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", rpc: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"], native: null },
};
// A typical aggregator swap's gas use (single-hop Nordstern/0x swaps run ~120–200k; routed ones more).
export const SWAP_GAS_UNITS = 200_000n;
// Upper-bound size of a signed swap tx for the OP-stack L1 fee (aggregator calldata ≈ 0.5–1 KB).
export const SWAP_TX_BYTES = 1200;
const GAS_ORACLE = "0x420000000000000000000000000000000000000F";
const L1_FEE_UPPER_BOUND = "0xf1c7a58b"; // getL1FeeUpperBound(uint256)
const ETH_MARK_URL = "https://api-evm.orderly.org/v1/public/futures/PERP_ETH_USDC";
const ETH_CACHE_MS = 60_000;
let ethMark = null;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const CACHE_MS = 20_000;
const cache = new Map();

// One JSON-RPC read, each RPC in turn; a hex `result` or null.
async function rpcHex(c, method, params, fetchImpl) {
  for (const u of c.rpc) {
    try {
      const r = await fetchImpl(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await r.json();
      if (typeof j?.result === "string" && /^0x[0-9a-fA-F]+$/.test(j.result)) return j.result;
    } catch { /* next */ }
  }
  return null;
}

async function readDecimals(c, token, fetchImpl) {
  const h = await rpcHex(c, "eth_call", [{ to: token, data: "0x313ce567" }, "latest"], fetchImpl);
  if (h == null) return null;
  const d = Number(BigInt(h));
  return Number.isInteger(d) && d >= 0 && d <= 36 ? d : null;
}

/** The spanDEX swap's network cost in wei of the native token, or null if any part is unreadable. */
export async function swapGasWei(c, fetchImpl) {
  const [gp, l1] = await Promise.all([
    rpcHex(c, "eth_gasPrice", [], fetchImpl),
    c.opStack ? rpcHex(c, "eth_call", [{ to: GAS_ORACLE, data: L1_FEE_UPPER_BOUND + SWAP_TX_BYTES.toString(16).padStart(64, "0") }, "latest"], fetchImpl) : Promise.resolve("0x0"),
  ]);
  if (gp == null || l1 == null) return null;
  return BigInt(gp) * SWAP_GAS_UNITS + BigInt(l1);
}

async function readEthUsd(fetchImpl, now) {
  if (ethMark && now - ethMark.at < ETH_CACHE_MS) return ethMark.px;
  try {
    const j = await orderlyGet(ETH_MARK_URL, { fetchImpl, tries: 2 });
    const px = Number(j?.data?.mark_price);
    if (Number.isFinite(px) && px > 0) { ethMark = { at: now, px }; return px; }
  } catch { /* no estimate */ }
  return null;
}

async function flashMarketOut(env, c, tokenOut, amountRaw, fetchImpl) {
  const key = env.FLASH_API_KEY || "";
  if (!key) return null;
  const qty = (Number(amountRaw) / 1e6).toString(); // USDC, 6 decimals on every chain here
  const body = withFlashFee(JSON.stringify({ targetChain: c.flash, contraChain: c.flash, targetAsset: tokenOut, contraAsset: c.usdc, side: "buy", qty, orderType: "market", maxSlippage: "0.02" }), env);
  try {
    const r = await fetchImpl("https://flash.definitive.fi/v1/quote", { method: "POST", headers: { "content-type": "application/json", "x-definitive-api-key": key }, body });
    if (!r.ok) return null;
    const q = await r.json();
    return q?.to?.asset === "target" && q?.to?.amount ? String(q.to.amount) : null;
  } catch { return null; }
}

export async function handleSpotBest(parts, request, env, { fetchImpl = fetch, gate = () => null, now = Date.now(), spot = spotQuote, ethUsd: ethUsd_ = readEthUsd } = {}) {
  if (!(parts[0] === "spot" && parts[1] === "best" && parts.length === 2)) return null;
  if (request.method !== "GET") return json({ error: "method not allowed" }, request, 405);
  const gated = gate(request); if (gated) return gated;
  const sp = new URL(request.url).searchParams;
  const chainId = Number(sp.get("chain"));
  const c = BEST_CHAINS[chainId];
  const tokenOut = sp.get("tokenOut") || "";
  const amount = sp.get("amount") || "";
  if (!c || !ADDR.test(tokenOut) || !/^[1-9]\d{0,14}$/.test(amount) || tokenOut.toLowerCase() === c.usdc.toLowerCase())
    return json({ ok: false, error: "bad_params" }, request, 400);
  const key = `${chainId}:${tokenOut.toLowerCase()}:${amount}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return json(hit.body, request);

  const [sq, flashOut, decimals, gasWei, ethUsd] = await Promise.all([
    spot(env, new URLSearchParams({ chain: String(chainId), tokenIn: c.usdc, tokenOut, amount })).catch(() => null),
    flashMarketOut(env, c, tokenOut, amount, fetchImpl),
    readDecimals(c, tokenOut, fetchImpl),
    c.native === "ETH" ? swapGasWei(c, fetchImpl) : Promise.resolve(null),
    c.native === "ETH" ? ethUsd_(fetchImpl, now) : Promise.resolve(null),
  ]);
  const spandexRaw = sq?.ok ? sq.outAmount : null;
  // gas in USD, then in the bought token at the spanDEX quote's own rate (input is USDC ≈ $1).
  const gasUsd = gasWei != null && ethUsd != null ? (Number(gasWei) / 1e18) * ethUsd : null;
  const plain = pickBest({ spandexRaw, flashHuman: flashOut, decimals });
  const tokenPerUsd = plain.spandex != null ? plain.spandex / (Number(amount) / 1e6) : null;
  const gasToken = gasUsd != null && tokenPerUsd != null ? gasUsd * tokenPerUsd : null;
  const r = pickBest({ spandexRaw, flashHuman: flashOut, decimals, gasToken });
  const body = {
    ok: r.best != null, chainId, decimals, ...r,
    gasUsd: gasUsd != null ? Math.round(gasUsd * 1e6) / 1e6 : null,
    note: r.gasIncluded
      ? `Each router's own estimate of what you receive after its fees, both after network gas: Flash prices its gas in; for spanDEX we took off an estimate (live gas price × ${SWAP_GAS_UNITS} gas${c.opStack ? " + the L1 data fee" : ""}). The approval transaction isn't counted (both routers need one).`
      : "Each router's own estimate of what you receive after its fees. Flash's includes network gas; with spanDEX your wallet pays gas separately (not estimated here).",
  };
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: now, body });
  return json(body, request);
}
