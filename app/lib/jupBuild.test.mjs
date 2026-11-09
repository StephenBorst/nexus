import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkBuild, cuPriceOf, cuLimitData, cuPriceData, coreInstructions, CU_PRICE_MAX, PRICE_TAKER, instructionShapeRefusal, altClaimRefusal, JUPITER_V6, SYSTEM, TOKEN, TOKEN_2022, ATA } from "./jupBuild.mjs";
import { PublicKey } from "@solana/web3.js";

// Real /build replies through our proxy (2026-10-31, public test wallet, nothing signed), with the
// worker's `nexus` fee echo: a USDC → JUP buy (our fee on) and a SOL → JUP buy (no fee mint).
const BUY = JSON.parse(readFileSync(new URL("./__fixtures__/jup-build-buy.json", import.meta.url)));
const SOLBUY = JSON.parse(readFileSync(new URL("./__fixtures__/jup-build-solbuy.json", import.meta.url)));
const W = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const SOL = "So11111111111111111111111111111111111111112";
// The wallet's associated wSOL account, derived with web3.js as the referee (= the fixture's wrap target).
const WSOL_ATA = PublicKey.findProgramAddressSync([new PublicKey(W).toBuffer(), new PublicKey(TOKEN).toBuffer(), new PublicKey(SOL).toBuffer()], new PublicKey(ATA))[0].toBase58();
const want = { inputMint: USDC, outputMint: JUP, inAmount: 500000, slippageBps: 100, taker: W, wsolAta: WSOL_ATA };
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

// ── instruction shapes: what the balance-only simulation can't see ──────────────────────────────
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return [...b]; };
const ATTACKER = "FcXv9qY6XWm2JYU12TcNAXgUpghjLKv3MQNUNZhyZBrx"; // a fresh key nobody holds
const acct = (pubkey, isSigner = false, isWritable = true) => ({ pubkey, isSigner, isWritable });
const withSetup = (base, ix) => { const b = clone(base); b.setupInstructions = [...b.setupInstructions, ix]; return b; };
const usdcAta = BUY.swapInstruction.accounts[1].pubkey; // an account of the wallet's the swap writes

test("the wSOL account the real SOL buy wraps into is the one we derive", () => {
  assert.equal(WSOL_ATA, "8LjUgMjzZuHj8VdyxzkmLLQVmW4C3gd56md1nLd76TNW");
  assert.equal(SOLBUY.setupInstructions[1].accounts[1].pubkey, WSOL_ATA);
  assert.equal(checkBuild(BUY, { ...want, wsolAta: undefined }) !== null, true, "no derived account = refused, never skipped");
});

test("every instruction in the real replies has an allowed shape", () => {
  for (const b of [BUY, SOLBUY]) for (const ix of coreInstructions(b)) assert.equal(instructionShapeRefusal(ix, want), null, ix.programId);
});

test("an instruction that hands over control without moving a balance is refused", () => {
  const sign = acct(W, true, false);
  const attacks = {
    "SPL Approve (delegate takes the USDC later)": { programId: TOKEN, accounts: [acct(usdcAta), acct(ATTACKER, false, false), sign], data: b64([4, ...u64(2n ** 64n - 1n)]) },
    "SPL ApproveChecked": { programId: TOKEN, accounts: [acct(usdcAta), acct(USDC, false, false), acct(ATTACKER, false, false), sign], data: b64([13, ...u64(1e12), 6]) },
    "SPL SetAuthority (token account changes owner)": { programId: TOKEN, accounts: [acct(usdcAta), sign], data: b64([6, 2, 1, ...new PublicKey(W).toBytes()]) },
    "SPL Transfer out": { programId: TOKEN, accounts: [acct(usdcAta), acct(ATTACKER), sign], data: b64([3, ...u64(1)]) },
    "Token-2022 anything": { programId: TOKEN_2022, accounts: [acct(usdcAta), acct(ATTACKER, false, false), sign], data: b64([4, ...u64(1)]) },
    "System Assign (wallet owned by another program)": { programId: SYSTEM, accounts: [acct(W, true, true)], data: b64([1, 0, 0, 0, ...new PublicKey(ATTACKER).toBytes()]) },
    "System Transfer to someone else": { programId: SYSTEM, accounts: [acct(W, true, true), acct(ATTACKER)], data: b64([2, 0, 0, 0, ...u64(1e6)]) },
    "CloseAccount to someone else": { programId: TOKEN, accounts: [acct(WSOL_ATA), acct(ATTACKER), sign], data: b64([9]) },
    "CloseAccount of another account": { programId: TOKEN, accounts: [acct(usdcAta), acct(W), sign], data: b64([9]) },
    "SyncNative on another account": { programId: TOKEN, accounts: [acct(usdcAta)], data: b64([17]) },
    "ATA created for someone else": { programId: ATA, accounts: [acct(W, true, true), acct(ATTACKER), acct(ATTACKER, false, false), acct(JUP, false, false), acct(SYSTEM, false, false), acct(TOKEN, false, false)], data: b64([1]) },
    "ATA RecoverNested": { programId: ATA, accounts: BUY.setupInstructions[0].accounts, data: b64([2]) },
    "an unknown program": { programId: ATTACKER, accounts: [], data: b64([]) },
  };
  for (const [name, ix] of Object.entries(attacks)) {
    assert.ok(instructionShapeRefusal(ix, want), `${name}: shape`);
    assert.ok(checkBuild(withSetup(BUY, ix), want), `${name}: checkBuild`);
    const cleanup = clone(BUY); cleanup.otherInstructions = [ix];
    assert.ok(checkBuild(cleanup, want), `${name}: in otherInstructions too`);
  }
  // the swap itself must be Jupiter's program
  const fake = clone(BUY); fake.swapInstruction.programId = ATTACKER;
  assert.match(checkBuild(fake, want), /unexpected program/);
  assert.equal(instructionShapeRefusal({ programId: JUPITER_V6, accounts: [], data: "" }, want), null);
});

test("lookup tables: the reply's claim must match the chain, index for index", () => {
  const claimed = { T1: ["a", "b"], T2: ["c"] };
  assert.equal(altClaimRefusal(claimed, { T1: ["a", "b"], T2: ["c"] }), null);
  assert.equal(altClaimRefusal(claimed, { T1: ["a", "b", "x"], T2: ["c", "d"] }), null, "tables only grow: a prefix is the same table");
  assert.match(altClaimRefusal(claimed, { T1: ["a", "EVIL"], T2: ["c"] }), /doesn't match/);
  assert.match(altClaimRefusal(claimed, { T1: ["a"], T2: ["c"] }), /doesn't match/, "claims more than the chain holds");
  assert.match(altClaimRefusal(claimed, { T1: ["a", "b"], T2: null }), /Couldn't verify/, "unreadable = not signing");
  assert.match(altClaimRefusal(claimed, { T1: ["a", "b"] }), /Couldn't verify/);
  assert.equal(altClaimRefusal(null, {}), null);
  assert.equal(altClaimRefusal({}, {}), null);
});

test("the signer passes the derived wSOL account and checks the tables before it assembles anything", () => {
  const src = readFileSync(new URL("../pages/token/solSwapExec.ts", import.meta.url), "utf8");
  const q = src.slice(src.indexOf("async function quoteAndBuildGuarded("), src.indexOf("async function ownedTokenAccounts("));
  assert.match(q, /checkBuild\(build, \{ inputMint, outputMint, inAmount, slippageBps, taker, wsolAta \}\)/);
  const alt = q.indexOf("altClaimRefusal(build.addressesByLookupTableAddress, await onchainTables(");
  const compile = q.indexOf("compileBuild(build, taker, CU_LIMIT_MAX)");
  assert.ok(alt > 0 && compile > alt, "tables verified before the first compile");
  assert.match(q, /altClaimRefusal\([^\n]*\);\n\s*if \(altErr\) throw new Error\(altErr\);/, "a mismatch stops the swap");
  assert.match(src, /owner !== "AddressLookupTab1e1111111111111111111111111"/, "only a real lookup-table account counts");
});
