// NEAR Intents 1Click — the guards that run BEFORE the wallet is ever asked to send.
//
// 1Click is a deposit-address flow: we ask for a quote, 1Click answers with an address,
// the user sends the input token there, and a solver delivers the output on the other
// chain. So the single field that decides where the user's money goes is
// `quote.depositAddress`, and the user signs a plain transfer to it — nothing on-chain
// checks it against the intent afterwards. Everything below exists to prove, before the
// transfer is built, that the address is one 1Click issued FOR THIS USER'S swap:
//
// 1. SIGNATURE — 1Click signs every quote with an ed25519 key. We verify it against the
//    key pinned here (the same key the official SDK pins), over the same canonical hash
//    the SDK computes. A payload altered anywhere between 1Click and the browser (our
//    worker proxy included) fails.
// 2. INTENT — a valid signature only proves 1Click produced the quote, not that it is
//    ours: anyone can request a quote with their OWN recipient and get it signed. So the
//    signed request must also carry exactly the user's recipient and refund address, the
//    assets and amount we asked for, and the deposit/recipient/refund types we expect.
// 3. SHAPE — a non-dry quote, a deposit address in the origin chain's format, an output
//    floor, and a deadline that hasn't passed.
//
// Pure functions, no network: the caller fetches, these decide. Mirrors the SDK's
// verifyQuoteSignature (@defuse-protocol/one-click-sdk-typescript 0.1.26) without its
// axios/form-data weight.

import stringify from "json-stable-stringify";
import { sha256 } from "@noble/hashes/sha2";
import { sha512 } from "@noble/hashes/sha2";
import { base58 } from "@scure/base";
import * as ed from "@noble/ed25519";

// noble/ed25519 v2 needs a sha512 for its sync API; wire the audited noble one.
if (!ed.etc.sha512Sync) ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export const ONE_CLICK_API = "https://1click.chaindefuser.com";
// Pinned from the official SDK (ONE_CLICK_MANAGER_PUB_KEY). If 1Click rotates it, every
// quote fails closed with "signature" — update it here from the SDK, never from a response.
export const ONE_CLICK_PUBKEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

// Exactly the fields the SDK hashes, in its shape (undefined = left out of the JSON).
function signedRequest(qr) {
  return {
    dry: qr.dry,
    swapType: qr.swapType,
    slippageTolerance: qr.slippageTolerance,
    originAsset: qr.originAsset,
    depositType: qr.depositType,
    destinationAsset: qr.destinationAsset,
    amount: qr.amount,
    refundTo: qr.refundTo,
    refundType: qr.refundType,
    recipient: qr.recipient,
    recipientType: qr.recipientType,
    deadline: qr.deadline,
    quoteWaitingTimeMs: qr.quoteWaitingTimeMs ? qr.quoteWaitingTimeMs : undefined,
    referral: qr.referral ? qr.referral : undefined,
    virtualChainRecipient: qr.virtualChainRecipient ? qr.virtualChainRecipient : undefined,
    virtualChainRefundRecipient: qr.virtualChainRefundRecipient ? qr.virtualChainRefundRecipient : undefined,
    customRecipientMsg: qr.customRecipientMsg ? qr.customRecipientMsg : undefined,
  };
}

function signedQuote(dry, q) {
  const base = {
    amountIn: q.amountIn, amountInFormatted: q.amountInFormatted, amountInUsd: q.amountInUsd,
    minAmountIn: q.minAmountIn, amountOut: q.amountOut, amountOutFormatted: q.amountOutFormatted,
    amountOutUsd: q.amountOutUsd, minAmountOut: q.minAmountOut,
  };
  if (dry) return base;
  return {
    ...base,
    depositAddress: q.depositAddress || undefined,
    depositMemo: q.depositMemo || undefined,
    deadline: q.deadline || undefined,
    timeWhenInactive: q.timeWhenInactive || undefined,
    timeEstimate: q.timeEstimate || undefined,
    refundFee: q.refundFee || undefined,
    withdrawFee: q.withdrawFee || undefined,
  };
}

export function quoteHash(response) {
  const qr = response.quoteRequest || {};
  const data = stringify({ ...signedRequest(qr), ...signedQuote(qr.dry, response.quote || {}), timestamp: response.timestamp });
  return base58.encode(sha256(new TextEncoder().encode(data)));
}

const strip = (k) => (typeof k === "string" && k.startsWith("ed25519:") ? k.slice(8) : k);

export function verifyQuoteSignature(response, pubKey = ONE_CLICK_PUBKEY) {
  try {
    if (!response || typeof response.signature !== "string") return false;
    const sig = base58.decode(strip(response.signature));
    const pk = base58.decode(strip(pubKey));
    const msg = new TextEncoder().encode(quoteHash(response));
    return ed.verify(sig, msg, pk);
  } catch {
    return false;
  }
}

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_CHAINS = new Set(["eth", "arb", "base", "op", "pol", "bsc", "avax", "gnosis", "bera", "scroll", "monad", "xlayer", "abs", "plasma", "hood"]);

export function addressFitsChain(address, chain) {
  if (typeof address !== "string" || !address) return false;
  if (EVM_CHAINS.has(chain)) return EVM_ADDR.test(address);
  if (chain === "sol") return SOL_ADDR.test(address);
  return false; // chains we don't send from in-app: refuse rather than guess the format
}

// EVM addresses compare case-insensitively (checksum casing is cosmetic). Every other
// format here (Solana base58, bitcoin) is case-SENSITIVE: lowercasing could equate two
// different addresses, so those must match exactly.
export const sameAddress = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return EVM_ADDR.test(a) && EVM_ADDR.test(b) ? a.toLowerCase() === b.toLowerCase() : a === b;
};

// Destination recipients the UI accepts. EVM destinations pay the connected wallet; Solana
// and bitcoin take a typed address, checked for shape here (the quote then signs it, and
// checkQuote requires the signed recipient to equal exactly what the user typed).
const BTC_ADDR = /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/;
export function recipientFitsChain(address, chain) {
  if (typeof address !== "string" || !address) return false;
  if (EVM_CHAINS.has(chain)) return EVM_ADDR.test(address);
  if (chain === "sol") return SOL_ADDR.test(address);
  if (chain === "btc") return BTC_ADDR.test(address);
  return false;
}

// intent = what the user asked for:
//   { originAsset, destinationAsset, amount (base units string), recipient, refundTo,
//     originChain, maxSlippageBps, now? }
// Returns { ok:true, depositAddress, minAmountOut, deadlineMs } or { ok:false, reason }.
export function checkQuote(response, intent) {
  const fail = (reason) => ({ ok: false, reason });
  if (!response || !response.quote || !response.quoteRequest) return fail("malformed");
  if (!verifyQuoteSignature(response)) return fail("signature");

  const qr = response.quoteRequest;
  const q = response.quote;
  if (qr.dry !== false) return fail("dry quote");
  if (qr.swapType !== "EXACT_INPUT") return fail("swap type");
  if (qr.depositType !== "ORIGIN_CHAIN" || qr.recipientType !== "DESTINATION_CHAIN" || qr.refundType !== "ORIGIN_CHAIN") return fail("route types");
  if (qr.originAsset !== intent.originAsset || qr.destinationAsset !== intent.destinationAsset) return fail("assets");
  if (String(qr.amount) !== String(intent.amount) || String(q.amountIn) !== String(intent.amount)) return fail("amount");
  if (!sameAddress(qr.recipient, intent.recipient)) return fail("recipient");
  if (!sameAddress(qr.refundTo, intent.refundTo)) return fail("refund address");
  if (!(Number(qr.slippageTolerance) >= 0 && Number(qr.slippageTolerance) <= (intent.maxSlippageBps ?? 100))) return fail("slippage");
  if (qr.virtualChainRecipient || qr.virtualChainRefundRecipient || qr.customRecipientMsg) return fail("unexpected routing fields");

  if (!addressFitsChain(q.depositAddress, intent.originChain)) return fail("deposit address");
  if (q.depositMemo) return fail("memo deposits not supported"); // a memo-less transfer would be lost
  let minOut;
  try { minOut = BigInt(q.minAmountOut); } catch { return fail("min out"); }
  if (minOut <= 0n) return fail("min out");

  // Two deadlines come back: the one WE asked for (quoteRequest.deadline, minutes out —
  // the price is only good until then) and how long the deposit address stays open
  // (quote.deadline, days out). Sending must beat the EARLIER one, or the user pays into
  // a quote whose price has lapsed.
  const now = intent.now ?? Date.now();
  const stamps = [Date.parse(qr.deadline), Date.parse(q.deadline)].filter(Number.isFinite);
  if (!stamps.length) return fail("expired");
  const deadlineMs = Math.min(...stamps);
  if (deadlineMs <= now) return fail("expired");

  return { ok: true, depositAddress: q.depositAddress, minAmountOut: q.minAmountOut, deadlineMs };
}

// ── The assets the card offers, PINNED (never taken from an API response) ─────────
// assetId + decimals from GET /v0/tokens (checked 2026-09-27). `token` is the ERC-20 the
// user transfers on the origin chain (null = the chain's native coin). The deposit tx is
// built from THIS table, so a response can't redirect the transfer to another contract.
export const XC_ASSETS = {
  "USDC.arb":  { chain: "arb",  chainId: 42161, sym: "USDC", decimals: 6,  assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",  token: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", origin: true },
  "ETH.arb":   { chain: "arb",  chainId: 42161, sym: "ETH",  decimals: 18, assetId: "nep141:arb.omft.near", token: null, origin: true },
  "USDC.base": { chain: "base", chainId: 8453,  sym: "USDC", decimals: 6,  assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", origin: true },
  "ETH.base":  { chain: "base", chainId: 8453,  sym: "ETH",  decimals: 18, assetId: "nep141:base.omft.near", token: null, origin: true },
  "USDC.eth":  { chain: "eth",  chainId: 1,     sym: "USDC", decimals: 6,  assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",  token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", origin: true },
  "ETH.eth":   { chain: "eth",  chainId: 1,     sym: "ETH",  decimals: 18, assetId: "nep141:eth.omft.near", token: null, origin: true },
  "SOL.sol":   { chain: "sol",  chainId: null,  sym: "SOL",  decimals: 9,  assetId: "nep141:sol.omft.near", token: null, origin: false },
  "USDC.sol":  { chain: "sol",  chainId: null,  sym: "USDC", decimals: 6,  assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", token: null, origin: false },
  // BTC: the CANONICAL id 1Click signs. Asking with the older alias (nep141:btc.omft.near)
  // comes back signed as this id, and checkQuote rightly refuses a changed asset — so we pin
  // the one it signs instead of loosening the check (verified live 2026-09-27).
  "BTC.btc":   { chain: "btc",  chainId: null,  sym: "BTC",  decimals: 8,  assetId: "1cs_v1:btc:native:coin", token: null, origin: false },
};
export const CHAIN_NAME = { arb: "Arbitrum", base: "Base", eth: "Ethereum", sol: "Solana", btc: "Bitcoin" };

const strip0xLower = (h) => (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();
// ERC-20 transfer(address,uint256) — hand-encoded like the rest of the spot path.
export function encodeTransfer(to, amount) {
  if (!EVM_ADDR.test(to)) throw new Error("bad transfer recipient");
  if (typeof amount !== "bigint" || amount <= 0n) throw new Error("bad transfer amount");
  return "0xa9059cbb" + strip0xLower(to).padStart(64, "0") + amount.toString(16).padStart(64, "0");
}

// The ONE transaction the user signs: a plain transfer of exactly `amount` of the pinned
// origin asset to the verified deposit address, on the origin chain. No approval, so no
// allowance is left behind. Native coin → value transfer; ERC-20 → transfer() with value 0.
export function buildDepositTx(assetKey, amount, depositAddress, from) {
  const a = XC_ASSETS[assetKey];
  if (!a || !a.origin) throw new Error("unsupported origin asset");
  if (!EVM_ADDR.test(from)) throw new Error("bad sender");
  if (!addressFitsChain(depositAddress, a.chain)) throw new Error("bad deposit address");
  if (typeof amount !== "bigint" || amount <= 0n) throw new Error("bad amount");
  const hex = (v) => "0x" + v.toString(16);
  return a.token
    ? { chainId: a.chainId, tx: { from, to: a.token, data: encodeTransfer(depositAddress, amount), value: "0x0" } }
    : { chainId: a.chainId, tx: { from, to: depositAddress, value: hex(amount) } };
}

// Decimal string → base units, exact (no floats). null on anything malformed.
export function toUnits(str, decimals) {
  if (typeof str !== "string") return null;
  const m = str.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const frac = (m[2] || "");
  if (frac.length > decimals) return null;
  const v = BigInt(m[1] + frac.padEnd(decimals, "0"));
  return v > 0n ? v : null;
}

export function fromUnits(raw, decimals, maxFrac = 6) {
  let v;
  try { v = BigInt(raw); } catch { return "—"; }
  const s = v.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).slice(0, maxFrac).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

// 1Click status → what the UI says. Anything unknown reads as in-flight, never as done.
export const STATUS_TEXT = {
  PENDING_DEPOSIT: "Waiting for your deposit",
  KNOWN_DEPOSIT_TX: "Deposit seen",
  PROCESSING: "Swapping",
  SUCCESS: "Delivered",
  INCOMPLETE_DEPOSIT: "Deposit below the quoted amount",
  REFUNDED: "Refunded to your wallet",
  FAILED: "Failed",
};
export const TERMINAL = new Set(["SUCCESS", "REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"]);
