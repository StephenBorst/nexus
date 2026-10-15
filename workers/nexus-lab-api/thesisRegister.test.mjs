// Run: node --test workers/nexus-lab-api/thesisRegister.test.mjs
// The registration path's pure half: the calldata we send, reading a registration back from any
// transaction that carries one, and the checks that run before anything costs gas.
import test from "node:test";
import assert from "node:assert/strict";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils.js";
import { encodeFunctionData, parseAbi } from "viem";
import {
  encodeRegisterThesis, decodeRegisterCalls, checkRegistration, provenRegistration, thesisFromRegistration,
  registeredNotes, pendingKey, perpSymbol, REGISTER_SELECTOR, SPLIT_TAG, THESIS_REGISTRY,
} from "./thesisRegister.mjs";

const SIG = "registerThesis(string,uint8,uint256,uint256,uint256,uint256,uint256,bool,string)";
const ABI = parseAbi(["function registerThesis(string symbol, uint8 direction, uint256 entryPrice, uint256 stopLoss, uint256 takeProfit1, uint256 takeProfit2, uint256 riskReward, bool isPublic, string notes)"]);
const W = "0x" + "ab".repeat(20);
const call = (over = {}) => ({ symbol: "BTC", direction: "LONG", entryPrice: 84150, stopLoss: 83300, takeProfit1: 85425, takeProfit2: 87550, isPublic: true, notes: "breakout reclaim", ...over });
const viemCalldata = (p) => encodeFunctionData({
  abi: ABI, functionName: "registerThesis",
  args: [perpSymbol(p.symbol), p.direction === "LONG" ? 0 : 1,
    BigInt(Math.round(p.entryPrice * 1e6)), BigInt(Math.round(p.stopLoss * 1e6)), BigInt(Math.round(p.takeProfit1 * 1e6)),
    BigInt(Math.round((p.takeProfit2 || 0) * 1e6)),
    BigInt(Math.round((Math.abs(p.takeProfit1 - p.entryPrice) / Math.abs(p.entryPrice - p.stopLoss)) * 1e4)),
    p.isPublic !== false, registeredNotes(p.notes, p.exitPlan)],
});

test("the selector is the keccak of the registry's function signature", () => {
  assert.equal(bytesToHex(keccak_256(utf8ToBytes(SIG))).slice(0, 8), REGISTER_SELECTOR);
});

test("encodeRegisterThesis matches viem byte for byte (empty, unicode and long notes, split tag, private)", () => {
  for (const p of [
    call(), call({ notes: "" }), call({ notes: "Ω reclaim — 4h close ✓" }), call({ notes: "x".repeat(70) }),
    call({ exitPlan: "SPLIT_50" }), call({ isPublic: false, direction: "SHORT", stopLoss: 85000, takeProfit1: 83000, takeProfit2: 0 }),
    call({ symbol: "PERP_HYPE_USDC", entryPrice: 87.2, stopLoss: 85.65, takeProfit1: 89.53 }),
  ]) assert.equal(encodeRegisterThesis(p), viemCalldata(p), JSON.stringify(p));
});

test("decodeRegisterCalls reads back what was encoded, prices unscaled", () => {
  const [d] = decodeRegisterCalls(encodeRegisterThesis(call({ exitPlan: "SPLIT_50" })));
  assert.deepEqual(d, {
    symbol: "PERP_BTC_USDC", direction: "LONG", entryPrice: 84150, stopLoss: 83300, takeProfit1: 85425, takeProfit2: 87550,
    riskReward: 1.5, isPublic: true, notes: `breakout reclaim ${SPLIT_TAG}`,
  });
});

test("decodeRegisterCalls finds a registration nested in a smart-account call, and ignores junk", () => {
  const inner = encodeRegisterThesis(call());
  const outer = encodeFunctionData({
    abi: parseAbi(["function execute(address to, uint256 value, bytes data)"]), functionName: "execute",
    args: [THESIS_REGISTRY, 0n, inner],
  });
  assert.equal(decodeRegisterCalls(outer).length, 1);
  assert.equal(decodeRegisterCalls(outer)[0].entryPrice, 84150);
  for (const junk of ["", "0x", "0xzz", "0x" + REGISTER_SELECTOR, "0x" + REGISTER_SELECTOR + "00".repeat(40), null]) {
    assert.deepEqual(decodeRegisterCalls(junk), [], String(junk));
  }
  // A string offset pointing past the data, or a direction that isn't 0/1, is not a call.
  const h = inner.slice(10);
  assert.deepEqual(decodeRegisterCalls("0x" + REGISTER_SELECTOR + "f".repeat(64) + h.slice(64)), []);
  assert.deepEqual(decodeRegisterCalls("0x" + REGISTER_SELECTOR + h.slice(0, 64) + "0".repeat(63) + "2" + h.slice(128)), []);
});

test("checkRegistration refuses before gas: side, symbol, levels, scale, exit plan, notes", () => {
  assert.equal(checkRegistration(call()), null);
  assert.equal(checkRegistration(call({ exitPlan: "SPLIT_50" })), null);
  const err = (over) => checkRegistration(call(over))?.error;
  assert.equal(err({ direction: "UP" }), "bad_direction");
  assert.equal(err({ symbol: "BTC/USDT" }), "bad_symbol");
  assert.equal(err({ symbol: "" }), "bad_symbol");
  assert.equal(err({ stopLoss: 85000 }), "bad_levels", "stop on the winning side");
  assert.equal(err({ takeProfit1: 84000 }), "bad_levels", "target on the losing side");
  assert.equal(err({ entryPrice: -1 }), "bad_levels");
  assert.equal(err({ entryPrice: 0.0000123, stopLoss: 0.000011, takeProfit1: 0.000015, takeProfit2: 0 }), "price_too_small");
  assert.equal(err({ exitPlan: "split" }), "bad_exit_plan");
  assert.equal(err({ exitPlan: "SPLIT_50", takeProfit2: 0 }), "bad_split");
  assert.equal(err({ exitPlan: "SPLIT_50", takeProfit2: 85000 }), "bad_split");
  assert.equal(err({ notes: "x".repeat(1001) }), "notes_too_long");
  assert.equal(checkRegistration(call({ takeProfit2: undefined })), null, "TP2 is optional");
});

const REG = THESIS_REGISTRY;
const word = (a) => "0x" + "0".repeat(24) + a.slice(2).toLowerCase();
const ev = (who, id = 7) => ({ address: REG, topics: ["0x" + "1".repeat(64), "0x" + id.toString(16).padStart(64, "0"), word(who)] });
const receipt = (logs, status = "0x1") => ({ status, logs });

test("provenRegistration: one success, one registry event for the wallet, one readable call", () => {
  const input = encodeRegisterThesis(call());
  const ok = provenRegistration({ receipt: receipt([ev(W)]), input, wallet: W });
  assert.equal(ok.onChainId, "7");
  assert.equal(ok.call.takeProfit1, 85425);
  const e = (o) => provenRegistration({ receipt: receipt([ev(W)]), input, wallet: W, ...o }).error;
  assert.equal(e({ receipt: null }), "receipt_unavailable");
  assert.equal(e({ receipt: receipt([ev(W)], "0x0") }), "tx_failed");
  assert.equal(e({ receipt: receipt([]) }), "not_a_registration");
  assert.equal(e({ receipt: receipt([ev(W), ev("0x" + "cd".repeat(20), 8)]) }), "multiple_registrations", "a bundle can't hand one wallet another's levels");
  assert.equal(e({ wallet: "0x" + "cd".repeat(20) }), "wallet_not_proven");
  assert.equal(e({ input: "0x1234" }), "calldata_unreadable");
  assert.equal(e({ input: input + input.slice(2) }), "calldata_unreadable", "two calls in one input");
});

test("thesisFromRegistration: the call is what the chain holds; the split comes from the registered notes", () => {
  const p = provenRegistration({ receipt: receipt([ev(W, 42)]), input: encodeRegisterThesis(call({ exitPlan: "SPLIT_50", notes: "reclaim" })), wallet: W });
  const tx = "0x" + "9f".repeat(32);
  const t = thesisFromRegistration(p, { txHash: tx, blockTimeMs: 1_760_000_000_000 });
  assert.equal(t.id, "reg-" + "9f".repeat(8), "deterministic: indexing twice is the same call");
  assert.equal(t.exitPlan, "SPLIT_50");
  assert.equal(t.notes, "reclaim");
  assert.deepEqual([t.symbol, t.direction, t.entryPrice, t.stopLoss, t.takeProfit1, t.takeProfit2], ["PERP_BTC_USDC", "LONG", 84150, 83300, 85425, 87550]);
  assert.equal(t.riskReward, 1.5);
  assert.equal(t.onChainId, "42");
  assert.equal(t.onChainTxHash, tx);
  assert.equal(t.createdAt, 1_760_000_000_000);
  const plain = thesisFromRegistration(provenRegistration({ receipt: receipt([ev(W)]), input: encodeRegisterThesis(call()), wallet: W }), { txHash: tx, blockTimeMs: 1 });
  assert.equal("exitPlan" in plain, false, "a TP2 alone declares nothing");
});

test("registeredNotes adds the split tag once; pendingKey is per wallet and per calldata", async () => {
  assert.equal(registeredNotes("a", "SPLIT_50"), `a ${SPLIT_TAG}`);
  assert.equal(registeredNotes(`a ${SPLIT_TAG}`, "SPLIT_50"), `a ${SPLIT_TAG}`);
  assert.equal(registeredNotes(`a ${SPLIT_TAG}`, undefined), "a", "no declaration = no tag, even if the text carried one");
  assert.equal(registeredNotes("", "SPLIT_50"), SPLIT_TAG);
  const cd = encodeRegisterThesis(call());
  assert.equal(await pendingKey(W, cd), await pendingKey(W.toUpperCase().replace("0X", "0x"), cd));
  assert.notEqual(await pendingKey(W, cd), await pendingKey("0x" + "cd".repeat(20), cd));
  assert.notEqual(await pendingKey(W, cd), await pendingKey(W, encodeRegisterThesis(call({ notes: "other" }))));
});
