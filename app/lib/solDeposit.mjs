// NEAR Intents 1Click: sending FROM Solana. The pure half of app/pages/token/xcSolSend.ts (the one
// place this path signs), kept here so every rule is tested without a wallet or an RPC.
//
// A Solana deposit is one plain transfer to the deposit address checkQuote verified:
//   SOL       one System transfer of exactly the amount to the deposit address.
//   USDC      "create the deposit address's USDC account if it doesn't exist" (Associated Token
//             Account, idempotent) + one TransferChecked of exactly the amount into it. 1Click's
//             Solana deposit addresses are fresh owner accounts (checked live 2026-11-05: no account
//             at the address), so SPL goes to the owner's associated token account, the Solana norm.
// Built by US from pinned values (mint, programs, decimals), never from a response. Then, before the
// wallet sees it, a simulation of the exact bytes must show the deposit side gaining the amount, the
// user's USDC dropping by no more than the amount, and SOL dropping by no more than the amount (SOL
// deposits) plus fees and account rent. After signing, the wallet's bytes must still say what we
// built: only compute-budget instructions may be added, and their price is capped.

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const USDC_SOL_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// The Solana assets the card can SEND (keys match XC_ASSETS). USDC is a classic SPL mint.
export const SOL_ORIGINS = {
  "SOL.sol": { kind: "sol", decimals: 9, sym: "SOL" },
  "USDC.sol": { kind: "spl", decimals: 6, sym: "USDC", mint: USDC_SOL_MINT, tokenProgram: TOKEN_PROGRAM },
};
// Fees + a new associated token account's rent (~0.00204 SOL) + any wallet-added priority fee.
export const SOL_FEE_BUDGET_LAMPORTS = 10_000_000n; // 0.01 SOL
// A wallet may add a priority fee; anything pricier than this (µlamports per CU) is refused.
export const MAX_CU_PRICE_MICROLAMPORTS = 5_000_000n;

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const u64le = (v) => {
  const b = new Uint8Array(8);
  let x = BigInt(v);
  if (x < 0n || x >= 1n << 64n) throw new Error("amount out of range");
  for (let i = 0; i < 8; i++) { b[i] = Number(x & 0xffn); x >>= 8n; }
  return b;
};
const readU64le = (bytes, at) => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(bytes[at + i]);
  return v;
};
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const k = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

/**
 * The instructions for one deposit. Pure: the caller derives the two associated token accounts
 * (fromAta, depositAta) with PublicKey.findProgramAddressSync and passes them in.
 * @returns {{ programId: string, keys: {pubkey:string,isSigner:boolean,isWritable:boolean}[], data: Uint8Array }[]}
 */
export function depositInstructions({ assetKey, amount, from, depositAddress, fromAta, depositAta }) {
  const a = SOL_ORIGINS[assetKey];
  if (!a) throw new Error("unsupported Solana asset");
  if (!SOL_ADDR.test(from || "")) throw new Error("bad sender");
  if (!SOL_ADDR.test(depositAddress || "")) throw new Error("bad deposit address");
  if (from === depositAddress) throw new Error("deposit address is the sender");
  if (typeof amount !== "bigint" || amount <= 0n) throw new Error("bad amount");
  if (a.kind === "sol") {
    // SystemInstruction::Transfer = 2 (u32 LE), then lamports (u64 LE)
    return [{ programId: SYSTEM_PROGRAM, keys: [k(from, true, true), k(depositAddress, false, true)], data: cat(new Uint8Array([2, 0, 0, 0]), u64le(amount)) }];
  }
  if (!SOL_ADDR.test(fromAta || "") || !SOL_ADDR.test(depositAta || "")) throw new Error("bad token account");
  if (fromAta === depositAta) throw new Error("same token account");
  return [
    // AssociatedTokenAccountInstruction::CreateIdempotent = 1
    { programId: ATA_PROGRAM, keys: [k(from, true, true), k(depositAta, false, true), k(depositAddress, false, false), k(a.mint, false, false), k(SYSTEM_PROGRAM, false, false), k(a.tokenProgram, false, false)], data: new Uint8Array([1]) },
    // TokenInstruction::TransferChecked = 12, amount (u64 LE), decimals (u8)
    { programId: a.tokenProgram, keys: [k(fromAta, false, true), k(a.mint, false, false), k(depositAta, false, true), k(from, true, false)], data: cat(new Uint8Array([12]), u64le(amount), new Uint8Array([a.decimals])) },
  ];
}

const hex = (bytes) => Array.from(bytes || [], (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The wallet signed something: is it still exactly our deposit? `signed` = the signed message's
 * instructions decoded to { programId, accounts: string[], data: Uint8Array } (in order).
 * Our instructions must appear in the same order with the same programs, accounts and data; the only
 * extras allowed are compute-budget limit / price instructions, with the price capped.
 * @returns {string|null} null = ok, else the refusal
 */
export function checkSignedDeposit(ours, signed) {
  if (!Array.isArray(signed) || !signed.length) return "The wallet returned an empty transaction — not sending.";
  const rest = [];
  for (const ix of signed) {
    if (ix.programId === COMPUTE_BUDGET_PROGRAM) {
      const d = ix.data || new Uint8Array();
      if (d[0] === 2 && d.length === 5) continue;                       // SetComputeUnitLimit(u32)
      if (d[0] === 3 && d.length === 9) {                                // SetComputeUnitPrice(u64)
        if (readU64le(d, 1) > MAX_CU_PRICE_MICROLAMPORTS) return "The wallet added an outsized priority fee — not sending.";
        continue;
      }
      return "The wallet added an unexpected compute instruction — not sending.";
    }
    rest.push(ix);
  }
  if (rest.length !== ours.length) return "The wallet changed the transaction — not sending.";
  for (let i = 0; i < ours.length; i++) {
    const a = ours[i], b = rest[i];
    if (a.programId !== b.programId) return "The wallet changed the transaction — not sending.";
    const accts = a.keys.map((x) => x.pubkey);
    if (accts.length !== (b.accounts || []).length || accts.some((p, j) => p !== b.accounts[j])) return "The wallet changed the transaction — not sending.";
    if (hex(a.data) !== hex(b.data)) return "The wallet changed the transaction — not sending.";
  }
  return null;
}

const big = (v) => {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  return null;
};

/**
 * What the simulation of the exact bytes must show. All balances in base units; `null` = unreadable
 * (fails closed). A missing account before = 0 (pass 0n).
 *   solPre/solPost       the sender's lamports
 *   depPre/depPost       SOL: the deposit address's lamports · USDC: the deposit ATA's token amount
 *   fromTokPre/Post      USDC only: the sender's token account
 * @returns {string|null} null = ok, else the refusal
 */
export function checkDepositSim({ assetKey, amount, solPre, solPost, depPre, depPost, fromTokPre, fromTokPost }) {
  const a = SOL_ORIGINS[assetKey];
  const amt = big(amount);
  if (!a || amt == null || amt <= 0n) return "Bad deposit — refused.";
  const sp = big(solPre), sq = big(solPost), dp = big(depPre), dq = big(depPost);
  if (sp == null || sq == null || dp == null || dq == null) return "Couldn't verify the simulated balances — not signing.";
  if (dq - dp < amt) return "The simulation doesn't deliver the full amount to the deposit address — refused.";
  const solDrop = sp - sq;
  const solAllowed = (a.kind === "sol" ? amt : 0n) + SOL_FEE_BUDGET_LAMPORTS;
  if (solDrop > solAllowed) return "The transaction would move more SOL than the deposit — refused.";
  if (a.kind === "spl") {
    const fp = big(fromTokPre), fq = big(fromTokPost);
    if (fp == null || fq == null) return "Couldn't verify what this spends — not signing.";
    if (fp - fq > amt) return "The transaction would spend more USDC than you typed — refused.";
  }
  return null;
}

// A failed simulation, in words (seen on mainnet dry runs, 2026-11-05): a SOL amount below what a
// brand-new account must hold (InsufficientFundsForRent on the deposit address), a USDC account its
// issuer has frozen (SPL Token custom error 17), or plain not-enough funds.
export function simErrorText(err, assetKey) {
  const s = (() => { try { return JSON.stringify(err); } catch { return String(err); } })();
  if (/InsufficientFundsForRent/.test(s)) return "That amount is below Solana’s minimum for a new account (about 0.001 SOL). Send a little more. Nothing was sent.";
  if (/"Custom":17\b/.test(s)) return "Your USDC account is frozen by its issuer, so it can’t send. Nothing was sent.";
  if (/"Custom":1\b|InsufficientFunds/.test(s)) return SOL_ORIGINS[assetKey]?.kind === "spl" ? "Not enough USDC (or SOL for fees) in your wallet. Nothing was sent." : "Not enough SOL for the amount plus fees. Nothing was sent.";
  if (/AccountNotFound/.test(s)) return "Your wallet has no SOL to pay the network fee. Nothing was sent.";
  return "The transfer would fail on-chain — not signing. Nothing was sent.";
}
