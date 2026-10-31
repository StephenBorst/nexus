// ── Jupiter Swap API V2 /build: what a response must prove before we assemble + sign (pure, tested) ─
// /build (v1's successor, docs swap/build) returns a quote plus RAW instructions; the signer
// (app/pages/token/solSwapExec.ts) assembles the v0 transaction itself. These checks run on the
// response before anything is assembled; the simulate guard then runs on the exact bytes signed.
//   • quote binding: mints, amount, ExactIn, slippage no wider than asked, minimum out within it
//   • only the wallet signs anything; no tip; v0 instructions (we compile with lookup tables)
//   • compute budget: price instructions only (we set the limit ourselves), price clamped
//   • our fee (worker echo `nexus`): ≤ MAX_FEE_BPS, and when on, our fee account is IN the swap
//     instruction (the fee is taken by the swap itself, docs "Fees")
import { checkMinOut } from "./solSwapGuards.mjs";

export const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
export const CU_LIMIT_MAX = 1_400_000;
// Priority fee cap: µlamports per CU. 2,000,000 × 1.4M CU = 0.0028 SOL worst case; typical quotes
// ask ~500. The docs say to clamp the price (it tracks recent bids and can spike).
export const CU_PRICE_MAX = 2_000_000n;
export const MAX_FEE_BPS = 100;
// A fixed taker for price reads with no wallet (/build requires one). A freshly generated key whose
// secret was never kept: it holds nothing, signs nothing, and its transactions are never built.
export const PRICE_TAKER = "C7KRf3nmV4juKiXLSmZXGraC2c98RzvgbvBK4sBDTnAS";

const b64bytes = (s) => { try { return Uint8Array.from(atob(String(s || "")), (c) => c.charCodeAt(0)); } catch { return null; } };
const bytesB64 = (u8) => btoa(String.fromCharCode(...u8));

/** All instruction objects the transaction will carry (not the compute budget). */
export function coreInstructions(b) {
  return [...(b?.setupInstructions || []), b?.swapInstruction, ...(b?.cleanupInstruction ? [b.cleanupInstruction] : []), ...(b?.otherInstructions || [])];
}

/** The compute-unit price from the response's compute budget instructions, clamped; null = refused. */
export function cuPriceOf(b) {
  let price = 0n;
  for (const ix of b?.computeBudgetInstructions || []) {
    if (ix?.programId !== COMPUTE_BUDGET || (ix.accounts || []).length) return null;
    const d = b64bytes(ix.data);
    if (!d || d.length !== 9 || d[0] !== 3) return null; // SetComputeUnitPrice only; the limit is ours
    let v = 0n;
    for (let i = 8; i >= 1; i--) v = (v << 8n) | BigInt(d[i]);
    price = v;
  }
  return price > CU_PRICE_MAX ? CU_PRICE_MAX : price;
}

export const cuLimitData = (units) => { const d = new Uint8Array(5); d[0] = 2; new DataView(d.buffer).setUint32(1, units, true); return bytesB64(d); };
export const cuPriceData = (price) => { const d = new Uint8Array(9); d[0] = 3; new DataView(d.buffer).setBigUint64(1, BigInt(price), true); return bytesB64(d); };

/**
 * @param {any} b  the /build response (with the worker's `nexus` echo)
 * @param {{ inputMint: string, outputMint: string, inAmount: number | string, slippageBps: number, taker: string }} want
 * @returns {string | null} null = ok, else why it's refused
 */
export function checkBuild(b, want) {
  if (!b || typeof b !== "object" || !b.swapInstruction) return "No Jupiter route right now — use the deep-link.";
  if (b.inputMint !== want.inputMint) return "Quote input mismatch — refused.";
  if (b.outputMint !== want.outputMint) return "Quote output mismatch — refused.";
  if (String(b.inAmount) !== String(want.inAmount)) return "Quote amount mismatch — refused.";
  if (b.swapMode && b.swapMode !== "ExactIn") return "Unexpected swap mode — refused.";
  if (typeof b.slippageBps === "number" && b.slippageBps > want.slippageBps) return "Route widened slippage — refused.";
  const minErr = checkMinOut({ outAmount: b.outAmount, minOut: b.otherAmountThreshold, slippageBps: want.slippageBps });
  if (minErr) return minErr;
  if (b.tipInstruction) return "Unexpected tip instruction — refused.";
  if (b.transactionVersion != null && String(b.transactionVersion) !== "0") return "Unexpected transaction version — refused.";
  if (!b.blockhashWithMetadata || !Array.isArray(b.blockhashWithMetadata.blockhash) || b.blockhashWithMetadata.blockhash.length !== 32) return "No blockhash in the route — refused.";
  if (cuPriceOf(b) == null) return "Unexpected compute budget instruction — refused.";
  for (const ix of coreInstructions(b)) {
    if (!ix || typeof ix.programId !== "string" || !Array.isArray(ix.accounts)) return "Unreadable instruction — refused.";
    if (ix.programId === COMPUTE_BUDGET) return "Unexpected compute budget instruction — refused.";
    for (const a of ix.accounts) if (a?.isSigner && a.pubkey !== want.taker) return "Route asks another account to sign — refused.";
  }
  const fee = Number(b.nexus?.feeBps ?? 0);
  if (!Number.isInteger(fee) || fee < 0 || fee > MAX_FEE_BPS) return "Quote carries an unexpected fee — refused.";
  if (fee > 0 && !b.swapInstruction.accounts.some((a) => a?.pubkey === b.nexus?.feeAccount)) return "Fee doesn't go to Nexus's account — refused.";
  return null;
}
