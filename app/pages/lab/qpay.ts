// ── x402 client-pays (Base USDC) — the ONE place Q Signals asks the wallet to pay ────
// Quotient's /signals is an x402-payable endpoint: no payment → HTTP 402 + a payment
// challenge; pay → the data. We make the USER'S wallet pay (not Nexus, not our credits):
// the wallet signs ONE EIP-3009 `TransferWithAuthorization` — an OFF-CHAIN, gasless
// authorization for EXACTLY the challenge amount of USDC on Base to Quotient. Quotient's
// facilitator submits it; nothing is sent from here, so no chain switch, no gas.
//
// This is hand-rolled (no dep) and was proven BYTE-FOR-BYTE identical to the reference
// `x402` library — same EIP-712 signature, same encoded X-PAYMENT header — so we carry
// none of that library's bundle (it statically pulls the whole Solana stack for EVM use).
//
// The guards are the whole point of the risk posture: BEFORE any wallet prompt we PIN the
// network (Base), the asset (native USDC), the scheme (exact) and the recipient (Quotient),
// and we CAP the amount. A hostile or drifted 402 can authorize at most X402_MAX_UNITS —
// it can never widen the spend or redirect the funds. The signed authorization names an
// exact value to an exact payTo, so the blast radius is that one micro-payment and nothing
// lingers (no allowance, no standing approval).

// EIP-1193 provider — same shape swapExec uses (Orderly's connector exposes wallet.provider).
export type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

const BASE_CHAIN_ID = 8453;
// Native (Circle) USDC on Base — the ONLY asset we'll authorize. 6 decimals.
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// Base USDC's EIP-712 domain (FiatTokenV2). HARDCODED, not read from the challenge, so the
// signed data is fully determined by OUR constants — a hostile 402 can influence nothing in
// the domain. (Verified against the reference lib: this pair produces the exact signature.)
const USDC_DOMAIN = { name: "USD Coin", version: "2" };
// Quotient's payment receiver (verified from the live 402). Soft-pinned: a mismatch fails
// LOUD rather than paying a stranger. If Quotient rotates it, we bump this one constant.
const QUOTIENT_PAYTO = "0xC3d01FD2F79d4c57aD106AB8ecc12a5dE24F97cB";
// Hard ceiling on what a single pull may authorize: $0.05 (50,000 units, 6dp). One pull is
// $0.01 today; the headroom absorbs a Quotient price tweak without a code change, while
// still capping any hostile challenge at a nickel — a drain is structurally impossible.
export const X402_MAX_UNITS = 50000n;
export const USDC_DECIMALS = 6;

const isAddr = (a: unknown): a is string => typeof a === "string" && /^0x[a-fA-F0-9]{40}$/.test(a);

// One entry of the 402 `accepts[]` (x402 payment requirements) — only the fields we read.
export interface PaymentReq {
  scheme?: string;
  network?: string;
  maxAmountRequired?: string | number;
  payTo?: string;
  asset?: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string } | null;
}

// A guarded, ready-to-sign requirement + the human amount to show before the wallet prompt.
export interface GuardedReq { req: Required<Pick<PaymentReq, "scheme" | "network" | "payTo" | "asset">> & PaymentReq; amountUnits: bigint; usd: number; }

// Base is named "base" (Coinbase x402) OR CAIP-2 "eip155:8453" / "8453"; the asset can be a bare
// address or CAIP-19 ("eip155:8453/erc20:0x…"). So we match the network against the known Base
// identifiers and the asset by CONTAINMENT of our pinned USDC address. The loosening only affects
// WHICH offer we accept — we still SIGN against our canonical BASE_USDC / QUOTIENT_PAYTO / chainId
// 8453 (buildTypedData hardcodes them), still pin the recipient, still hard-cap the amount. On a
// miss we surface exactly what Quotient offered so the shape is visible.
const BASE_NETWORKS = ["base", "eip155:8453", "8453", "base-mainnet"];
export function selectAndGuard(accepts: unknown): GuardedReq {
  const list = Array.isArray(accepts) ? (accepts as PaymentReq[]) : [];
  const usdc = BASE_USDC.toLowerCase();
  const r = list.find((a) => {
    const net = String(a?.network ?? "").toLowerCase();
    const asset = String(a?.asset ?? "").toLowerCase();
    return a?.scheme === "exact" && BASE_NETWORKS.includes(net) && asset.includes(usdc);
  });
  if (!r) {
    const offered = list.slice(0, 3)
      .map((a) => `{net:${a?.network} scheme:${a?.scheme} asset:${String(a?.asset ?? "").slice(0, 26)} payTo:${String(a?.payTo ?? "").slice(0, 12)}}`)
      .join(" · ");
    throw new Error(`No Base-USDC 'exact' option. Quotient offered: ${offered || "nothing"}`);
  }
  if (!String(r.payTo ?? "").toLowerCase().includes(QUOTIENT_PAYTO.toLowerCase()))
    throw new Error(`Unexpected recipient (${String(r.payTo ?? "").slice(0, 16)}) — refused.`);
  let amountUnits: bigint;
  try { amountUnits = BigInt(String((r.maxAmountRequired ?? (r as { amount?: unknown }).amount) ?? "")); } catch { throw new Error("Bad payment amount — refused."); }
  if (amountUnits <= 0n) throw new Error("Bad payment amount — refused.");
  if (amountUnits > X402_MAX_UNITS) throw new Error("Payment exceeds the in-app cap — refused.");
  const usd = Number(amountUnits) / 10 ** USDC_DECIMALS;
  // Keep the challenge's ORIGINAL scheme/network strings for the X-PAYMENT echo (the facilitator
  // matches on them); canonicalize the recipient + asset for what we actually sign.
  return { req: { ...r, scheme: String(r.scheme), network: String(r.network), payTo: QUOTIENT_PAYTO, asset: BASE_USDC, maxAmountRequired: String(amountUnits) }, amountUnits, usd };
}

// A random 32-byte nonce (bytes32 hex) — browser crypto, prevents replay.
function randomNonce(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// The EIP-712 typed data for EIP-3009 TransferWithAuthorization. Includes EIP712Domain (which
// eth_signTypedData_v4 requires); the field list matches viem's implicit domain, so the produced
// signature is identical to the reference lib's (verified byte-for-byte).
function buildTypedData(g: GuardedReq, from: string, nonce: string, validAfter: string, validBefore: string) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    domain: {
      name: USDC_DOMAIN.name,
      version: USDC_DOMAIN.version,
      chainId: BASE_CHAIN_ID,
      verifyingContract: BASE_USDC,
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from,
      to: g.req.payTo,
      value: String(g.amountUnits),
      validAfter,
      validBefore,
      nonce,
    },
  };
}

// Assemble the base64 X-PAYMENT header. Byte-identical to the x402 lib's encodePayment: the
// key order (x402Version, scheme, network, payload{signature, authorization{...}}) and btoa
// encoding were verified against the reference implementation.
function encodeXPayment(g: GuardedReq, from: string, nonce: string, validAfter: string, validBefore: string, signature: string, x402Version = 1): string {
  const payload = {
    x402Version,
    scheme: g.req.scheme,
    network: g.req.network,
    payload: {
      signature,
      authorization: { from, to: g.req.payTo, value: String(g.amountUnits), validAfter, validBefore, nonce },
    },
  };
  return btoa(JSON.stringify(payload));
}

// The connected EVM account that will pay — read fresh from the provider (the signer of the
// EIP-3009 authorization MUST be its `from`, or Quotient's facilitator rejects it).
async function payingAccount(provider: Eip1193): Promise<string> {
  let accts: unknown;
  try { accts = await provider.request({ method: "eth_accounts" }); } catch { accts = null; }
  let list = Array.isArray(accts) ? (accts as string[]) : [];
  if (!list.length) {
    try { list = (await provider.request({ method: "eth_requestAccounts" })) as string[]; } catch { list = []; }
  }
  const from = list.find(isAddr);
  if (!from) throw new Error("Connect a wallet to load signals.");
  return from;
}

// Build + sign the X-PAYMENT header for a guarded requirement. Off-chain signature only —
// no tx, no gas, no chain switch (the domain names Base explicitly and the facilitator
// settles on Base regardless of the wallet's current network).
export async function signXPayment(provider: Eip1193, g: GuardedReq, x402Version = 1): Promise<{ header: string; from: string }> {
  const from = await payingAccount(provider);
  const now = Math.floor(Date.now() / 1000);
  const validAfter = String(now - 600); // 10 min of clock skew tolerance
  const validBefore = String(now + (Number(g.req.maxTimeoutSeconds) > 0 ? Number(g.req.maxTimeoutSeconds) : 120));
  const nonce = randomNonce();
  const typedData = buildTypedData(g, from, nonce, validAfter, validBefore);
  let sig: unknown;
  try {
    sig = await provider.request({ method: "eth_signTypedData_v4", params: [from, JSON.stringify(typedData)] });
  } catch (e) {
    const msg = (e as { message?: string })?.message || "";
    throw new Error(/reject|denied|cancel/i.test(msg) ? "Payment signature was cancelled." : "Couldn't sign the payment.");
  }
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(sig)) throw new Error("Couldn't sign the payment.");
  return { header: encodeXPayment(g, from, nonce, validAfter, validBefore, sig, x402Version), from };
}

// ── Client-DIRECT x402 pull ───────────────────────────────────────────────────
// The browser (residential IP) calls Quotient directly — the way x402 is meant to be used.
// This is REQUIRED, not just preferred: Quotient 403s Cloudflare-Worker / datacenter IPs, so
// a worker relay can never reach it (same block the codebase dodges for rss2json). GET → 402
// challenge (CORS `*`, readable) → guard + sign → GET again with X-PAYMENT → the data. Returns
// the RAW `signals` array (the caller shapes it with qshape) + the USD actually authorized.
const QUOTIENT_SIGNALS_URL = "https://quotient-api-gateway.onrender.com/api/v1/signals";

export async function loadQuotientDirect(provider: Eip1193, minConviction = 3): Promise<{ signals: unknown[]; usd: number }> {
  const mc = Number.isFinite(minConviction) && minConviction >= 1 && minConviction <= 5 ? minConviction : 3;
  const url = `${QUOTIENT_SIGNALS_URL}?min_conviction=${mc}`;
  const rawSignals = (d: unknown): unknown[] => {
    const arr = (d as { signals?: unknown })?.signals;
    return Array.isArray(arr) ? arr : [];
  };
  // 1) keyless probe → expect the 402 payment challenge.
  let r1: Response;
  try { r1 = await fetch(url, { headers: { Accept: "application/json" } }); }
  catch { throw new Error("Couldn't reach Quotient — try again shortly."); }
  if (r1.status === 200) return { signals: rawSignals(await r1.json().catch(() => null)), usd: 0 }; // already served
  if (r1.status === 403) throw new Error("Quotient blocked the request (403) — try again shortly.");
  if (r1.status !== 402) throw new Error(`Quotient unavailable (${r1.status}).`);
  // x402 v2 (Quotient): the challenge rides in the base64 `payment-required` RESPONSE HEADER
  // (CORS-exposed via access-control-expose-headers), NOT the JSON body. Decode → { x402Version,
  // accepts:[…] }. Fall back to the body for gateways that put it there.
  let accepts: unknown[] = [];
  let x402Version = 2;
  const hdr = r1.headers.get("payment-required") || r1.headers.get("PAYMENT-REQUIRED");
  if (hdr) {
    try {
      const decoded = JSON.parse(atob(hdr.replace(/-/g, "+").replace(/_/g, "/"))) as { accepts?: unknown; x402Version?: number };
      if (Array.isArray(decoded?.accepts)) accepts = decoded.accepts;
      if (Number.isFinite(decoded?.x402Version)) x402Version = Number(decoded.x402Version);
    } catch { /* fall through to body */ }
  }
  if (!accepts.length) {
    const challenge = await r1.json().catch(() => null);
    const c = challenge as { accepts?: unknown; x402?: { accepts?: unknown }; paymentRequirements?: unknown } | null;
    accepts = Array.isArray(c?.accepts) ? c!.accepts
      : Array.isArray(challenge) ? (challenge as unknown[])
      : Array.isArray(c?.x402?.accepts) ? c!.x402!.accepts as unknown[]
      : Array.isArray(c?.paymentRequirements) ? c!.paymentRequirements as unknown[]
      : [];
  }
  const g = selectAndGuard(accepts);                 // pins network/asset/recipient + caps amount
  // 2) sign the EIP-3009 authorization for exactly that amount (echo the challenge's x402 version).
  const { header } = await signXPayment(provider, g, x402Version);
  // 3) retry WITH the payment → the data.
  let r2: Response;
  try { r2 = await fetch(url, { headers: { Accept: "application/json", "X-PAYMENT": header } }); }
  catch { throw new Error("Payment sent but the data request was blocked — try again shortly."); }
  if (r2.status === 402) throw new Error("Quotient declined the payment — check your Base USDC balance and try again.");
  if (!r2.ok) throw new Error(`Quotient error (${r2.status}).`);
  return { signals: rawSignals(await r2.json().catch(() => null)), usd: g.usd };
}
