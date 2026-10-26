// Run: node --test workers/nexus-lab-api/revokedTrading.test.mjs
// A wallet whose trading signature leaked is refused for trading and agent control, with real
// signatures, while withdrawals to itself and its balance reads stay open.
import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { revokedWallets, revokedTradingRefusal, openToRevoked, TRADING_MESSAGE } from "./revokedTrading.mjs";
import { recoverEthAddress } from "./shared.mjs";

const leaked = privateKeyToAccount("0x" + "11".repeat(32));
const other = privateKeyToAccount("0x" + "22".repeat(32));
const env = { REVOKED_TRADING_WALLETS: ` ${leaked.address}, not-an-address ,` };
const revoked = revokedWallets(env);
const sigOf = (acct) => acct.signMessage({ message: TRADING_MESSAGE });
const gate = (method, path, body) =>
  revokedTradingRefusal({ method, parts: path.split("/").filter(Boolean), body, revoked, recover: recoverEthAddress });

test("the var is read as lower-cased addresses; junk entries are dropped", () => {
  assert.deepEqual([...revoked], [leaked.address.toLowerCase()]);
  assert.equal(revokedWallets({}).size, 0);
  assert.equal(revokedWallets({ REVOKED_TRADING_WALLETS: "" }).size, 0);
});

test("the leaked wallet's signature is refused on trading and agent control", async () => {
  const walletSig = await sigOf(leaked);
  const a = leaked.address.toLowerCase();
  for (const [method, path] of [
    ["POST", "/trade"], ["POST", "/close-position"], ["POST", "/cancel"], ["POST", "/set-leverage"],
    ["POST", "/order-history"], ["POST", "/derive-key"],
    ["PUT", `/agent/${a}`], ["PUT", `/agent/${a}/config`], ["DELETE", `/agent/${a}`], ["POST", `/agent/${a}/kill`],
    ["POST", `/agent/${a}/bankr/activate`], ["POST", `/agent/${a}/bankr/mode`],
  ]) {
    const r = gate(method, path, { walletSig, walletAddress: a });
    assert.equal(r?.status, 403, `${method} ${path}`);
    assert.equal(r.body.error, "trading_signature_revoked");
    assert.equal(r.body.wallet, a);
  }
});

test("withdrawals to the wallet and its balance reads stay open", async () => {
  const walletSig = await sigOf(leaked);
  for (const path of ["/withdraw/prepare", "/withdraw/submit", "/proxy/bankr-withdraw", "/balance", "/positions"]) {
    assert.equal(gate("POST", path, { walletSig, walletAddress: leaked.address }), null, path);
  }
  assert.equal(openToRevoked(["positions", "x"]), false, "only the exact read routes");
});

test("Bankr flows that sign the message server-side are refused by walletAddress", () => {
  for (const path of ["/proxy/bankr-register", "/proxy/bankr-deposit"]) {
    assert.equal(gate("POST", path, { walletAddress: leaked.address, bankrApiKey: "bk" })?.status, 403, path);
    assert.equal(gate("POST", path, { walletAddress: other.address, bankrApiKey: "bk" }), null, `${path}, other wallet`);
  }
  // Elsewhere a bare walletAddress proves nothing and isn't what this gate keys on.
  assert.equal(gate("POST", "/trade", { walletAddress: leaked.address }), null);
});

test("everyone else, reads, and no list at all pass through untouched", async () => {
  const walletSig = await sigOf(other);
  assert.equal(gate("POST", "/trade", { walletSig, walletAddress: other.address }), null, "another wallet");
  assert.equal(gate("GET", "/agent/x", { walletSig: await sigOf(leaked) }), null, "GET is never gated");
  assert.equal(gate("POST", "/trade", null), null, "no body");
  assert.equal(gate("POST", "/trade", { walletSig: "0xnot-a-signature" }), null, "unrecoverable signature");
  assert.equal(revokedTradingRefusal({ method: "POST", parts: ["trade"], body: { walletSig: await sigOf(leaked) },
    revoked: new Set(), recover: recoverEthAddress }), null, "empty list = gate off");
});
