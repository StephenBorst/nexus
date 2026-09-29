// ── EVM spot quotes via spanDEX (replaces Fabric, which shut down Sept 16 2026) ──────────
// /swap/quote asks spanDEX's providers for a quote and returns the SAME normalized shape the
// Fabric route returned, so the Spot terminal's guards (swapExec.ts planBuy) keep working:
// approve token = the input token we chose, approve amount = exactly our spend, tx value = 0 on
// an ERC-20 input. Providers: Nordstern (no key) always; 0x only when the ZEROX_API_KEY secret
// is set (the key stays in the worker, like FABRIC_APP_ID did). Fees are native spanDEX options
// (integratorFeeAddress + integratorSwapFeeBps), carried on the SPOT_FEE_* vars.
//
// Nothing here signs. A quote that fails any check is dropped, and no usable quote returns
// ok:false, so the client falls back to the named Uniswap link as before.
import { createConfig, getRawQuotes, nordstern, ZeroXAggregator } from "@spandex/core";

export const SPOT_FEE_MAX_BPS = 100;
const ADDR = /^0x[a-fA-F0-9]{40}$/;
// spanDEX needs a swapper on every request. A preview (no wallet yet) quotes for this burn
// address: the calldata is never returned for signing without a real taker.
export const PREVIEW_SWAPPER = "0x000000000000000000000000000000000000dEaD";

// Our fee, or null when it's off (both vars must be valid).
export function spotFee(env) {
  const bps = parseInt(env?.SPOT_FEE_BPS || "", 10);
  const recipient = env?.SPOT_FEE_RECIPIENT || "";
  if (!Number.isInteger(bps) || bps <= 0 || bps > SPOT_FEE_MAX_BPS || !ADDR.test(recipient)) return null;
  return { bps, recipient };
}

// 0x answers "no liquidity" as HTTP 200 {liquidityAvailable:false} with no `route`, and
// @spandex/core 0.11.1 then crashes on quote.route.tokens. Turn that answer into a clean
// failure (with 0x's body as the detail) before the SDK parses it.
export class SafeZeroX extends ZeroXAggregator {
  async makeRequest(request, options) {
    const body = await super.makeRequest(request, options);
    if (body?.liquidityAvailable === false || !body?.route || !body?.transaction) {
      const err = new Error("0x: no liquidity for this pair and size");
      err.details = body;
      throw err;
    }
    return body;
  }
}

export function spotProviders(env) {
  const list = [nordstern({})];
  if (env?.ZEROX_API_KEY) list.push(new SafeZeroX({ apiKey: env.ZEROX_API_KEY }));
  return list;
}

export function spotConfig(env, { withFee = true } = {}) {
  const fee = withFee ? spotFee(env) : null;
  const options = { deadlineMs: 8000, numRetries: 0 };
  if (fee) { options.integratorFeeAddress = fee.recipient; options.integratorSwapFeeBps = fee.bps; }
  return createConfig({ providers: spotProviders(env), options });
}

// Parse + validate the query. Returns { error } or the swap request spanDEX takes.
export function parseSpotRequest(sp) {
  const chainId = parseInt(sp.get("chain") || "", 10);
  const tokenIn = sp.get("tokenIn") || "";
  const tokenOut = sp.get("tokenOut") || "";
  const amountStr = sp.get("amount") || "";
  const taker = sp.get("taker") || "";
  if (!Number.isInteger(chainId) || chainId <= 0 || !ADDR.test(tokenIn) || !ADDR.test(tokenOut) || !/^[1-9]\d{0,40}$/.test(amountStr)) {
    return { error: "bad_params" };
  }
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) return { error: "bad_params" };
  const s = parseInt(sp.get("slippageBps") || "", 10);
  const slippageBps = Number.isInteger(s) && s > 0 && s <= 5000 ? s : 100;
  const executable = ADDR.test(taker);
  return {
    executable,
    swap: {
      chainId, inputToken: tokenIn, outputToken: tokenOut, mode: "exactIn",
      inputAmount: BigInt(amountStr), slippageBps,
      swapperAccount: executable ? taker : PREVIEW_SWAPPER,
    },
  };
}

// The slippage floor, when the provider states one. Never computed by us: a number we made up
// would show in the confirm modal as if the router enforced it.
function statedMinOut(q) {
  const d = q?.details || {};
  const v = d.minBuyAmount ?? d.minAmountOut ?? d.toAmountMin ?? d.minToAmount ?? d.minOutputAmount ?? null;
  try { return v != null && BigInt(v) > 0n ? BigInt(v) : null; } catch { return null; }
}

// Did the provider's response confirm our fee? 0x echoes fees.integratorFee; Nordstern's echo
// field isn't documented, so read any fee-named field that carries a positive amount.
export function feeEcho(q) {
  const d = q?.details || {};
  if (q?.provider === "0x") {
    const f = d.fees?.integratorFee;
    return f && BigInt(f.amount || "0") > 0n ? { amount: String(f.amount), token: f.token ?? null } : null;
  }
  for (const [k, v] of Object.entries(d)) {
    if (!/fee/i.test(k) || v == null) continue;
    if (typeof v === "object") {
      const amt = v.amount ?? v.value ?? null;
      if (amt != null && Number(amt) > 0) return { field: k, amount: String(amt), token: v.token ?? null };
    } else if (Number(v) > 0) {
      return { field: k, amount: String(v) };
    }
  }
  return null;
}

// Keep only quotes we'd let a wallet sign, then take the best output.
export function pickSpotQuote(quotes, swap) {
  const inTok = swap.inputToken.toLowerCase();
  const usable = (quotes || []).filter((q) => {
    if (!q?.success) return false;
    if (q.inputAmount !== swap.inputAmount) return false;               // spends exactly what we asked
    if (typeof q.outputAmount !== "bigint" || q.outputAmount <= 0n) return false;
    const tx = q.txData;
    if (!tx || !ADDR.test(tx.to || "") || !/^0x[0-9a-fA-F]*$/.test(tx.data || "")) return false;
    if ((tx.value ?? 0n) !== 0n) return false;                          // ERC-20 in: no native value
    const ap = q.approval;
    if (!ap || !ADDR.test(ap.spender || "") || String(ap.token).toLowerCase() !== inTok) return false;
    return true;
  });
  usable.sort((a, b) => (b.outputAmount > a.outputAmount ? 1 : b.outputAmount < a.outputAmount ? -1 : 0));
  return usable[0] || null;
}

const PROVIDER_NAME = { nordstern: "Nordstern", "0x": "0x" };

// The response the client reads (same field names the Fabric route used).
export function normalizeSpotQuote(q, swap, { fee, executable, failures = [] }) {
  const echo = fee ? feeEcho(q) : null;
  // Nordstern's echo is just our percent repeated back, so it also has to name our recipient
  // INSIDE the swap calldata (live-checked Sept 29 with a taker ≠ the recipient: it does).
  const inCalldata = !!(fee && String(q.txData?.data || "").toLowerCase().includes(fee.recipient.slice(2).toLowerCase()));
  const feeApplied = !!(fee && q.activatedFeatures?.includes("integratorFees") && echo && (q.provider !== "nordstern" || inCalldata));
  return {
    available: true,
    ok: true,
    router: "spanDEX",
    provider: PROVIDER_NAME[q.provider] || q.provider,
    outAmount: q.outputAmount.toString(),
    priceImpact: null,
    approval: { token: swap.inputToken, amount: swap.inputAmount.toString(), spender: q.approval.spender },
    tx: executable ? { to: q.txData.to, data: q.txData.data, value: "0" } : null,
    minOut: statedMinOut(q)?.toString() ?? null,
    feeBps: feeApplied ? fee.bps : 0,
    feeApplied,
    feeConfigured: !!fee,
    feeEcho: echo,
    failures,
  };
}

// Fetch → pick → normalize. `deps` lets tests swap the network call.
export async function spotQuote(env, sp, deps = {}) {
  const req = parseSpotRequest(sp);
  if (req.error) return { available: true, ok: false, reason: req.error };
  const fee = spotFee(env);
  const fetchQuotes = deps.getRawQuotes || getRawQuotes;
  const run = async (withFee) => fetchQuotes({ config: spotConfig(env, { withFee }), swap: req.swap });
  let quotes = await run(true);
  let best = pickSpotQuote(quotes, req.swap);
  let feeUsed = fee;
  // A provider that refuses the fee still leaves the swap usable: retry once without it.
  if (!best && fee) { quotes = await run(false); best = pickSpotQuote(quotes, req.swap); feeUsed = null; }
  // The provider's own reply rides along (trimmed): it says WHY, and holds no secret of ours.
  const failures = (quotes || []).filter((q) => !q?.success).map((q) => {
    const d = q?.error?.details;
    const detail = d == null ? undefined : (typeof d === "string" ? d : JSON.stringify(d)).slice(0, 300);
    return { provider: q?.provider, error: String(q?.error?.message || q?.error || "").slice(0, 160), ...(detail ? { detail } : {}) };
  });
  if (!best) return { available: true, ok: false, reason: "no_route", failures };
  const out = normalizeSpotQuote(best, req.swap, { fee: feeUsed, executable: req.executable, failures });
  out.feeConfigured = !!fee; // true even when the fee was refused and we fell back to a clean quote
  return out;
}
