// ── x402 client-pays (Base USDC) — the ONE place Q Signals asks the wallet to pay ────
// Quotient's /signals is an x402 (v2) endpoint: no payment → HTTP 402 + a payment challenge
// in the base64 `payment-required` RESPONSE HEADER; pay → the data. We make the USER'S wallet
// pay (not Nexus, not our credits): the wallet signs ONE EIP-3009 `TransferWithAuthorization`
// — an OFF-CHAIN, gasless authorization for EXACTLY the challenge amount of USDC on Base to
// Quotient. Quotient's facilitator submits it; nothing is sent from here — no tx, no gas, no
// chain switch. The browser MUST call Quotient directly: it 403s Cloudflare-Worker/datacenter
// IPs (same block the codebase dodges for rss2json), so a server relay can never reach it.
//
// Guards (the risk posture): BEFORE any wallet prompt we PIN the network (Base), asset (native
// USDC), scheme (exact) and recipient (Quotient), and CAP the amount. A hostile/drifted 402 can
// authorize at most X402_MAX_UNITS to our pinned payTo — it can never widen the spend or redirect
// funds. The signed authorization names an exact value to an exact payTo; the blast radius is
// that one micro-payment and nothing lingers (no allowance, no standing approval).

// EIP-1193 provider — same shape swapExec uses (Orderly's connector exposes wallet.provider).
export type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

const BASE_CHAIN_ID = 8453;
// Native (Circle) USDC on Base — the ONLY asset we'll authorize. 6 decimals.
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// Base USDC's EIP-712 domain (FiatTokenV2). HARDCODED so the signed data is fully determined by
// OUR constants — a hostile 402 can influence nothing in the domain.
const USDC_DOMAIN = { name: "USD Coin", version: "2" };
// Quotient's payment receiver (verified from the live 402). Soft-pinned: a mismatch fails LOUD.
const QUOTIENT_PAYTO = "0xC3d01FD2F79d4c57aD106AB8ecc12a5dE24F97cB";
// Hard ceiling on a single pull: $0.05 (50,000 units, 6dp). One pull is $0.01; headroom absorbs a
// price tweak, still caps any hostile challenge at a nickel.
export const X402_MAX_UNITS = 50000n;
export const USDC_DECIMALS = 6;

const isAddr = (a: unknown): a is string => typeof a === "string" && /^0x[a-fA-F0-9]{40}$/.test(a);

// A guarded, ready-to-sign requirement. `accept` + `resource` are the RAW challenge objects,
// echoed VERBATIM in the v2 payload so the facilitator matches its own requirement.
export interface GuardedReq {
  accept: Record<string, unknown>;
  resource: unknown;
  extensions: unknown;
  amountUnits: bigint;
  usd: number;
  maxTimeoutSeconds: number;
}

// Base is named "base" (Coinbase x402) OR CAIP-2 "eip155:8453" / "8453"; the asset can be a bare
// address or CAIP-19 ("eip155:8453/erc20:0x…"). Match network against the known Base identifiers
// and asset by CONTAINMENT of our pinned USDC. The loosening only affects WHICH offer we accept —
// we still SIGN against canonical BASE_USDC / QUOTIENT_PAYTO / chainId 8453 and hard-cap the amount.
const BASE_NETWORKS = ["base", "eip155:8453", "8453", "base-mainnet"];
export function selectAndGuard(accepts: unknown, resource?: unknown, extensions?: unknown): GuardedReq {
  const list = Array.isArray(accepts) ? (accepts as Record<string, unknown>[]) : [];
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
  try { amountUnits = BigInt(String((r.maxAmountRequired ?? r.amount) ?? "")); } catch { throw new Error("Bad payment amount — refused."); }
  if (amountUnits <= 0n) throw new Error("Bad payment amount — refused.");
  if (amountUnits > X402_MAX_UNITS) throw new Error("Payment exceeds the in-app cap — refused.");
  const usd = Number(amountUnits) / 10 ** USDC_DECIMALS;
  const mts = Number(r.maxTimeoutSeconds);
  return { accept: r, resource: resource ?? null, extensions: extensions ?? {}, amountUnits, usd, maxTimeoutSeconds: Number.isFinite(mts) && mts > 0 ? mts : 120 };
}

// A random 32-byte nonce (bytes32 hex) — browser crypto, prevents replay.
function randomNonce(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// The EIP-712 typed data for EIP-3009 TransferWithAuthorization. Domain + recipient are OUR pinned
// constants; only the amount comes (capped) from the challenge — so a hostile 402 shapes nothing signed.
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
    domain: { name: USDC_DOMAIN.name, version: USDC_DOMAIN.version, chainId: BASE_CHAIN_ID, verifyingContract: BASE_USDC },
    primaryType: "TransferWithAuthorization",
    message: { from, to: QUOTIENT_PAYTO, value: String(g.amountUnits), validAfter, validBefore, nonce },
  };
}

// UTF-8-safe base64 — the challenge's `resource.description` carries non-Latin1 chars (em-dashes,
// curly quotes) that plain btoa can't encode. Quotient base64s its header as UTF-8, so we match.
function b64utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Assemble the base64 payment payload. x402 v2 (Quotient's flavor) wraps the signed authorization
// with the ECHOED `resource`, `accepted` (the chosen requirement, VERBATIM — network stays CAIP-2
// eip155:8453), and `extensions`; v1 uses the flat {scheme, network, payload}. It rides in the
// PAYMENT-SIGNATURE request header (NOT X-PAYMENT — that's what Quotient couldn't see).
function encodeXPayment(g: GuardedReq, from: string, nonce: string, validAfter: string, validBefore: string, signature: string, x402Version = 2): string {
  const authorization = { from, to: QUOTIENT_PAYTO, value: String(g.amountUnits), validAfter, validBefore, nonce };
  const payload = x402Version >= 2
    ? { x402Version, resource: g.resource ?? undefined, accepted: g.accept, payload: { signature, authorization }, extensions: g.extensions ?? {} }
    : { x402Version, scheme: g.accept.scheme, network: g.accept.network, payload: { signature, authorization } };
  return b64utf8(JSON.stringify(payload));
}

// The connected EVM account that will pay — read fresh from the provider (the signer of the
// EIP-3009 authorization MUST be its `from`, or the facilitator rejects it).
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

// Build + sign the X-PAYMENT header. Off-chain signature only — no tx, no gas, no chain switch.
export async function signXPayment(provider: Eip1193, g: GuardedReq, x402Version = 2): Promise<{ header: string; from: string }> {
  const from = await payingAccount(provider);
  const now = Math.floor(Date.now() / 1000);
  const validAfter = String(now - 600); // 10 min of clock-skew tolerance
  const validBefore = String(now + g.maxTimeoutSeconds);
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
const QUOTIENT_SIGNALS_URL = "https://quotient-api-gateway.onrender.com/api/v1/signals";

// Best-effort decode of a base64 x402 header (payment-required / payment-response) → { error, message }.
function decodeX402Header(hdr: string | null): { error?: string; message?: string; accepts?: unknown; resource?: unknown; extensions?: unknown; x402Version?: number } | null {
  if (!hdr) return null;
  try { return JSON.parse(atob(hdr.replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
}

export async function loadQuotientDirect(provider: Eip1193, minConviction = 3): Promise<{ signals: unknown[]; usd: number }> {
  const mc = Number.isFinite(minConviction) && minConviction >= 1 && minConviction <= 5 ? minConviction : 3;
  const url = `${QUOTIENT_SIGNALS_URL}?min_conviction=${mc}`;
  const rawSignals = (d: unknown): unknown[] => {
    const arr = (d as { signals?: unknown })?.signals;
    return Array.isArray(arr) ? arr : [];
  };
  // 1) keyless probe → expect the 402 payment challenge (in the payment-required header).
  let r1: Response;
  try { r1 = await fetch(url, { headers: { Accept: "application/json" } }); }
  catch { throw new Error("Couldn't reach Quotient — try again shortly."); }
  if (r1.status === 200) return { signals: rawSignals(await r1.json().catch(() => null)), usd: 0 }; // already served
  if (r1.status === 403) throw new Error("Quotient blocked the request (403) — try again shortly.");
  if (r1.status !== 402) throw new Error(`Quotient unavailable (${r1.status}).`);
  let accepts: unknown[] = [];
  let resource: unknown = null;
  let extensions: unknown = {};
  let x402Version = 2;
  const decoded = decodeX402Header(r1.headers.get("payment-required") || r1.headers.get("PAYMENT-REQUIRED"));
  if (decoded) {
    if (Array.isArray(decoded.accepts)) accepts = decoded.accepts;
    if (Number.isFinite(decoded.x402Version)) x402Version = Number(decoded.x402Version);
    resource = decoded.resource ?? null;
    extensions = decoded.extensions ?? {};
  }
  if (!accepts.length) {
    // Fallback: some gateways put accepts in the JSON body.
    const challenge = await r1.json().catch(() => null);
    const c = challenge as { accepts?: unknown; resource?: unknown; extensions?: unknown } | null;
    if (Array.isArray(c?.accepts)) { accepts = c!.accepts; resource = c!.resource ?? resource; extensions = c!.extensions ?? extensions; }
    else if (Array.isArray(challenge)) accepts = challenge as unknown[];
  }
  const g = selectAndGuard(accepts, resource, extensions);   // pins network/asset/recipient + caps amount
  // 2) sign the EIP-3009 authorization for exactly that amount (echo the challenge's x402 version).
  const { header } = await signXPayment(provider, g, x402Version);
  // 3) retry WITH the payment. Quotient's v2 reads it from the PAYMENT-SIGNATURE header, NOT
  //    X-PAYMENT (both are in its allow-headers; X-PAYMENT is silently ignored → "Payment required").
  let r2: Response;
  try { r2 = await fetch(url, { headers: { Accept: "application/json", "PAYMENT-SIGNATURE": header } }); }
  catch { throw new Error("Payment sent but the data request was blocked — try again shortly."); }
  if (r2.ok) return { signals: rawSignals(await r2.json().catch(() => null)), usd: g.usd };
  // Surface the facilitator's ACTUAL reason (payment-response / payment-required header, or body).
  const why = decodeX402Header(r2.headers.get("payment-response") || r2.headers.get("payment-required"));
  const body = (await r2.json().catch(() => null)) as { error?: string; message?: string } | null;
  const reason = why?.error || why?.message || body?.error || body?.message || `HTTP ${r2.status}`;
  if (r2.status === 402) throw new Error(`Quotient declined the payment: ${reason}`);
  throw new Error(`Quotient error (${r2.status}): ${reason}`);
}
