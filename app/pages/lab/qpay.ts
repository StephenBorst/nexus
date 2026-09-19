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

// Pick the Base/exact/USDC requirement from a 402 challenge and GUARD it hard. Throws a plain
// message (caller fails soft) on anything unexpected — this runs BEFORE any signature.
export function selectAndGuard(accepts: unknown): GuardedReq {
  const list = Array.isArray(accepts) ? (accepts as PaymentReq[]) : [];
  const r = list.find(
    (a) => a && a.scheme === "exact" && a.network === "base" && typeof a.asset === "string" && a.asset.toLowerCase() === BASE_USDC.toLowerCase(),
  );
  if (!r) throw new Error("Quotient didn't offer a Base-USDC payment option — can't pay in-app.");
  if (!isAddr(r.payTo) || r.payTo.toLowerCase() !== QUOTIENT_PAYTO.toLowerCase())
    throw new Error("Unexpected payment recipient — refused.");
  let amountUnits: bigint;
  try { amountUnits = BigInt(String(r.maxAmountRequired ?? "")); } catch { throw new Error("Bad payment amount — refused."); }
  if (amountUnits <= 0n) throw new Error("Bad payment amount — refused.");
  if (amountUnits > X402_MAX_UNITS) throw new Error("Payment exceeds the in-app cap — refused.");
  const usd = Number(amountUnits) / 10 ** USDC_DECIMALS;
  // Canonicalize to OUR pinned constants (guaranteed equal to the challenge by the checks
  // above) so nothing downstream signs a value the attacker could have shaped.
  return { req: { ...r, scheme: "exact", network: "base", payTo: QUOTIENT_PAYTO, asset: BASE_USDC }, amountUnits, usd };
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
function encodeXPayment(g: GuardedReq, from: string, nonce: string, validAfter: string, validBefore: string, signature: string): string {
  const payload = {
    x402Version: 1,
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
export async function signXPayment(provider: Eip1193, g: GuardedReq): Promise<{ header: string; from: string }> {
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
  return { header: encodeXPayment(g, from, nonce, validAfter, validBefore, sig), from };
}
