// v1Retire.mjs: a Bankr v2 registration removes the wallet's v1 derived key at Orderly (signed by the
// new v2 key) and flags the wallet, after which its v1 walletSig is refused with 401. Real signatures,
// a fake Orderly that verifies every ed25519 request, no network.
// Run: node --test workers/nexus-lab-api/v1Retire.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import * as ed from "@noble/ed25519";
import bs58 from "bs58";
import { handleKey } from "./routes-key.mjs";
import { V1_OFF, v1RetiredRefusal, retireV1Key } from "./v1Retire.mjs";
import { keyFromTradingSig } from "./routes-removekey.mjs";
import { TRADING_MESSAGE } from "./revokedTrading.mjs";
import { orderlyAccountId } from "./logic.mjs";
import { recoverEthAddress } from "./shared.mjs";

const T0 = 1_790_000_000_000;
const alice = privateKeyToAccount("0x" + "a1".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const A = alice.address.toLowerCase();
const ACCT = orderlyAccountId(A, "nexus_trading");
const ENC = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
let seq = 0;
const rnd = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7 + seq++) & 255);

function kv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}

function fakeOrderly({ refuseRemove = false } = {}) {
  const keys = new Map();
  const calls = [];
  const bankrBodies = [];
  let bankrAccount = alice;
  const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const verify = async (url, init) => {
    const h = init.headers || {};
    if (keys.get(h["orderly-key"]) !== h["orderly-account-id"]) return false;
    const msg = new TextEncoder().encode(`${h["orderly-timestamp"]}${init.method}${new URL(url).pathname}${init.body || ""}`);
    return ed.verifyAsync(unb64url(h["orderly-signature"]), msg, bs58.decode(h["orderly-key"].slice(8)));
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(`${init.method || "GET"} ${u.pathname}`);
    const ok = (data) => new Response(JSON.stringify({ success: true, data }));
    const no = (code, message) => new Response(JSON.stringify({ success: false, code, message }));
    if (u.host === "api.bankr.bot") {
      const b = JSON.parse(init.body);
      bankrBodies.push(b);
      if (b.signatureType === "personal_sign") return new Response(JSON.stringify({ success: true, signature: await bankrAccount.signMessage({ message: b.message }) }));
      const { EIP712Domain, ...types } = b.typedData.types;
      return new Response(JSON.stringify({ success: true, signature: await bankrAccount.signTypedData({ domain: b.typedData.domain, types, primaryType: b.typedData.primaryType, message: b.typedData.message }) }));
    }
    if (u.pathname === "/v1/orderly_key") { const b = JSON.parse(init.body); keys.set(b.orderlyKey, init.headers["X-Account-Id"]); return ok({}); }
    if (u.pathname === "/v1/client/remove_orderly_key") {
      if (refuseRemove || !(await verify(url, init))) return no(-2, "refused");
      keys.delete(JSON.parse(init.body).orderly_key);
      return ok({});
    }
    if (u.pathname === "/v1/get_orderly_key") return keys.get(u.searchParams.get("orderly_key")) === u.searchParams.get("account_id") ? ok({ key_status: "ACTIVE" }) : no(-3, "not found");
    if (u.pathname === "/v1/get_account") return ok({ account_id: orderlyAccountId(u.searchParams.get("address"), "nexus_trading") });
    throw new Error(`unexpected fetch ${url}`);
  };
  return { keys, calls, bankrBodies, fetchImpl, setBankr: (a) => { bankrAccount = a; } };
}

const envOn = () => ({ NEXUS_AGENT: kv(), AGENT_ENC_KEY: ENC, AUTH_V2_KEYS: "true" });
const register = (env, o) => handleKey(["v2", "key", "bankr-register"],
  new Request("https://og.test/v2/key/bankr-register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: alice.address, bankrApiKey: "bk_test" }) }),
  env, { now: () => T0, fetchImpl: o.fetchImpl, randomBytes: rnd });
const v1Sig = (acct = alice) => acct.signMessage({ message: TRADING_MESSAGE });
async function plantV1(o) {
  const { orderlyKey } = await keyFromTradingSig(await v1Sig());
  o.keys.set(orderlyKey, ACCT);
  return orderlyKey;
}

test("bankr-register removes the v1 key at Orderly, signed by the new v2 key, and flags the wallet", async () => {
  const env = envOn(), o = fakeOrderly();
  const v1Key = await plantV1(o);
  const res = await register(env, o);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.deepEqual(body.v1Retire, { status: "removed" });
  assert.equal(o.keys.has(v1Key), false, "v1 key gone at Orderly");
  assert.equal(o.keys.has(body.orderlyKey), true, "v2 key still active");
  assert.equal(JSON.parse(env.NEXUS_AGENT.m.get(V1_OFF(A))).status, "removed");
});

test("the v1 signature never leaves the request: not in the reply, not in KV", async () => {
  const env = envOn(), o = fakeOrderly();
  await plantV1(o);
  const sig = await v1Sig();
  const { seed } = await keyFromTradingSig(sig);
  const text = await (await register(env, o)).text();
  const all = text + [...env.NEXUS_AGENT.m.values()].join("");
  assert.ok(!all.includes(sig.slice(2, 40)), "signature absent");
  assert.ok(!all.includes(bs58.encode(seed)), "seed absent");
});

test("no v1 key ever registered: nothing to remove, the wallet is still flagged", async () => {
  const env = envOn(), o = fakeOrderly();
  const body = await (await register(env, o)).json();
  assert.deepEqual(body.v1Retire, { status: "not_registered" });
  assert.ok(env.NEXUS_AGENT.m.get(V1_OFF(A)));
  assert.ok(!o.calls.includes("POST /v1/client/remove_orderly_key"));
});

test("Orderly refuses the removal: the v2 key still registers, the wallet is NOT flagged", async () => {
  const env = envOn(), o = fakeOrderly({ refuseRemove: true });
  await plantV1(o);
  const res = await register(env, o);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.active, true);
  assert.equal(body.v1Retire.status, "still_active");
  assert.equal(env.NEXUS_AGENT.m.get(V1_OFF(A)), undefined);
});

test("a live v1 agent position: the old key is left alone and nothing is flagged", async () => {
  const env = envOn(), o = fakeOrderly();
  const v1Key = await plantV1(o);
  await env.NEXUS_AGENT.put(`agent:key:${A}`, JSON.stringify("v1:sealed"));
  await env.NEXUS_AGENT.put(`agent:state:${A}`, JSON.stringify({ current_position: { symbol: "PERP_ETH_USDC", paper: false } }));
  const body = await (await register(env, o)).json();
  assert.equal(body.v1Retire.status, "skipped_in_use");
  assert.equal(body.v1Retire.error, "v1_agent_position_open");
  assert.equal(o.keys.has(v1Key), true);
  assert.equal(env.NEXUS_AGENT.m.get(V1_OFF(A)), undefined);
});

test("a v2 pointer agent with a position doesn't block the retire (it signs with the v2 key)", async () => {
  const env = envOn(), o = fakeOrderly();
  await plantV1(o);
  await env.NEXUS_AGENT.put(`agent:key:${A}`, JSON.stringify({ v: 2, ref: "v2key" }));
  await env.NEXUS_AGENT.put(`agent:state:${A}`, JSON.stringify({ current_position: { paper: false } }));
  assert.equal((await (await register(env, o)).json()).v1Retire.status, "removed");
});

test("a Bankr key signing the v1 message as another wallet removes and flags nothing", async () => {
  const env = envOn(), o = fakeOrderly();
  const v1Key = await plantV1(o);
  let n = 0;
  const kvx = env.NEXUS_AGENT;
  const out = await retireV1Key({
    kv: kvx, wallet: A, bankrApiKey: "bk", bankrBase: "https://api.bankr.bot", recover: recoverEthAddress, now: T0,
    fetchImpl: async (url, init) => { o.setBankr(mallory); return o.fetchImpl(url, init); },
    lookup: async () => { n++; return true; }, remove: async () => { n++; return true; },
  });
  assert.equal(out.status, "wrong_signer");
  assert.equal(n, 0);
  assert.equal(o.keys.has(v1Key), true);
  assert.equal(kvx.m.get(V1_OFF(A)), undefined);
});

test("the gate: a flagged wallet's v1 walletSig = 401 v1_retired, anywhere", async () => {
  const k = kv();
  await k.put(V1_OFF(A), JSON.stringify({ at: T0, status: "removed" }));
  const walletSig = await v1Sig();
  for (const p of [["trade"], ["balance"], ["agent", A, "config"], ["withdraw", "submit"]]) {
    const r = await v1RetiredRefusal({ method: "POST", parts: p, body: { walletSig }, kv: k, recover: recoverEthAddress });
    assert.equal(r?.status, 401, p.join("/"));
    assert.equal(r.body.error, "v1_retired");
  }
  assert.equal((await v1RetiredRefusal({ method: "PUT", parts: ["agent", A], body: { walletSig }, kv: k, recover: recoverEthAddress })).status, 401);
});

test("the gate: the v1 Bankr flows are refused by walletAddress; v2 routes and sessions pass", async () => {
  const k = kv();
  await k.put(V1_OFF(A), "{}");
  const g = (parts, body) => v1RetiredRefusal({ method: "POST", parts, body, kv: k, recover: recoverEthAddress });
  assert.equal((await g(["proxy", "bankr-register"], { walletAddress: alice.address })).status, 401);
  assert.equal((await g(["proxy", "bankr-deposit"], { walletAddress: alice.address })).status, 401);
  assert.equal(await g(["v2", "key", "bankr-register"], { walletAddress: alice.address }), null);
  assert.equal(await g(["proxy", "bankr-remove-key"], { walletAddress: alice.address }), null);
  assert.equal(await g(["proxy", "bankr-withdraw"], { walletAddress: alice.address }), null);
  assert.equal(await g(["trade"], { walletAddress: A, session: { session: "x" } }), null);
});

test("the gate: an unflagged wallet's walletSig passes, GETs and bodiless requests pass", async () => {
  const k = kv();
  await k.put(V1_OFF(A), "{}");
  const malSig = await v1Sig(mallory);
  assert.equal(await v1RetiredRefusal({ method: "POST", parts: ["trade"], body: { walletSig: malSig }, kv: k, recover: recoverEthAddress }), null);
  assert.equal(await v1RetiredRefusal({ method: "GET", parts: ["trade"], body: { walletSig: await v1Sig() }, kv: k, recover: recoverEthAddress }), null);
  assert.equal(await v1RetiredRefusal({ method: "POST", parts: ["trade"], body: null, kv: k, recover: recoverEthAddress }), null);
  assert.equal(await v1RetiredRefusal({ method: "POST", parts: ["trade"], body: { walletSig: "0xnotasig" }, kv: k, recover: recoverEthAddress }), null);
});
