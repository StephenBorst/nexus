// Sending FROM Solana into a 1Click deposit address. Quotes are REAL signed 1Click replies with a
// Solana origin (fetched 2026-11-05, no funds sent). @solana/web3.js (the app's pinned version) is the
// referee for encodings, ATA derivation and compiling, so these bytes are what the signer will sign.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  depositInstructions, checkSignedDeposit, checkDepositSim, SOL_ORIGINS, USDC_SOL_MINT, TOKEN_PROGRAM, ATA_PROGRAM,
  SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, SOL_FEE_BUDGET_LAMPORTS, MAX_CU_PRICE_MICROLAMPORTS,
} from "./solDeposit.mjs";
import { checkQuote, XC_ASSETS } from "./nearIntents.mjs";

const fx = (n) => JSON.parse(readFileSync(new URL(`./__fixtures__/${n}.json`, import.meta.url)));
const FROM_USDC = fx("oneclick-quote-from-sol-usdc"); // 20 USDC (Solana) → USDC Arbitrum
const FROM_SOL = fx("oneclick-quote-from-sol");       // 0.2 SOL → USDC Arbitrum
const SOL_USER = "6uB2ugTM4m7P1BpEG6pLAc2B327nb75JUqVE6svoMRWT";
const EVM_USER = "0x06cD9c281E6ab09906B46a10e059F2770EfdE49A";
const ata = (owner, mint = USDC_SOL_MINT) => PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(TOKEN_PROGRAM).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA_PROGRAM))[0].toBase58();
const toIx = (i) => new TransactionInstruction({ programId: new PublicKey(i.programId), keys: i.keys.map((x) => ({ ...x, pubkey: new PublicKey(x.pubkey) })), data: Buffer.from(i.data) });
const BLOCKHASH = "9sHcv6xwn9YkB8nxTUGKDwPwNnmqVp5oAXxU8Fdkm4J6";
const compile = (ixs, payer = SOL_USER) => new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(payer), recentBlockhash: BLOCKHASH, instructions: ixs.map(toIx) }).compileToV0Message());
const decode = (tx) => {
  const keys = tx.message.staticAccountKeys.map((p) => p.toBase58());
  return tx.message.compiledInstructions.map((ci) => ({ programId: keys[ci.programIdIndex], accounts: ci.accountKeyIndexes.map((i) => keys[i]), data: Uint8Array.from(ci.data) }));
};

test("the real Solana-origin quotes pass checkQuote with a Solana deposit address and refund address", () => {
  for (const [q, from] of [[FROM_USDC, "USDC.sol"], [FROM_SOL, "SOL.sol"]]) {
    const r = checkQuote(q, {
      originAsset: XC_ASSETS[from].assetId, destinationAsset: XC_ASSETS["USDC.arb"].assetId, amount: q.quoteRequest.amount,
      recipient: EVM_USER, refundTo: SOL_USER, originChain: "sol", maxSlippageBps: 100, deadline: q.quoteRequest.deadline, now: Date.parse(q.timestamp) + 60_000,
    });
    assert.equal(r.ok, true, `${from}: ${r.reason}`);
    assert.match(r.depositAddress, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  }
});

test("ATA derivation the signer uses matches a real on-chain account (borst's USDC account Fqqax7…wagKr)", () => {
  assert.equal(ata(SOL_USER), "Fqqax7ErDytQbsWRWoRuCodZ8oDx2NgWtzYz6AUwagKr");
});

test("SOL deposit = exactly web3.js's SystemProgram.transfer, nothing else", () => {
  const dep = FROM_SOL.quote.depositAddress;
  const ixs = depositInstructions({ assetKey: "SOL.sol", amount: 200_000_000n, from: SOL_USER, depositAddress: dep });
  assert.equal(ixs.length, 1);
  const ref = SystemProgram.transfer({ fromPubkey: new PublicKey(SOL_USER), toPubkey: new PublicKey(dep), lamports: 200_000_000n });
  assert.equal(ixs[0].programId, ref.programId.toBase58());
  assert.deepEqual(Buffer.from(ixs[0].data), ref.data);
  assert.deepEqual(ixs[0].keys, ref.keys.map((x) => ({ pubkey: x.pubkey.toBase58(), isSigner: x.isSigner, isWritable: x.isWritable })));
});

test("USDC deposit = create the deposit address's ATA (idempotent) + one TransferChecked of exactly the amount", () => {
  const dep = FROM_USDC.quote.depositAddress;
  const [create, transfer] = depositInstructions({ assetKey: "USDC.sol", amount: 20_000_000n, from: SOL_USER, depositAddress: dep, fromAta: ata(SOL_USER), depositAta: ata(dep) });
  assert.equal(create.programId, ATA_PROGRAM);
  assert.deepEqual([...create.data], [1]);
  assert.deepEqual(create.keys.map((x) => x.pubkey), [SOL_USER, ata(dep), dep, USDC_SOL_MINT, SYSTEM_PROGRAM, TOKEN_PROGRAM]);
  assert.deepEqual(create.keys.map((x) => [x.isSigner, x.isWritable]), [[true, true], [false, true], [false, false], [false, false], [false, false], [false, false]]);
  assert.equal(transfer.programId, TOKEN_PROGRAM);
  // 12 | 20_000_000 as u64 LE | decimals 6
  assert.deepEqual([...transfer.data], [12, 0x00, 0x2d, 0x31, 0x01, 0, 0, 0, 0, 6]);
  assert.deepEqual(transfer.keys.map((x) => [x.pubkey, x.isSigner, x.isWritable]), [[ata(SOL_USER), false, true], [USDC_SOL_MINT, false, false], [ata(dep), false, true], [SOL_USER, true, false]]);
});

test("depositInstructions refuses what it can't build safely", () => {
  const base = { assetKey: "USDC.sol", amount: 1n, from: SOL_USER, depositAddress: FROM_USDC.quote.depositAddress, fromAta: ata(SOL_USER), depositAta: ata(FROM_USDC.quote.depositAddress) };
  assert.throws(() => depositInstructions({ ...base, assetKey: "ETH.base" }), /unsupported/);
  assert.throws(() => depositInstructions({ ...base, amount: 0n }), /bad amount/);
  assert.throws(() => depositInstructions({ ...base, amount: 5 }), /bad amount/);
  assert.throws(() => depositInstructions({ ...base, depositAddress: SOL_USER }), /is the sender/);
  assert.throws(() => depositInstructions({ ...base, depositAddress: "0x1234" }), /bad deposit/);
  assert.throws(() => depositInstructions({ ...base, depositAta: base.fromAta }), /same token account/);
  assert.throws(() => depositInstructions({ ...base, amount: 1n << 64n }), /out of range/);
});

test("after signing: the compiled tx decodes back to exactly ours; a capped priority fee may be added, nothing else", () => {
  const dep = FROM_USDC.quote.depositAddress;
  const ours = depositInstructions({ assetKey: "USDC.sol", amount: 20_000_000n, from: SOL_USER, depositAddress: dep, fromAta: ata(SOL_USER), depositAta: ata(dep) });
  assert.equal(checkSignedDeposit(ours, decode(compile(ours))), null);
  const limit = { programId: COMPUTE_BUDGET_PROGRAM, keys: [], data: Uint8Array.from([2, 0x40, 0x0d, 0x03, 0x00]) };
  const price = (p) => ({ programId: COMPUTE_BUDGET_PROGRAM, keys: [], data: Uint8Array.from([3, ...(() => { const b = []; let x = p; for (let i = 0; i < 8; i++) { b.push(Number(x & 0xffn)); x >>= 8n; } return b; })()]) });
  assert.equal(checkSignedDeposit(ours, decode(compile([limit, price(100_000n), ...ours]))), null);
  assert.match(checkSignedDeposit(ours, decode(compile([price(MAX_CU_PRICE_MICROLAMPORTS + 1n), ...ours]))), /outsized priority fee/);
  // Tampering the wallet could do:
  const other = "So11111111111111111111111111111111111111112";
  const more = depositInstructions({ assetKey: "USDC.sol", amount: 20_000_001n, from: SOL_USER, depositAddress: dep, fromAta: ata(SOL_USER), depositAta: ata(dep) });
  assert.match(checkSignedDeposit(ours, decode(compile(more))), /changed/, "amount");
  const elsewhere = depositInstructions({ assetKey: "USDC.sol", amount: 20_000_000n, from: SOL_USER, depositAddress: FROM_SOL.quote.depositAddress, fromAta: ata(SOL_USER), depositAta: ata(FROM_SOL.quote.depositAddress) });
  assert.match(checkSignedDeposit(ours, decode(compile(elsewhere))), /changed/, "another deposit address");
  const extra = [...ours, ...depositInstructions({ assetKey: "SOL.sol", amount: 1n, from: SOL_USER, depositAddress: other })];
  assert.match(checkSignedDeposit(ours, decode(compile(extra))), /changed/, "an extra transfer");
  assert.match(checkSignedDeposit(ours, decode(compile([{ programId: COMPUTE_BUDGET_PROGRAM, keys: [], data: Uint8Array.from([1, 0, 0, 0, 0]) }, ...ours]))), /unexpected compute/);
  assert.match(checkSignedDeposit(ours, []), /empty/);
});

test("simulation: the deposit side gains the amount, USDC drops by no more than the amount, SOL only fees + rent", () => {
  const A = 20_000_000n, F = 1_000_000n;
  const ok = { assetKey: "USDC.sol", amount: A, solPre: 50_000_000n, solPost: 50_000_000n - F - 2_039_280n, depPre: 0n, depPost: A, fromTokPre: 30_000_000n, fromTokPost: 10_000_000n };
  assert.equal(checkDepositSim(ok), null);
  assert.match(checkDepositSim({ ...ok, depPost: A - 1n }), /doesn't deliver/);
  assert.match(checkDepositSim({ ...ok, fromTokPost: 9_999_999n }), /more USDC/);
  assert.match(checkDepositSim({ ...ok, solPost: 50_000_000n - SOL_FEE_BUDGET_LAMPORTS - 1n }), /more SOL/);
  for (const f of ["solPre", "solPost", "depPre", "depPost", "fromTokPre", "fromTokPost"]) assert.match(checkDepositSim({ ...ok, [f]: null }), /Couldn't verify/, f);
  const sol = { assetKey: "SOL.sol", amount: 200_000_000n, solPre: 1_000_000_000n, solPost: 1_000_000_000n - 200_000_000n - 5_000n, depPre: 0n, depPost: 200_000_000n };
  assert.equal(checkDepositSim(sol), null);
  assert.match(checkDepositSim({ ...sol, solPost: sol.solPost - SOL_FEE_BUDGET_LAMPORTS }), /more SOL/);
  assert.match(checkDepositSim({ ...sol, depPost: 199_999_999n }), /doesn't deliver/);
  assert.match(checkDepositSim({ ...sol, assetKey: "BTC.btc" }), /Bad deposit/);
});

test("the Solana origins are exactly SOL and USDC on Solana, matching XC_ASSETS", () => {
  assert.deepEqual(Object.keys(SOL_ORIGINS).sort(), ["SOL.sol", "USDC.sol"]);
  for (const key of Object.keys(SOL_ORIGINS)) {
    assert.equal(XC_ASSETS[key].chain, "sol");
    assert.equal(XC_ASSETS[key].decimals, SOL_ORIGINS[key].decimals);
  }
});

import { simErrorText } from "./solDeposit.mjs";
test("simErrorText: the failures seen on mainnet dry runs read in plain words", () => {
  assert.match(simErrorText({ InsufficientFundsForRent: { account_index: 1 } }, "SOL.sol"), /minimum for a new account/);
  assert.match(simErrorText({ InstructionError: [1, { Custom: 17 }] }, "USDC.sol"), /frozen/);
  assert.match(simErrorText({ InstructionError: [1, { Custom: 1 }] }, "USDC.sol"), /Not enough USDC/);
  assert.match(simErrorText({ InstructionError: [0, { Custom: 1 }] }, "SOL.sol"), /Not enough SOL/);
  assert.match(simErrorText("AccountNotFound", "SOL.sol"), /no SOL to pay/);
  assert.match(simErrorText({ InstructionError: [0, { Custom: 170 }] }, "SOL.sol"), /would fail on-chain/, "17 must not match 170");
  for (const e of [{ InsufficientFundsForRent: {} }, "AccountNotFound", { x: 1 }]) assert.match(simErrorText(e, "SOL.sol"), /Nothing was sent/);
});
