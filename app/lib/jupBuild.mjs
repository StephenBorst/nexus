// ── Jupiter Swap API V2 /build: what a response must prove before we assemble + sign (pure, tested) ─
// /build (v1's successor, docs swap/build) returns a quote plus RAW instructions; the signer
// (app/pages/token/solSwapExec.ts) assembles the v0 transaction itself. These checks run on the
// response before anything is assembled; the simulate guard then runs on the exact bytes signed.
//   • quote binding: mints, amount, ExactIn, slippage no wider than asked, minimum out within it
//   • only the wallet signs anything; no tip; v0 instructions (we compile with lookup tables)
//   • compute budget: price instructions only (we set the limit ourselves), price clamped
//   • our fee (worker echo `nexus`): ≤ MAX_FEE_BPS, and when on, our fee account is IN the swap
//     instruction (the fee is taken by the swap itself, docs "Fees")
//   • every instruction outside Jupiter's own program has one of the shapes Jupiter sends
//     (instructionShapeRefusal): the simulate guard compares BALANCES, so an instruction that moves
//     nothing but hands over control (an SPL Approve to a delegate, SetAuthority on a token account,
//     a System Assign of the wallet) would pass it. Those are refused by shape, before assembling.
//   • the lookup tables the reply claims are what the chain holds (altClaimRefusal): we compile
//     with the reply's table contents, the chain resolves the real ones, so a lie there would make
//     a checked account resolve to another address on-chain.
import { checkMinOut } from "./solSwapGuards.mjs";

export const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
export const CU_LIMIT_MAX = 1_400_000;
// Priority fee cap: µlamports per CU. 2,000,000 × 1.4M CU = 0.0028 SOL worst case; typical quotes
// ask ~500. The docs say to clamp the price (it tracks recent bids and can spike).
export const CU_PRICE_MAX = 2_000_000n;
export const MAX_FEE_BPS = 100;
export const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const SYSTEM = "11111111111111111111111111111111";
export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
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
 * Why an instruction outside Jupiter's program isn't one of the shapes a Jupiter swap uses, or null.
 * Allowed (as in real /build replies, __fixtures__/jup-build-*.json):
 *   ATA      Create / CreateIdempotent, paid by and owned by the wallet
 *   System   Transfer from the wallet to its own wSOL account (wrapping the SOL it spends)
 *   Token    SyncNative on the wallet's wSOL account; CloseAccount of it back to the wallet
 *   Memo     anything (moves nothing, grants nothing)
 * Everything else, and every other instruction of these programs (Approve, SetAuthority, Transfer,
 * Assign, …), is refused.
 * @param {{ programId: string, accounts: {pubkey: string}[], data: string }} ix
 * @param {{ taker: string, wsolAta: string }} who  wsolAta = the wallet's associated wSOL account
 */
export function instructionShapeRefusal(ix, { taker, wsolAta }) {
  const pid = ix?.programId;
  if (pid === JUPITER_V6 || pid === MEMO) return null;
  const d = b64bytes(ix?.data);
  const acc = (i) => ix?.accounts?.[i]?.pubkey;
  const n = Array.isArray(ix?.accounts) ? ix.accounts.length : -1;
  if (!d || n < 0) return "Unreadable instruction — refused.";
  if (pid === ATA) {
    if (!(d.length === 0 || (d.length === 1 && (d[0] === 0 || d[0] === 1)))) return "Unexpected token-account instruction — refused.";
    if (n !== 6 || acc(0) !== taker || acc(2) !== taker) return "Route creates a token account for someone else — refused.";
    if (acc(4) !== SYSTEM || (acc(5) !== TOKEN && acc(5) !== TOKEN_2022)) return "Unexpected token-account instruction — refused.";
    return null;
  }
  if (pid === SYSTEM) {
    // Transfer = u32 LE 2, then u64 lamports.
    if (d.length !== 12 || d[0] !== 2 || d[1] || d[2] || d[3]) return "Unexpected System instruction — refused.";
    if (n !== 2 || acc(0) !== taker || acc(1) !== wsolAta) return "Route sends SOL somewhere other than your wrapped-SOL account — refused.";
    return null;
  }
  if (pid === TOKEN) {
    if (d.length === 1 && d[0] === 17) { // SyncNative
      if (n !== 1 || acc(0) !== wsolAta) return "Unexpected token instruction — refused.";
      return null;
    }
    if (d.length === 1 && d[0] === 9) {  // CloseAccount: account, destination, owner
      if (n !== 3 || acc(0) !== wsolAta || acc(1) !== taker || acc(2) !== taker) return "Route closes an account to someone else — refused.";
      return null;
    }
    return "Route asks for token permissions the swap doesn't need — refused.";
  }
  if (pid === TOKEN_2022) return "Route asks for token permissions the swap doesn't need — refused.";
  return "Route touches an unexpected program — refused.";
}

/**
 * The lookup tables the reply claims must be what the chain holds: every claimed address at the
 * same index of the on-chain table (a prefix: tables only grow). `onchain[key]` = the table's
 * addresses read from the chain, or null when it couldn't be read (refused: fail closed).
 * @param {Record<string, string[]> | null | undefined} claimed
 * @param {Record<string, string[] | null>} onchain
 */
export function altClaimRefusal(claimed, onchain) {
  for (const [key, addrs] of Object.entries(claimed || {})) {
    const real = onchain?.[key];
    if (!Array.isArray(real)) return "Couldn't verify the route's lookup tables — not signing.";
    if (!Array.isArray(addrs) || addrs.length > real.length) return "Route's lookup table doesn't match the chain — refused.";
    for (let i = 0; i < addrs.length; i++) if (addrs[i] !== real[i]) return "Route's lookup table doesn't match the chain — refused.";
  }
  return null;
}

/**
 * @param {any} b  the /build response (with the worker's `nexus` echo)
 * @param {{ inputMint: string, outputMint: string, inAmount: number | string, slippageBps: number, taker: string, wsolAta: string }} want
 *   wsolAta = the taker's associated wSOL account (derived by the caller; required)
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
  if (typeof want.wsolAta !== "string" || !want.wsolAta) return "Couldn't verify the route's setup — refused.";
  if (b.swapInstruction.programId !== JUPITER_V6) return "Route touches an unexpected program — refused.";
  for (const ix of coreInstructions(b)) {
    if (!ix || typeof ix.programId !== "string" || !Array.isArray(ix.accounts)) return "Unreadable instruction — refused.";
    if (ix.programId === COMPUTE_BUDGET) return "Unexpected compute budget instruction — refused.";
    for (const a of ix.accounts) if (a?.isSigner && a.pubkey !== want.taker) return "Route asks another account to sign — refused.";
    const shape = instructionShapeRefusal(ix, want);
    if (shape) return shape;
  }
  const fee = Number(b.nexus?.feeBps ?? 0);
  if (!Number.isInteger(fee) || fee < 0 || fee > MAX_FEE_BPS) return "Quote carries an unexpected fee — refused.";
  if (fee > 0 && !b.swapInstruction.accounts.some((a) => a?.pubkey === b.nexus?.feeAccount)) return "Fee doesn't go to Nexus's account — refused.";
  return null;
}
