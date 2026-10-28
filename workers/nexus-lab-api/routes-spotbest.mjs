// ── GET /spot/best?chain=<id>&tokenOut=0x…&amount=<USDC base units> — which router gives more? ────
// For an EVM USDC buy: spanDEX's quote (spotQuote, preview, our fee on) and Flash's market quote (our
// key + our fee, no funder), compared on each router's own "you receive" estimate (app/lib/spotBest.mjs).
// The token's decimals come from the chain. Read-only: nothing is signed or placed. Cached 20 s per
// (chain, token, amount) in the isolate; origin-gated + a per-IP budget like the other key proxies.
import { spotQuote } from "./spotQuote.mjs";
import { withFlashFee } from "./keyProxy.mjs";
import { pickBest } from "../../app/lib/spotBest.mjs";
import { json } from "./shared.mjs";

export const BEST_CHAINS = {
  8453: { flash: "base", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", rpc: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"] },
  42161: { flash: "arbitrum", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", rpc: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"] },
  1: { flash: "ethereum", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", rpc: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"] },
  10: { flash: "optimism", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", rpc: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"] },
  137: { flash: "polygon", usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", rpc: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"] },
};
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const CACHE_MS = 20_000;
const cache = new Map();

async function readDecimals(c, token, fetchImpl) {
  for (const u of c.rpc) {
    try {
      const r = await fetchImpl(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: token, data: "0x313ce567" }, "latest"] }) });
      const j = await r.json();
      if (typeof j?.result === "string" && /^0x[0-9a-fA-F]+$/.test(j.result)) {
        const d = Number(BigInt(j.result));
        if (Number.isInteger(d) && d >= 0 && d <= 36) return d;
      }
    } catch { /* next */ }
  }
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

export async function handleSpotBest(parts, request, env, { fetchImpl = fetch, gate = () => null, now = Date.now(), spot = spotQuote } = {}) {
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

  const [sq, flashOut, decimals] = await Promise.all([
    spot(env, new URLSearchParams({ chain: String(chainId), tokenIn: c.usdc, tokenOut, amount })).catch(() => null),
    flashMarketOut(env, c, tokenOut, amount, fetchImpl),
    readDecimals(c, tokenOut, fetchImpl),
  ]);
  const r = pickBest({ spandexRaw: sq?.ok ? sq.outAmount : null, flashHuman: flashOut, decimals });
  const body = {
    ok: r.best != null, chainId, decimals, ...r,
    note: "Each router's own estimate of what you receive after its fees. Flash's includes network gas; with spanDEX your wallet pays gas separately.",
  };
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: now, body });
  return json(body, request);
}
