import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenAccountAmount, checkMinOut, checkSpend, checkReceive, swapOutcome } from "./solSwapGuards.mjs";

// A token account's data with `amount` written at bytes 64..72 (LE), as SPL / Token-2022 lay it out.
function acctB64(amount, len = 165) {
  const b = new Uint8Array(len);
  let v = BigInt(amount);
  for (let i = 64; i < 72; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return Buffer.from(b).toString("base64");
}

test("reads the u64 amount, including values past 2^53", () => {
  assert.equal(tokenAccountAmount(acctB64(123456789n)), 123456789n);
  assert.equal(tokenAccountAmount(acctB64(18446744073709551615n)), 18446744073709551615n);
  assert.equal(tokenAccountAmount(acctB64(5n, 82 + 83)), 5n); // Token-2022 accounts are longer; same offset
  assert.equal(tokenAccountAmount(acctB64(5n, 40)), null);
  assert.equal(tokenAccountAmount(""), null);
  assert.equal(tokenAccountAmount("%%%"), null);
});

test("min out must respect the asked slippage", () => {
  assert.equal(checkMinOut({ outAmount: "1000000", minOut: "990000", slippageBps: 100 }), null);
  assert.equal(checkMinOut({ outAmount: "1000000", minOut: "999999", slippageBps: 100 }), null);
  assert.match(checkMinOut({ outAmount: "1000000", minOut: "989999", slippageBps: 100 }), /below your slippage/);
  assert.match(checkMinOut({ outAmount: "1000000", minOut: "1000001", slippageBps: 100 }), /above/);
  assert.match(checkMinOut({ outAmount: "1000000", minOut: null, slippageBps: 100 }), /no minimum/);
  assert.match(checkMinOut({ outAmount: "1000000", minOut: "990000", slippageBps: 0 }), /out of range/);
});

test("spend: at most the typed amount, exactly", () => {
  assert.equal(checkSpend({ accounts: [{ pre: "5000000", post: "4000000" }], inAmount: 1000000 }), null);
  assert.match(checkSpend({ accounts: [{ pre: "5000000", post: "3999999" }], inAmount: 1000000 }), /more than you typed/);
  // Two accounts for the same mint are summed.
  assert.equal(checkSpend({ accounts: [{ pre: "600000", post: "0" }, { pre: "500000", post: "100000" }], inAmount: 1000000 }), null);
  assert.match(checkSpend({ accounts: [{ pre: "600000", post: "0" }, { pre: "500000", post: "0" }], inAmount: 1000000 }), /more than you typed/);
});

test("spend fails closed", () => {
  assert.match(checkSpend({ accounts: [], inAmount: 1 }), /Couldn't find/);
  assert.match(checkSpend({ accounts: [{ pre: "5", post: null }], inAmount: 1 }), /Couldn't verify/);
  assert.match(checkSpend({ accounts: [{ pre: "5", post: "4" }], inAmount: 0 }), /Bad amount/);
});

test("receive: the user's accounts gain at least the minimum; a new account starts at 0", () => {
  assert.equal(checkReceive({ accounts: [{ pre: null, post: "990000" }], minOut: "990000" }), null);
  assert.equal(checkReceive({ accounts: [{ pre: "100", post: "980200" }], minOut: "990000" }), null); // 1% tolerance
  assert.match(checkReceive({ accounts: [{ pre: "100", post: "100" }], minOut: "990000" }), /doesn't deliver/); // sent elsewhere
});

test("receive fails closed", () => {
  assert.match(checkReceive({ accounts: [], minOut: "1" }), /Couldn't find/);
  assert.match(checkReceive({ accounts: [{ pre: null, post: null }], minOut: "1" }), /Couldn't verify/);
  assert.match(checkReceive({ accounts: [{ pre: null, post: "5" }], minOut: null }), /no minimum/);
});

test("only a confirmation reads as success", () => {
  assert.equal(swapOutcome(true).ok, true);
  assert.equal(swapOutcome(false).ok, false);
  assert.match(swapOutcome(false).note, /Solscan/);
});
