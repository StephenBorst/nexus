import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { b58encode, b58decode, parseOrderMessage, orderHash, parseApprove, checkSvmQuote, FLASH_SVM_PROGRAM, FLASH_SVM_DELEGATE, ATA_PROGRAM, SPL_TOKEN, SYSTEM_PROGRAM } from "./flashSvm.mjs";

const REAL = JSON.parse(readFileSync(new URL("./__fixtures__/flash-svm-quote.json", import.meta.url)));
const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const IN_ATA = "FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B"; // the wallet's USDC account (the real Approve's source)
const OUT_ATA = "Fqqax7ErDytQbsWRWoRuCodZ8oDx2NgWtzYz6AUwagKr"; // any 32-byte key works for the synthetic hashes
const GROUP = "So11111111111111111111111111111111111111112";

// Independent reference: Flash's documented formula with node:crypto + Buffer.
function refHash({ outputAta, inputAta, nonce, deadline, group }) {
  const u64 = Buffer.alloc(8); u64.writeBigUInt64LE(BigInt(nonce));
  const i64 = Buffer.alloc(8); i64.writeBigInt64LE(BigInt(deadline));
  const d = createHash("sha256").update(Buffer.concat([Buffer.from("DFS_ORDER_V1"), Buffer.from(b58decode(outputAta)), u64, i64, Buffer.from(b58decode(inputAta)), Buffer.from(b58decode(FLASH_SVM_PROGRAM)), Buffer.from(b58decode(group))])).digest();
  return b58encode(d.subarray(0, 16));
}

test("base58 round-trips, keeps leading zeros", () => {
  for (const s of [WALLET, USDC, SYSTEM_PROGRAM, "1112"]) assert.equal(b58encode(b58decode(s)), s);
  assert.equal(b58decode("0OIl"), null);
});

test("order message parses strictly", () => {
  assert.deepEqual(parseOrderMessage(REAL.svm.orderMessage), { mint: USDC, total: "500000", hash: REAL.svm.orderMessage.split("h=")[1] });
  assert.equal(parseOrderMessage("DFS|m=x|t=1|h=abc"), null);
  assert.equal(parseOrderMessage(REAL.svm.orderMessage + "|extra"), null);
});

test("orderHash matches an independent implementation of Flash's formula", async () => {
  const args = { outputAta: OUT_ATA, inputAta: IN_ATA, nonce: "571147912118009858", deadline: "1793228315", group: GROUP };
  assert.equal(await orderHash(args), refHash(args));
  assert.notEqual(await orderHash({ ...args, outputAta: IN_ATA }), refHash(args), "a different payout account changes the hash");
});

test("the real quote's Approve reads as: the wallet's USDC account → Flash's delegate (unlimited by default)", () => {
  const ap = parseApprove(REAL.svm.delegateIx);
  assert.equal(ap.source, IN_ATA);
  assert.equal(ap.delegate, FLASH_SVM_DELEGATE);
  assert.equal(ap.owner, WALLET);
  assert.equal(ap.ownerSigns, true);
  assert.equal(ap.amount, 2n ** 64n - 1n, "why we must ask Flash for the minimal delegation");
});

const NOW = 1793228315 - 30;
const base = (o = {}) => ({ wallet: WALLET, inputMint: USDC, outputMint: JUP, total: "500000", inputAta: IN_ATA, outputAta: OUT_ATA, group: GROUP, orderType: "market", nowS: NOW, maxApprove: 500000n, ...o });
// A quote shaped like the real one, with the hash built for (OUT_ATA, IN_ATA, GROUP) and a minimal Approve.
function quote(o = {}) {
  const s = { ...REAL.svm, ...o.svm };
  const h = refHash({ outputAta: o.hashOut ?? OUT_ATA, inputAta: IN_ATA, nonce: s.nonce, deadline: s.deadline, group: o.hashGroup ?? GROUP });
  s.orderMessage = `DFS|m=${o.mint ?? USDC}|t=${o.total ?? "500000"}|h=${h}`;
  const amt = Buffer.alloc(9); amt[0] = 4; amt.writeBigUInt64LE(BigInt(o.approve ?? 500000), 1);
  s.delegateIx = o.noDelegate ? null : { ...REAL.svm.delegateIx, data: b58encode(amt), accounts: o.approveAccounts ?? REAL.svm.delegateIx.accounts };
  return { ...REAL, ...o.top, svm: s };
}

test("a correct quote passes", async () => {
  assert.equal(await checkSvmQuote(quote(), base()), null);
  assert.equal(await checkSvmQuote(quote({ noDelegate: true }), base()), null, "delegation already in place");
});

test("refused: no group configured (fail closed), and the REAL quote without our group", async () => {
  assert.match(await checkSvmQuote(quote(), base({ group: "" })), /switched on/);
  assert.match(await checkSvmQuote(REAL, base({ outputAta: OUT_ATA })), /own token account|delegation is larger/);
});

test("refused: payout to another account, other group, other mint, other amount", async () => {
  assert.match(await checkSvmQuote(quote({ hashOut: IN_ATA }), base()), /own token account/);
  assert.match(await checkSvmQuote(quote({ hashGroup: USDC }), base()), /own token account/);
  assert.match(await checkSvmQuote(quote({ mint: JUP }), base()), /different token/);
  assert.match(await checkSvmQuote(quote({ total: "500001" }), base()), /different amount/);
});

test("refused: delegation too big, to another spender, from another account", async () => {
  assert.match(await checkSvmQuote(quote({ approve: 2n ** 64n - 1n }), base()), /larger than this order/);
  assert.equal(await checkSvmQuote(quote({ approve: 700000 }), base({ maxApprove: 700000n })), null, "this order + open orders");
  const acc = REAL.svm.delegateIx.accounts;
  assert.match(await checkSvmQuote(quote({ approveAccounts: [acc[0], { ...acc[1], pubkey: WALLET }, acc[2]] }), base()), /unknown spender/);
  assert.match(await checkSvmQuote(quote({ approveAccounts: [{ ...acc[0], pubkey: OUT_ATA }, acc[1], acc[2]] }), base()), /another account/);
});

test("refused: sponsored or wrapped flows, expired or over-long market deadlines", async () => {
  assert.match(await checkSvmQuote(quote({ svm: { sponsoredDelegateTx: "AAAA" } }), base()), /pre-built/);
  assert.match(await checkSvmQuote(quote({ top: { wrap: { svmInstructions: [] } } }), base()), /Native SOL/);
  assert.match(await checkSvmQuote(quote(), base({ nowS: 1793228315 + 1 })), /expired/);
  assert.match(await checkSvmQuote(quote(), base({ nowS: 1793228315 - 7200 })), /lives that long/);
  assert.equal(await checkSvmQuote(quote(), base({ nowS: 1793228315 - 7200, orderType: "limit" })), null);
});

const ataIx = (accts, data = "2") => ({ programId: ATA_PROGRAM, data, accounts: accts.map((pubkey) => ({ pubkey })) });

test("token-account setup: only the wallet's own input/output accounts", async () => {
  const good = ataIx([WALLET, OUT_ATA, WALLET, JUP, SYSTEM_PROGRAM, SPL_TOKEN]);
  assert.equal(await checkSvmQuote(quote({ svm: { ataSetupIxs: [good] } }), base()), null);
  assert.match(await checkSvmQuote(quote({ svm: { ataSetupIxs: [ataIx([WALLET, OUT_ATA, USDC, JUP, SYSTEM_PROGRAM, SPL_TOKEN])] } }), base()), /wouldn't own/);
  assert.match(await checkSvmQuote(quote({ svm: { ataSetupIxs: [ataIx([WALLET, IN_ATA, WALLET, JUP, SYSTEM_PROGRAM, SPL_TOKEN])] } }), base()), /another token/);
  assert.match(await checkSvmQuote(quote({ svm: { ataSetupIxs: [{ ...good, data: "3" }] } }), base()), /Unexpected setup/);
});
