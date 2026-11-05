// ── Cross-chain FROM Solana · the ONE place the 1Click Solana deposit signs ─────────────────────────
// CrossChainCard verifies the quote first (checkQuote: 1Click's signature, our recipient + refund
// address, pinned assets, exact amount, our own deadline). This file only moves the money, and only
// after proving, on the exact bytes, that the transaction does nothing but the deposit:
//   1. build: depositInstructions (app/lib/solDeposit.mjs) from pinned values; ATAs derived here.
//      SOL = one System transfer · USDC = ATA create-idempotent + one TransferChecked. Payer = wallet.
//   2. static: v0, no lookup tables, payer is the wallet, only System / SPL Token / ATA programs.
//   3. simulate the exact bytes through /sol/rpc (sigVerify off) and check from the simulated
//      balances (checkDepositSim): deposit side gains the amount, USDC drops ≤ the amount, SOL drops
//      ≤ the amount (SOL deposits) + fees/rent. Every read fails CLOSED.
//   4. sign: the wallet's signed bytes must still decode to our instructions (checkSignedDeposit;
//      only a capped priority fee may be added) and the payer must be unchanged; then WE send them.
//      A wallet that can only sendTransaction gets the same bytes, checked before it sees them.
//   5. confirm by polling (pollConfirm); a timeout is "submitted, not confirmed", never success.
import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { depositInstructions, checkSignedDeposit, checkDepositSim, simErrorText, SOL_ORIGINS, ATA_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM } from "@/lib/solDeposit.mjs";
import { tokenAccountAmount } from "@/lib/solSwapGuards.mjs";
import { solRpcCall, pollConfirm, type SolProvider } from "./solSwapExec";

type Ix = ReturnType<typeof depositInstructions>[number];
export type SolOriginKey = keyof typeof SOL_ORIGINS;
const ALLOWED = new Set([SYSTEM_PROGRAM, TOKEN_PROGRAM, ATA_PROGRAM]);
const isSolAddr = (a: unknown): a is string => typeof a === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);

export function associatedTokenAccount(owner: string, mint: string, tokenProgram: string): string {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey(ATA_PROGRAM),
  )[0].toBase58();
}

const toIx = (i: Ix) => new TransactionInstruction({
  programId: new PublicKey(i.programId),
  keys: i.keys.map((x) => ({ pubkey: new PublicKey(x.pubkey), isSigner: x.isSigner, isWritable: x.isWritable })),
  data: Buffer.from(i.data),
});

function decode(tx: VersionedTransaction) {
  const keys = tx.message.staticAccountKeys.map((p) => p.toBase58());
  return tx.message.compiledInstructions.map((ci) => ({ programId: keys[ci.programIdIndex], accounts: ci.accountKeyIndexes.map((i) => keys[i]), data: Uint8Array.from(ci.data) }));
}

// Step 2 on the compiled (or signed) bytes.
function staticGuard(tx: VersionedTransaction, from: string, allowCompute: boolean): void {
  if (tx.message.addressTableLookups.length) throw new Error("The transaction uses lookup tables — not signing.");
  if (!tx.message.staticAccountKeys[0]?.equals(new PublicKey(from))) throw new Error("The transaction isn't paid by your wallet — not signing.");
  for (const ix of decode(tx)) {
    if (ALLOWED.has(ix.programId)) continue;
    if (allowCompute && ix.programId === COMPUTE_BUDGET_PROGRAM) continue;
    throw new Error("The transaction touches an unexpected program — not signing.");
  }
}

type Acct = { lamports?: number; data?: [string, string] | string[] } | null;
const lamportsOf = (a: Acct): bigint | null => (a == null ? 0n : typeof a.lamports === "number" ? BigInt(a.lamports) : null);
const tokenOf = (a: Acct): bigint | null => (a == null ? 0n : tokenAccountAmount(Array.isArray(a.data) ? a.data[0] : ""));

async function readAccounts(addresses: string[], commitment = "processed"): Promise<Acct[]> {
  const r = (await solRpcCall("getMultipleAccounts", [addresses, { encoding: "base64", commitment }])) as { value?: Acct[] } | null;
  if (!r || !Array.isArray(r.value) || r.value.length !== addresses.length) throw new Error("unreadable");
  return r.value;
}

/**
 * Send `amount` (base units) of SOL or USDC from the connected Solana wallet to a deposit address
 * checkQuote already verified. Throws a plain message on any refusal; nothing is signed until every
 * check passes. Returns the signature and whether it confirmed in time.
 */
export async function sendSolDeposit(
  provider: SolProvider,
  args: { assetKey: SolOriginKey; amount: bigint; from: string; depositAddress: string },
  onStep: (s: string) => void = () => {},
): Promise<{ sig: string; confirmed: boolean }> {
  const { assetKey, amount, from, depositAddress } = args;
  const a = SOL_ORIGINS[assetKey];
  if (!a) throw new Error("Unsupported Solana asset.");
  if (!isSolAddr(from)) throw new Error("Connect a Solana wallet to send from Solana.");
  if (!isSolAddr(depositAddress)) throw new Error("The deposit address isn't a Solana address — not sending.");
  if (typeof provider?.signTransaction !== "function" && typeof provider?.sendTransaction !== "function")
    throw new Error("Your wallet can't sign a Solana transaction here.");

  const spl = a.kind === "spl" ? (a as { mint: string; tokenProgram: string }) : null;
  const fromAta = spl ? associatedTokenAccount(from, spl.mint, spl.tokenProgram) : undefined;
  const depositAta = spl ? associatedTokenAccount(depositAddress, spl.mint, spl.tokenProgram) : undefined;
  const ours = depositInstructions({ assetKey, amount, from, depositAddress, fromAta, depositAta });

  onStep("preparing the transfer…");
  let blockhash: string;
  try {
    const r = (await solRpcCall("getLatestBlockhash", [{ commitment: "confirmed" }])) as { value?: { blockhash?: string } } | null;
    if (!r?.value?.blockhash) throw new Error("no blockhash");
    blockhash = r.value.blockhash;
  } catch { throw new Error("Couldn't reach Solana — try again. Nothing was sent."); }
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(from), recentBlockhash: blockhash, instructions: ours.map(toIx) }).compileToV0Message());
  staticGuard(tx, from, false);
  if (tx.serialize().length > 1232) throw new Error("Transaction too large — not signing.");

  // Step 3: simulate the exact bytes and check the balances it would leave.
  onStep("simulating…");
  const depTarget = spl ? (depositAta as string) : depositAddress;
  const watch = spl ? [from, depTarget, fromAta as string] : [from, depTarget];
  let pre: Acct[];
  try { pre = await readAccounts(watch); } catch { throw new Error("Couldn't read your balances — not signing."); }
  let sim: { err?: unknown; accounts?: Acct[] } | null;
  try {
    const r = (await solRpcCall("simulateTransaction", [Buffer.from(tx.serialize()).toString("base64"), {
      encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: "processed",
      accounts: { encoding: "base64", addresses: watch },
    }])) as { value?: { err?: unknown; accounts?: Acct[] } } | null;
    sim = r?.value ?? null;
  } catch { throw new Error("Simulation failed to run — not signing."); }
  if (!sim) throw new Error("Simulation failed to run — not signing.");
  if (sim.err) throw new Error(simErrorText(sim.err, assetKey));
  const after = sim.accounts ?? [];
  if (after.length !== watch.length) throw new Error("Simulation didn't return your balances — not signing.");
  const simErr = checkDepositSim({
    assetKey, amount,
    solPre: lamportsOf(pre[0]), solPost: lamportsOf(after[0]),
    depPre: spl ? tokenOf(pre[1]) : lamportsOf(pre[1]), depPost: spl ? tokenOf(after[1]) : lamportsOf(after[1]),
    fromTokPre: spl ? tokenOf(pre[2]) : undefined, fromTokPost: spl ? tokenOf(after[2]) : undefined,
  });
  if (simErr) throw new Error(simErr);

  // Step 4: sign, re-check the signed bytes, send them ourselves.
  onStep("confirm the transfer in your wallet…");
  let sig: string;
  if (typeof provider.signTransaction === "function") {
    const signed = await provider.signTransaction(tx);
    if (!(signed instanceof VersionedTransaction)) throw new Error("The wallet returned an unexpected object — not sending.");
    staticGuard(signed, from, true);
    const changed = checkSignedDeposit(ours, decode(signed));
    if (changed) throw new Error(changed);
    onStep("submitting…");
    try {
      sig = (await solRpcCall("sendTransaction", [Buffer.from(signed.serialize()).toString("base64"), { encoding: "base64", skipPreflight: false, preflightCommitment: "processed", maxRetries: 3 }])) as string;
    } catch (e) { throw new Error(`Solana didn't accept the transfer: ${(e as Error)?.message || "unknown"}. Nothing was sent.`); }
  } else {
    onStep("submitting…");
    sig = await provider.sendTransaction!(tx);
  }
  if (typeof sig !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) throw new Error("The wallet didn't return a signature. Check your wallet before retrying.");

  onStep("confirming on Solana…");
  const confirmed = await pollConfirm(sig, 60000);
  return { sig, confirmed };
}
