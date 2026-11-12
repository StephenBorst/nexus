// Settling PnL the way Orderly's SDK does (settlePnl.mjs): the SettlePnl EIP-712 pinned to the SDK's
// own type definition, a real wallet signature (viem), and the request body. Injected I/O; no network.
// Run: node --test workers/nexus-lab-api/settlePnl.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { definedTypes } from "@orderly.network/types";
import {
  settleNonceFrom, settleMessage, settleTypedData, settleRefusal, settleSigner, runSettle, settleFailure,
  SETTLE_VC, SETTLE_BROKER_ID, SETTLE_CHAIN_ID, SETTLE_NOTHING_CODE, nothingToSettle,
} from "./settlePnl.mjs";
import { WITHDRAW_VC } from "./withdrawV2.mjs";

const T0 = 1_790_000_000_000;
const alice = privateKeyToAccount("0x" + "a1".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const A = alice.address.toLowerCase();
const sign = (account) => (td) => { const { EIP712Domain, ...types } = td.types; return account.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message }); };

test("the typed data is the SDK's SettlePnl on the on-chain domain (the ledger Withdraw uses)", () => {
  const td = settleTypedData(settleMessage({ settleNonce: 3, now: T0 }));
  assert.deepEqual(td.types.SettlePnl, definedTypes.SettlePnl, "same fields as @orderly.network/types");
  assert.deepEqual(td.types.EIP712Domain, definedTypes.EIP712Domain);
  assert.equal(td.primaryType, "SettlePnl");
  assert.deepEqual(td.domain, { name: "Orderly", version: "1", chainId: 42161, verifyingContract: SETTLE_VC });
  assert.equal(SETTLE_VC, WITHDRAW_VC);
  assert.deepEqual(td.message, { brokerId: "nexus_trading", chainId: 42161, settleNonce: 3, timestamp: T0 });
  assert.deepEqual([SETTLE_BROKER_ID, SETTLE_CHAIN_ID], ["nexus_trading", 42161]);
});

test("nonce: read from data.settle_nonce; refusals and junk = null", () => {
  assert.equal(settleNonceFrom({ success: true, data: { settle_nonce: 7 } }), 7);
  assert.equal(settleNonceFrom({ success: true, data: { settle_nonce: "0" } }), 0);
  for (const r of [null, {}, { success: false, data: { settle_nonce: 7 } }, { success: true, data: {} }, { success: true, data: { settle_nonce: -1 } }, { success: true, data: { settle_nonce: 1.5 } }]) {
    assert.equal(settleNonceFrom(r), null, JSON.stringify(r));
  }
});

test("a caller's message must be exactly ours", () => {
  const m = settleMessage({ settleNonce: 1, now: T0 });
  assert.equal(settleRefusal(m), null);
  assert.equal(settleRefusal({ ...m, brokerId: "other" }), "wrong_broker");
  assert.equal(settleRefusal({ ...m, chainId: 1 }), "wrong_chain");
  assert.equal(settleRefusal({ ...m, settleNonce: -1 }), "bad_nonce");
  assert.equal(settleRefusal({ ...m, timestamp: "x" }), "bad_timestamp");
  assert.equal(settleRefusal(null), "no_message");
});

test("runSettle: nonce → the wallet signs → POST the SDK's body; recovers to the wallet", async () => {
  const posted = [];
  const r = await runSettle({
    wallet: A, now: T0,
    getNonce: async () => ({ success: true, data: { settle_nonce: 9 } }),
    signTyped: sign(alice),
    post: async (b) => { posted.push(b); return { success: true, data: {} }; },
  });
  assert.deepEqual([r.ok, r.stage], [true, "done"]);
  const [b] = posted;
  assert.deepEqual(Object.keys(b).sort(), ["message", "signature", "userAddress", "verifyingContract"]);
  assert.deepEqual(b.message, { brokerId: "nexus_trading", chainId: 42161, settleNonce: 9, timestamp: T0, chainType: "EVM" });
  assert.equal(b.userAddress, A);
  assert.equal(b.verifyingContract, SETTLE_VC);
  assert.equal(await settleSigner(b.message, b.signature), A, "the chainType extra field doesn't change what was signed");
});

test("runSettle refuses before posting: no nonce, or a signature from another wallet", async () => {
  let posts = 0, signs = 0;
  const post = async () => { posts++; return { success: true }; };
  const noNonce = await runSettle({ wallet: A, getNonce: async () => ({ success: false, code: -1 }), signTyped: async (td) => { signs++; return sign(alice)(td); }, post });
  assert.deepEqual([noNonce.ok, noNonce.stage, signs, posts], [false, "nonce", 0, 0]);
  const wrong = await runSettle({ wallet: A, getNonce: async () => ({ success: true, data: { settle_nonce: 1 } }), signTyped: sign(mallory), post });
  assert.deepEqual([wrong.ok, wrong.stage, posts], [false, "signer", 0]);
  const junk = await runSettle({ wallet: A, getNonce: async () => ({ success: true, data: { settle_nonce: 1 } }), signTyped: async () => null, post });
  assert.deepEqual([junk.ok, junk.stage, posts], [false, "signer", 0]);
  const refused = await runSettle({ wallet: A, getNonce: async () => ({ success: true, data: { settle_nonce: 1 } }), signTyped: sign(alice), post: async () => ({ success: false, code: 17 }) });
  assert.deepEqual([refused.ok, refused.stage, refused.raw.code], [false, "orderly", 17]);
  assert.deepEqual([settleFailure(refused).error, settleFailure(refused).withdrawnAmount], ["settle_failed", 0]);
});

test("-1117 (no PnL to settle) is not a failure: ok, nothing booked; any other refusal still is", async () => {
  assert.equal(SETTLE_NOTHING_CODE, -1117);
  const live = { success: false, code: -1117, message: "no PNL to settle" }; // 0xd9f7…b449, 2026-11-09
  assert.equal(nothingToSettle(live), true);
  for (const r of [null, { success: true }, { success: false, code: 17 }, { success: false, code: "-1117x" }]) assert.equal(nothingToSettle(r), false, JSON.stringify(r));
  const run = (reply) => runSettle({ wallet: A, now: T0, getNonce: async () => ({ success: true, data: { settle_nonce: 2 } }), signTyped: sign(alice), post: async () => reply });
  const nothing = await run(live);
  assert.deepEqual([nothing.ok, nothing.settled, nothing.stage], [true, false, "nothing"]);
  const done = await run({ success: true, data: {} });
  assert.deepEqual([done.ok, done.settled, done.stage], [true, true, "done"]);
  const refused = await run({ success: false, code: 17 });
  assert.deepEqual([refused.ok, refused.stage], [false, "orderly"]);
});

test("/settle-pnl answers -1117 with 200 nothingToSettle, never a 502", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const route = src.slice(src.indexOf('parts[0] === "settle-pnl"'), src.indexOf("// 3) Prepare"));
  assert.match(route, /const settledReply = \(raw\) => nothingToSettle\(raw\)\s*\n\s*\? json\(\{ ok: true, settled: false, nothingToSettle: true,/);
});

test("nothing in lab-api posts an empty settle any more", () => {
  for (const f of ["./index.js", "./withdrawV2.mjs"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /"\/v1\/settle_pnl",\s*(\{\}|settleBody)/, f);
  }
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const route = src.slice(src.indexOf('parts[0] === "settle-pnl"'), src.indexOf("POST /set-leverage") > 0 ? src.indexOf("POST /set-leverage") : undefined);
  assert.match(route, /runSettle\(/, "Bankr settles in one call");
  assert.match(route, /settleSigner\(spbody\.message, spbody\.signature\)\) !== spWallet/, "a submitted settle must be the wallet's");
  assert.match(route, /settleTypedData\(spMsg\)/, "prepare returns the typed data");
  assert.match(route, /json\(\{ settled: false, step: "sign"/, "prepare never says ok: an agent must not read it as settled");
});
