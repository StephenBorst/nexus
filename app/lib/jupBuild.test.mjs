import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkBuild, cuPriceOf, cuLimitData, cuPriceData, coreInstructions, CU_PRICE_MAX, PRICE_TAKER } from "./jupBuild.mjs";

// Real /build replies through our proxy (2026-10-31, public test wallet, nothing signed), with the
// worker's `nexus` fee echo: a USDC → JUP buy (our fee on) and a SOL → JUP buy (no fee mint).
const BUY = JSON.parse(readFileSync(new URL("./__fixtures__/jup-build-buy.json", import.meta.url)));
const SOLBUY = JSON.parse(readFileSync(new URL("./__fixtures__/jup-build-solbuy.json", import.meta.url)));
const W = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const SOL = "So11111111111111111111111111111111111111112";
const want = { inputMint: USDC, outputMint: JUP, inAmount: 500000, slippageBps: 100, taker: W };
const clone = (o) => JSON.parse(JSON.stringify(o));

test("the real replies pass", () => {
  assert.equal(checkBuild(BUY, want), null);
  assert.equal(checkBuild(SOLBUY, { ...want, inputMint: SOL, inAmount: 10000000 }), null);
});

test("quote binding: mints, amount, mode, slippage, minimum", () => {
  assert.match(checkBuild(BUY, { ...want, outputMint: USDC }), /output mismatch/);
  assert.match(checkBuild(BUY, { ...want, inputMint: JUP }), /input mismatch/);
  assert.match(checkBuild(BUY, { ...want, inAmount: 500001 }), /amount mismatch/);
  assert.match(checkBuild(BUY, { ...want, slippageBps: 50 }), /widened slippage/);
  assert.match(checkBuild({ ...clone(BUY), swapMode: "ExactOut" }, want), /swap mode/);
  assert.ok(checkBuild({ ...clone(BUY), otherAmountThreshold: "1" }, want), "a floor wider than the slippage asked");
});

test("only the wallet signs; no tip; v0; a blockhash", () => {
  const b = clone(BUY);
  b.setupInstructions[0].accounts.push({ pubkey: "Attacker1111111111111111111111111111111111", isSigner: true, isWritable: true });
  assert.match(checkBuild(b, want), /another account to sign/);
  assert.match(checkBuild({ ...clone(BUY), tipInstruction: BUY.swapInstruction }, want), /tip/);
  assert.match(checkBuild({ ...clone(BUY), transactionVersion: 1 }, want), /version/);
  assert.match(checkBuild({ ...clone(BUY), blockhashWithMetadata: null }, want), /blockhash/);
  assert.match(checkBuild(null, want), /No Jupiter route/);
});

test("our fee: capped, and our account must be in the swap instruction", () => {
  assert.match(checkBuild({ ...clone(BUY), nexus: { feeBps: 101, feeAccount: BUY.nexus.feeAccount } }, want), /unexpected fee/);
  assert.match(checkBuild({ ...clone(BUY), nexus: { feeBps: 10, feeAccount: "Attacker1111111111111111111111111111111111" } }, want), /Nexus's account/);
  assert.equal(checkBuild({ ...clone(BUY), nexus: undefined }, want), null, "no echo = no fee claimed");
});

test("compute budget: price only, clamped; limit and price encode like ComputeBudgetProgram", () => {
  assert.equal(cuPriceOf(BUY), 200n, "the fixture's own price");
  const spike = clone(BUY);
  spike.computeBudgetInstructions = [{ programId: "ComputeBudget111111111111111111111111111111", accounts: [], data: cuPriceData(10n ** 12n) }];
  assert.equal(cuPriceOf(spike), CU_PRICE_MAX);
  const limit = clone(BUY);
  limit.computeBudgetInstructions = [{ programId: "ComputeBudget111111111111111111111111111111", accounts: [], data: cuLimitData(1_400_000) }];
  assert.match(checkBuild(limit, want), /compute budget/);
  const sneaky = clone(BUY);
  sneaky.otherInstructions = [{ programId: "ComputeBudget111111111111111111111111111111", accounts: [], data: cuLimitData(5) }];
  assert.match(checkBuild(sneaky, want), /compute budget/);
  // Byte layout = web3.js ComputeBudgetProgram (tag 2 + u32 LE / tag 3 + u64 LE).
  assert.deepEqual([...Buffer.from(cuLimitData(206511), "base64")], [2, ...(() => { const b = Buffer.alloc(4); b.writeUInt32LE(206511); return b; })()]);
  assert.deepEqual([...Buffer.from(cuPriceData(510n), "base64")], [3, ...(() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(510n); return b; })()]);
});

test("core instructions: setup, swap, cleanup, other — in that order, no compute budget", () => {
  const ixs = coreInstructions(SOLBUY);
  assert.equal(ixs.length, SOLBUY.setupInstructions.length + 1 + (SOLBUY.cleanupInstruction ? 1 : 0) + SOLBUY.otherInstructions.length);
  assert.equal(ixs[SOLBUY.setupInstructions.length], SOLBUY.swapInstruction);
});

test("the price-read taker is a 32-byte key", () => {
  assert.match(PRICE_TAKER, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
});
