// Run: node --test workers/nexus-lab-api/routes-removekey.test.mjs
// Removing a leaked trading key at Orderly, against a fake Bankr + fake Orderly, with a real
// wallet signature: only the owner's Bankr can drive it, it refuses while funds are on the account,
// the removal is signed by the key it removes, and the signature never leaves the request.
import test from "node:test";
import assert from "node:assert/strict";
import * as ed from "@noble/ed25519";
import bs58 from "bs58";
import { privateKeyToAccount } from "viem/accounts";
import { handleRemoveKey, keyFromTradingSig, keyPresent, fundsLeft, ORDERLY_BASE, BANKR_BASE } from "./routes-removekey.mjs";
import { revokedTradingRefusal, revokedWallets } from "./revokedTrading.mjs";
import { recoverEthAddress } from "./shared.mjs";

const owner = privateKeyToAccount("0x" + "33".repeat(32));
const other = privateKeyToAccount("0x" + "44".repeat(32));
const W = owner.address.toLowerCase();

function world({ signer = owner, keyOnAccount = true, holding = [], positions = [], removeAnswer = { success: true }, keepAfterRemove = false } = {}) {
  const calls = [];
  let present = keyOnAccount;
  let sigHex = null;
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const ok = (body) => ({ status: 200, json: async () => body });
    if (u === `${BANKR_BASE}/wallet/sign`) {
      sigHex = await signer.signMessage({ message: JSON.parse(init.body).message });
      return ok({ success: true, signature: sigHex });
    }
    if (u.startsWith(`${ORDERLY_BASE}/v1/get_orderly_key`)) {
      return ok(present ? { success: true, data: { orderly_key: new URL(u).searchParams.get("orderly_key"), key_status: "ACTIVE" } } : { success: false, code: -1, message: "key not found" });
    }
    if (u === `${ORDERLY_BASE}/v1/client/holding`) return ok({ success: true, data: { holding } });
    if (u === `${ORDERLY_BASE}/v1/positions`) return ok({ success: true, data: { rows: positions } });
    if (u === `${ORDERLY_BASE}/v1/client/remove_orderly_key`) {
      if (removeAnswer.success && !keepAfterRemove) present = false;
      return ok(removeAnswer);
    }
    throw new Error("unexpected " + u);
  };
  return { calls, fetchImpl, sig: () => sigHex };
}
const req = (body) => new Request("https://og.test/proxy/bankr-remove-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const go = async (w, body = { walletAddress: owner.address, bankrApiKey: "bk" }) => {
  const res = await handleRemoveKey(["proxy", "bankr-remove-key"], req(body), {}, { fetchImpl: w.fetchImpl, now: () => 1_790_000_000_000 });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
};

test("an empty account: the key is removed by a request it signs itself, and the lookup confirms it", async () => {
  const w = world();
  const r = await go(w);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.ok, r.body.status], [true, "removed"]);
  const { orderlyKey } = await keyFromTradingSig(w.sig());
  assert.equal(r.body.orderlyKey, orderlyKey);
  const rm = w.calls.find((c) => c.url.endsWith("/v1/client/remove_orderly_key"));
  assert.deepEqual(JSON.parse(rm.init.body), { orderly_key: orderlyKey });
  const h = rm.init.headers;
  assert.equal(h["orderly-key"], orderlyKey);
  const msg = new TextEncoder().encode(`${h["orderly-timestamp"]}POST/v1/client/remove_orderly_key${rm.init.body}`);
  const sigBytes = Uint8Array.from(atob(h["orderly-signature"].replace(/-/g, "+").replace(/_/g, "/") + "=="), (c) => c.charCodeAt(0));
  assert.ok(await ed.verifyAsync(sigBytes, msg, bs58.decode(orderlyKey.slice("ed25519:".length))), "signed by the key being removed");
  assert.ok(!r.text.includes(w.sig().slice(2, 40)), "the trading signature never leaves the request");
});

test("funds or open positions still on the account: refused, nothing removed", async () => {
  for (const [holding, positions] of [
    [[{ token: "USDC", holding: 41.5, pending_short: 0 }], []],
    [[], [{ symbol: "PERP_ETH_USDC", position_qty: -0.02 }]],
  ]) {
    const w = world({ holding, positions });
    const r = await go(w);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "withdraw_first");
    assert.equal(w.calls.some((c) => c.url.endsWith("remove_orderly_key")), false);
  }
  // Dust doesn't count.
  assert.equal((await go(world({ holding: [{ token: "USDC", holding: 0.004 }] }))).body.status, "removed");
});

test("force skips the funds check; a key Orderly doesn't have is reported, not removed", async () => {
  const forced = world({ holding: [{ token: "USDC", holding: 10 }] });
  assert.equal((await go(forced, { walletAddress: owner.address, bankrApiKey: "bk", force: true })).body.status, "removed");
  const none = world({ keyOnAccount: false });
  const r = await go(none);
  assert.deepEqual([r.status, r.body.status], [200, "not_registered"]);
  assert.equal(none.calls.some((c) => c.url.endsWith("remove_orderly_key")), false);
});

test("Orderly's refusal is passed through; a key still present after removal reads still_active", async () => {
  const refused = await go(world({ removeAnswer: { success: false, code: -1003, message: "cannot remove the key in use" } }));
  assert.deepEqual([refused.status, refused.body.error, refused.body.code], [502, "orderly_refused", -1003]);
  const lingering = await go(world({ keepAfterRemove: true }));
  assert.deepEqual([lingering.body.ok, lingering.body.status], [false, "still_active"]);
});

test("only the wallet's own Bankr can drive it", async () => {
  const r = await go(world({ signer: other }));
  assert.deepEqual([r.status, r.body.error], [401, "signature_mismatch"]);
  assert.equal((await go(world(), { walletAddress: owner.address })).status, 400, "no Bankr key");
  assert.equal((await go(world(), { walletAddress: "nope", bankrApiKey: "bk" })).status, 400);
});

test("the revoked-wallet gate lets it through: it can only kill the leaked key", () => {
  const revoked = revokedWallets({ REVOKED_TRADING_WALLETS: W });
  assert.equal(revokedTradingRefusal({ method: "POST", parts: ["proxy", "bankr-remove-key"], body: { walletAddress: W, bankrApiKey: "bk" }, revoked, recover: recoverEthAddress }), null);
});

test("readers: key presence and funds", () => {
  assert.equal(keyPresent({ success: true, data: { key_status: "ACTIVE" } }), true);
  assert.equal(keyPresent({ success: true, data: { key_status: "REMOVING" } }), false);
  assert.equal(keyPresent({ success: false }), false);
  assert.equal(keyPresent(null), null);
  assert.equal(fundsLeft(null, { data: { rows: [] } }), null, "an unreadable holding is not an empty account");
  assert.equal(fundsLeft({ data: { holding: [] } }, { data: { rows: [] } }).empty, true);
});
