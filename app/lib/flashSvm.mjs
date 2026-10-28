// ── Flash orders on Solana: what a quote must prove before the wallet signs (pure, tested) ────────
// A Solana Flash order takes two wallet actions (Flash docs, "Solana Overview"):
//   1. an on-chain SPL Approve: the Flash program becomes delegate over the spent token's account
//      (svm.delegateIx), plus idempotent "create my token account" instructions when one is missing
//      (svm.ataSetupIxs). We build this transaction OURSELVES from checked instructions; Flash's
//      prebuilt setupTxs / sponsoredDelegateTx are never signed (opaque bytes).
//   2. an off-chain Ed25519 signature over svm.orderMessage = "DFS|m=<input mint>|t=<total>|h=<hash>",
//      h = base58(SHA256("DFS_ORDER_V1" ‖ outputATA ‖ nonce u64LE ‖ deadline i64LE ‖ inputATA ‖
//      FLASH program ‖ our Definitive trading group)[0:16]).
// The hash is the ONLY thing that binds the order's OUTPUT to the user's own token account. So the
// check needs our trading group id (from Definitive); without it, signing is refused (fail closed).
// Exact-amount and recipient checks mirror the EVM ticket (flashGuards.mjs).

export const FLASH_SVM_PROGRAM = "FLaSHxRVv6G1NCJ2SFGPvQqKUPszuDjaTkBMFCSzEqpJ";
// The delegate Flash's Approve names, read from a real quote (2026-10-28). Pinned like FLASH_ALLOWANCE
// on EVM: an Approve to anything else is refused.
export const FLASH_SVM_DELEGATE = "3jBWeQrnfEhw5LY53hwcoYKQJsrTUbtLbmGrNYCr1Fiq";
export const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const MAX_SVM_MARKET_DEADLINE_S = 3600;

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s;
}
export function b58decode(str) {
  if (typeof str !== "string" || !str || /[^1-9A-HJ-NP-Za-km-z]/.test(str)) return null;
  let n = 0n;
  for (const c of str) n = n * 58n + BigInt(ALPHABET.indexOf(c));
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of str) { if (c === "1") out.unshift(0); else break; }
  return Uint8Array.from(out);
}
const key32 = (s) => { const b = b58decode(s); return b && b.length === 32 ? b : null; };

/** "DFS|m=<mint>|t=<total>|h=<hash>" → parts, or null. */
export function parseOrderMessage(msg) {
  const m = /^DFS\|m=([1-9A-HJ-NP-Za-km-z]{32,44})\|t=(\d{1,20})\|h=([1-9A-HJ-NP-Za-km-z]{10,30})$/.exec(String(msg || ""));
  return m ? { mint: m[1], total: m[2], hash: m[3] } : null;
}

/** The order hash, as Flash defines it. Async (WebCrypto SHA-256). null on a bad input. */
export async function orderHash({ outputAta, inputAta, nonce, deadline, group, program = FLASH_SVM_PROGRAM }) {
  const out = key32(outputAta), inp = key32(inputAta), prog = key32(program), grp = key32(group);
  if (!out || !inp || !prog || !grp || !/^\d+$/.test(String(nonce)) || !/^-?\d+$/.test(String(deadline))) return null;
  const buf = new Uint8Array(12 + 32 + 8 + 8 + 32 + 32 + 32);
  const dv = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode("DFS_ORDER_V1"), 0);
  buf.set(out, 12);
  dv.setBigUint64(44, BigInt(nonce), true);
  dv.setBigInt64(52, BigInt(deadline), true);
  buf.set(inp, 60); buf.set(prog, 92); buf.set(grp, 124);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return b58encode(digest.subarray(0, 16));
}

/** An SPL Approve (tag 4) → { source, delegate, owner, amount } or null. */
export function parseApprove(ix) {
  if (!ix || (ix.programId !== SPL_TOKEN && ix.programId !== TOKEN_2022)) return null;
  const data = b58decode(ix.data);
  if (!data || data.length !== 9 || data[0] !== 4) return null;
  let amount = 0n;
  for (let i = 8; i >= 1; i--) amount = (amount << 8n) | BigInt(data[i]);
  const a = ix.accounts || [];
  if (a.length !== 3) return null;
  return { source: a[0].pubkey, delegate: a[1].pubkey, owner: a[2].pubkey, ownerSigns: !!a[2].isSigner, amount };
}

/**
 * Check a Flash quote for a Solana order before ANY signature.
 * @param {object} q        Flash QuoteResponse
 * @param {{ wallet: string, inputMint: string, outputMint: string, total: bigint | string,
 *           inputAta: string, outputAta: string, group: string, orderType: string, nowS: number,
 *           maxApprove: bigint }} e
 *   total = what the user typed, in the spent token's base units. inputAta / outputAta = the wallet's
 *   associated token accounts (derived by the caller with each mint's own token program).
 *   maxApprove = the most the delegation may cover (this order + the wallet's open orders on that token).
 * @returns {Promise<string | null>} null = ok, else why it's refused
 */
export async function checkSvmQuote(q, e) {
  const s = q?.svm;
  if (!s || q.evm) return "Not a Solana quote — refused.";
  if (q.wrap) return "Native SOL isn't supported here — refused.";
  if (s.sponsoredDelegateTx) return "Flash sent a pre-built transaction; this ticket only signs instructions it checks — refused.";
  if (!e?.group || !key32(e.group)) return "Solana orders aren't switched on yet (trading group not set).";
  const msg = parseOrderMessage(s.orderMessage);
  if (!msg) return "Unreadable order message — refused.";
  if (msg.mint !== e.inputMint) return "The order spends a different token — refused.";
  if (msg.total !== String(e.total)) return "The order spends a different amount than you typed — refused.";
  const h = await orderHash({ outputAta: e.outputAta, inputAta: e.inputAta, nonce: s.nonce, deadline: s.deadline, group: e.group });
  if (!h || h !== msg.hash) return "The order doesn't pay out to your own token account — refused.";
  const dl = Number(s.deadline);
  if (!Number.isFinite(dl) || dl <= e.nowS) return "The order has already expired — refresh the quote.";
  if (e.orderType === "market" && dl > e.nowS + MAX_SVM_MARKET_DEADLINE_S) return "A market order that lives that long — refused.";
  if (s.delegateIx) {
    const ap = parseApprove(s.delegateIx);
    if (!ap) return "Unexpected delegation instruction — refused.";
    if (ap.source !== e.inputAta) return "The delegation is on another account — refused.";
    if (ap.owner !== e.wallet || !ap.ownerSigns) return "The delegation isn't from your wallet — refused.";
    if (ap.delegate !== FLASH_SVM_DELEGATE) return "The delegation names an unknown spender — refused.";
    if (ap.amount < BigInt(e.total)) return "The delegation doesn't cover the order — refused.";
    if (ap.amount > BigInt(e.maxApprove)) return "The delegation is larger than this order plus your open orders — refused.";
  }
  for (const ix of s.ataSetupIxs || []) {
    if (ix?.programId !== ATA_PROGRAM) return "Unexpected setup instruction — refused.";
    const data = ix.data ? b58decode(ix.data) : new Uint8Array(0); // Create = no data, CreateIdempotent = [1]
    if (!data || !(data.length === 0 || (data.length === 1 && data[0] === 1))) return "Unexpected setup instruction — refused.";
    const a = (ix.accounts || []).map((x) => x.pubkey);
    // create-associated-token-account: [payer, ata, owner, mint, system, token program]
    if (a.length !== 6 || a[0] !== e.wallet || a[2] !== e.wallet || a[4] !== SYSTEM_PROGRAM || (a[5] !== SPL_TOKEN && a[5] !== TOKEN_2022)) return "Setup creates an account you wouldn't own — refused.";
    const ok = (a[3] === e.inputMint && a[1] === e.inputAta) || (a[3] === e.outputMint && a[1] === e.outputAta);
    if (!ok) return "Setup creates an account for another token — refused.";
  }
  return null;
}
