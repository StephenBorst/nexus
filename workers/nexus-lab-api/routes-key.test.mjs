// Auth v2 step 2 (routes-key.mjs, v2Keys.mjs) with REAL signatures: the wallet's trading session, the
// per-request challenge and the AddOrderlyKey EIP-712 (viem), and a fake Orderly that checks every
// ed25519 request signature against the keys it holds. No network.
// Run: node --test workers/nexus-lab-api/routes-key.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import * as ed from "@noble/ed25519";
import bs58 from "bs58";
import { handleKey } from "./routes-key.mjs";
import {
  newKeyMaterial, orderlyKeyOf, addKeyMessage, addKeyTypedData, addKeyRefusal, publicKeyStatus, V2_KEY, V2_PENDING, V2_KEY_DAYS,
} from "./v2Keys.mjs";
import { newTradingSession } from "../../app/lib/tradingSession.mjs";
import { buildChallenge, orderlyAccountId, AUTH_V2_ACTIONS } from "./logic.mjs";
import { NexusLock } from "./lock.mjs";
import { revokedTradingRefusal } from "./revokedTrading.mjs";
import { recoverEthAddress } from "./shared.mjs";

const T0 = 1_790_000_000_000;
const DAY = 86400000;
const alice = privateKeyToAccount("0x" + "a1".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const A = alice.address.toLowerCase();
const ACCT = orderlyAccountId(A, "nexus_trading");
const ENC = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

function kv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
let seq = 0;
const rnd = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7 + seq++) & 255);

// A fake Orderly: keys per account; every signed request is verified against an ACTIVE key.
function fakeOrderly({ refuseAdd = false, refuseRemove = false, accounts = new Set([ACCT]) } = {}) {
  const keys = new Map(); // orderlyKey -> accountId
  const calls = [];
  const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const verify = async (url, init) => {
    const h = init.headers || {};
    const signer = h["orderly-key"];
    if (keys.get(signer) !== h["orderly-account-id"]) return false;
    const path = new URL(url).pathname;
    const msg = new TextEncoder().encode(`${h["orderly-timestamp"]}${init.method}${path}${init.body || ""}`);
    return ed.verifyAsync(unb64url(h["orderly-signature"]), msg, bs58.decode(signer.slice(8)));
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(`${init.method || "GET"} ${u.pathname}`);
    const ok = (data) => new Response(JSON.stringify({ success: true, data }));
    const no = (code, message) => new Response(JSON.stringify({ success: false, code, message }));
    if (u.pathname === "/v1/orderly_key") {
      if (refuseAdd) return no(-1, "refused");
      const b = JSON.parse(init.body);
      keys.set(b.orderlyKey, init.headers["X-Account-Id"]);
      return ok({ orderly_key: b.orderlyKey });
    }
    if (u.pathname === "/v1/client/remove_orderly_key") {
      if (refuseRemove || !(await verify(url, init))) return no(-2, "bad signature or refused");
      keys.delete(JSON.parse(init.body).orderly_key);
      return ok({});
    }
    if (u.pathname === "/v1/get_orderly_key") {
      const k = u.searchParams.get("orderly_key");
      return keys.get(k) === u.searchParams.get("account_id") ? ok({ key_status: "ACTIVE" }) : no(-3, "not found");
    }
    if (u.pathname === "/v1/get_account") return accounts.has(orderlyAccountId(u.searchParams.get("address"), "nexus_trading")) ? ok({ account_id: orderlyAccountId(u.searchParams.get("address"), "nexus_trading") }) : no(-4, "no account");
    if (u.pathname === "/v1/registration_nonce") return ok({ registration_nonce: "123456" });
    if (u.pathname === "/v1/register_account") { const b = JSON.parse(init.body); const id = orderlyAccountId(b.userAddress, "nexus_trading"); accounts.add(id); return ok({ account_id: id }); }
    if (u.host === "api.bankr.bot") return bankr(init);
    throw new Error(`unexpected fetch ${url}`);
  };
  let bankrAccount = alice;
  const bankr = async (init) => {
    const b = JSON.parse(init.body);
    const { EIP712Domain, ...types } = b.typedData.types;
    const signature = await bankrAccount.signTypedData({ domain: b.typedData.domain, types, primaryType: b.typedData.primaryType, message: b.typedData.message });
    return new Response(JSON.stringify({ success: true, signature }));
  };
  return { keys, calls, fetchImpl, setBankr: (acct) => { bankrAccount = acct; } };
}

function lockNs() {
  const objs = new Map();
  return {
    idFromName: (n) => n,
    get(id) {
      if (!objs.has(id)) {
        const store = new Map();
        const obj = new NexusLock({ storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } } });
        let q = Promise.resolve();
        objs.set(id, { fetch(url) { const p = q.then(() => obj.fetch(new Request(url))); q = p.catch(() => {}); return p; } });
      }
      return objs.get(id);
    },
  };
}

const envOn = (extra = {}) => ({ NEXUS_AGENT: kv(), AGENT_ENC_KEY: ENC, AUTH_V2_KEYS: "true", ...extra });
const req = (method, path, body) => new Request(`https://og.test${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const parts = (p) => p.split("/").filter(Boolean);
const call = (env, method, path, body, o, at = T0) => handleKey(parts(path), req(method, path, body), env, { now: () => at, fetchImpl: o.fetchImpl, randomBytes: rnd });

async function session(account, at = T0) {
  const s = newTradingSession({ address: account.address, now: at, randomBytes: rnd });
  return { session: s.session, issued: s.issued, expires: s.expires, sig: await account.signMessage({ message: s.message }) };
}
async function challenge(env, account, action, at = T0) {
  const nonce = `n${seq++}`;
  const record = { action, wallet: account.address.toLowerCase(), nonce, amount: null, expires: at + 120000 };
  await env.NEXUS_AGENT.put(`auth:nonce:${nonce}`, JSON.stringify(record));
  return { nonce, v2Sig: await account.signMessage({ message: buildChallenge(record) }) };
}
const signAdd = (account, typedData) => {
  const { EIP712Domain, ...types } = typedData.types;
  return account.signTypedData({ domain: typedData.domain, types, primaryType: typedData.primaryType, message: typedData.message });
};
async function register(env, o, account = alice, at = T0) {
  const sess = await session(account, at);
  const begun = await (await call(env, "POST", "/v2/key/begin", { wallet: account.address, session: sess }, o, at)).json();
  const ch = await challenge(env, account, "key.register", at);
  const res = await call(env, "POST", "/v2/key/complete", { wallet: account.address, session: sess, pendingId: begun.pendingId, ...ch, eip712Sig: await signAdd(account, begun.typedData) }, o, at);
  return { begun, res, body: await res.json() };
}
const stored = (env) => JSON.parse(env.NEXUS_AGENT.m.get(V2_KEY(A)) || "null");

test("off unless AUTH_V2_KEYS is \"true\"; no key store, no service", async () => {
  const o = fakeOrderly();
  for (const v of [undefined, "false", "1", "TRUE"]) {
    const res = await call({ ...envOn(), AUTH_V2_KEYS: v }, "POST", "/v2/key/begin", { wallet: A }, o);
    assert.equal(res.status, 404, String(v));
    assert.equal((await res.json()).error, "v2_keys_off");
  }
  assert.equal((await call(envOn({ AGENT_ENC_KEY: "" }), "GET", `/v2/key/${A}`, undefined, o)).status, 503);
  assert.equal(await handleKey(["v2", "session", "end-all"], req("POST", "/v2/session/end-all", {}), envOn()), null, "other /v2 routes aren't this handler's");
});

test("the key is random, its typed data is the v1 registration's but 30 days, and only an exact v2 key passes", async () => {
  const a = await newKeyMaterial(), b = await newKeyMaterial();
  assert.notEqual(a.secret, b.secret);
  assert.equal(await orderlyKeyOf(a.secret), a.orderlyKey);
  const m = addKeyMessage({ orderlyKey: a.orderlyKey, now: T0 });
  assert.deepEqual(m, { brokerId: "nexus_trading", chainId: 42161, orderlyKey: a.orderlyKey, scope: "read,trading", timestamp: T0, expiration: T0 + 30 * DAY });
  const td = addKeyTypedData(m);
  assert.deepEqual(td.domain, { name: "Orderly", version: "1", chainId: 42161, verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC" });
  assert.deepEqual(td.types.AddOrderlyKey.map((f) => `${f.name}:${f.type}`), ["brokerId:string", "chainId:uint256", "orderlyKey:string", "scope:string", "timestamp:uint64", "expiration:uint64"]);
  assert.equal(td.primaryType, "AddOrderlyKey");
  assert.equal(addKeyRefusal(m), null);
  assert.equal(addKeyRefusal({ ...m, scope: "read,trading,asset" }), "wrong_scope", "a v2 key can never withdraw");
  assert.equal(addKeyRefusal({ ...m, expiration: T0 + 31 * DAY }), "bad_lifetime");
  assert.equal(addKeyRefusal({ ...m, brokerId: "other" }), "wrong_broker");
  assert.equal(addKeyRefusal({ ...m, chainId: 1 }), "wrong_chain");
  assert.equal(V2_KEY_DAYS, 30);
});

test("nothing here derives a key from a signature or touches the v1 records", () => {
  const src = readFileSync(new URL("./routes-key.mjs", import.meta.url), "utf8") + readFileSync(new URL("./v2Keys.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /nexus-trading-key-v1|TRADING_MESSAGE|SHA-256|agent:key:|"user:/);
});

test("begin needs a live session from this wallet", async () => {
  const env = envOn(), o = fakeOrderly();
  assert.equal((await call(env, "POST", "/v2/key/begin", { wallet: A }, o)).status, 401);
  assert.equal((await call(env, "POST", "/v2/key/begin", { wallet: A, session: await session(mallory) }, o)).status, 401, "someone else's session");
  assert.equal((await call(env, "POST", "/v2/key/begin", { wallet: A, session: await session(alice) }, o, T0 + 25 * 3600000)).status, 401, "expired");
  assert.equal(env.NEXUS_AGENT.m.size, 0);
});

test("register: begin holds the key sealed; complete needs the challenge and the wallet's EIP-712; the stored secret is the registered key", async () => {
  const env = envOn(), o = fakeOrderly();
  const { begun, res, body } = await register(env, o);
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.active, true);
  assert.equal(body.expiresInDays, 30);
  assert.equal(body.orderlyKey, begun.orderlyKey);
  assert.ok(o.keys.has(begun.orderlyKey), "Orderly holds the new key on alice's account");
  const rec = stored(env);
  assert.equal(rec.v, 2);
  assert.equal(rec.scope, "read,trading");
  assert.equal(rec.accountId, ACCT);
  assert.match(rec.tradingKey, /^v1:/, "sealed at rest");
  assert.equal(env.NEXUS_AGENT.m.has(V2_PENDING(A)), false, "pending cleared");
  // the GET never shows the secret
  const st = await (await call(env, "GET", `/v2/key/${A}`, undefined, o)).json();
  assert.equal(st.active, true);
  assert.equal("tradingKey" in st, false);
  assert.doesNotMatch(JSON.stringify(st) + JSON.stringify(body), /v1:/);
});

test("complete refuses: no challenge, the wrong action, a replayed nonce, another wallet's EIP-712, an unknown pending", async () => {
  const env = envOn(), o = fakeOrderly();
  const sess = await session(alice);
  const begun = await (await call(env, "POST", "/v2/key/begin", { wallet: A, session: sess }, o)).json();
  const sig = await signAdd(alice, begun.typedData);
  const base = { wallet: A, session: sess, pendingId: begun.pendingId, eip712Sig: sig };
  assert.equal((await call(env, "POST", "/v2/key/complete", base, o)).status, 401, "no challenge");
  assert.equal((await call(env, "POST", "/v2/key/complete", { ...base, ...(await challenge(env, alice, "key.remove")) }, o)).status, 401, "a remove challenge can't register");
  const ch = await challenge(env, alice, "key.register");
  const wrongSigner = await call(env, "POST", "/v2/key/complete", { ...base, ...ch, eip712Sig: await signAdd(mallory, begun.typedData) }, o);
  assert.equal(wrongSigner.status, 401);
  assert.equal((await wrongSigner.json()).error, "eip712_wrong_signer");
  assert.equal((await call(env, "POST", "/v2/key/complete", { ...base, ...ch }, o)).status, 401, "the nonce was burned: no replay");
  assert.equal((await call(env, "POST", "/v2/key/complete", { ...base, pendingId: "f".repeat(32), ...(await challenge(env, alice, "key.register")) }, o)).status, 409);
  assert.equal(stored(env), null, "nothing stored");
  assert.equal(o.keys.size, 0, "nothing registered at Orderly");
});

test("a signature over different typed data than begin returned is refused", async () => {
  const env = envOn(), o = fakeOrderly();
  const sess = await session(alice);
  const begun = await (await call(env, "POST", "/v2/key/begin", { wallet: A, session: sess }, o)).json();
  const tampered = addKeyTypedData({ ...begun.typedData.message, scope: "read,trading,asset" });
  const res = await call(env, "POST", "/v2/key/complete", { wallet: A, session: sess, pendingId: begun.pendingId, ...(await challenge(env, alice, "key.register")), eip712Sig: await signAdd(alice, tampered) }, o);
  assert.equal(res.status, 401);
  assert.equal(o.keys.size, 0);
});

test("Orderly's refusal stores nothing and clears the pending key", async () => {
  const env = envOn(), o = fakeOrderly({ refuseAdd: true });
  const { res } = await register(env, o);
  assert.equal(res.status, 502);
  assert.equal(stored(env), null);
  assert.equal(env.NEXUS_AGENT.m.has(V2_PENDING(A)), false);
});

test("rotate: the new key removes the old one at Orderly (a signature Orderly verifies)", async () => {
  const env = envOn(), o = fakeOrderly();
  const first = await register(env, o);
  const second = await register(env, o, alice, T0 + DAY);
  assert.equal(second.body.rotated, true);
  assert.deepEqual(second.body.retiredStillLive, []);
  assert.equal(o.keys.has(first.begun.orderlyKey), false, "old key gone at Orderly");
  assert.equal(o.keys.has(second.begun.orderlyKey), true);
  assert.deepEqual(stored(env).retired, []);
});

test("rotate when Orderly won't remove the old key: it stays listed and remove clears it later", async () => {
  const o = fakeOrderly();
  const env = envOn();
  const first = await register(env, o);
  const o2 = { ...o, fetchImpl: async (url, init) => (String(url).includes("remove_orderly_key") ? new Response(JSON.stringify({ success: false })) : o.fetchImpl(url, init)) };
  const second = await register(env, o2, alice, T0 + DAY);
  assert.deepEqual(second.body.retiredStillLive, [first.begun.orderlyKey]);
  assert.deepEqual(stored(env).retired, [first.begun.orderlyKey]);
  const sess = await session(alice, T0 + DAY);
  const rm = await call(env, "POST", "/v2/key/remove", { wallet: A, session: sess, ...(await challenge(env, alice, "key.remove", T0 + DAY)) }, o, T0 + DAY);
  assert.equal(rm.status, 200);
  assert.equal(o.keys.size, 0, "both keys removed at Orderly");
  assert.equal(stored(env), null);
});

test("remove: needs the key.remove challenge; Orderly's refusal keeps the record", async () => {
  const env = envOn(), o = fakeOrderly();
  await register(env, o);
  const sess = await session(alice);
  assert.equal((await call(env, "POST", "/v2/key/remove", { wallet: A, session: sess }, o)).status, 401);
  const refusing = fakeOrderly({ refuseRemove: true });
  for (const [k, v] of o.keys) refusing.keys.set(k, v);
  const res = await call(env, "POST", "/v2/key/remove", { wallet: A, session: sess, ...(await challenge(env, alice, "key.remove")) }, refusing);
  assert.equal(res.status, 502);
  assert.ok(stored(env), "kept so it can be tried again");
  const ok = await call(env, "POST", "/v2/key/remove", { wallet: A, session: sess, ...(await challenge(env, alice, "key.remove")) }, o);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, "removed");
  assert.equal(stored(env), null);
  assert.equal(o.keys.size, 0);
});

test("bankr-register: makes the account if needed, Bankr signs the typed data, the key is stored", async () => {
  const env = envOn(), o = fakeOrderly({ accounts: new Set() });
  const res = await call(env, "POST", "/v2/key/bankr-register", { walletAddress: alice.address, bankrApiKey: "bk_test" }, o);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.active, true);
  assert.ok(o.calls.includes("POST /v1/register_account"));
  assert.ok(o.keys.has(body.orderlyKey));
  assert.ok(stored(env));
});

test("bankr-register refuses a Bankr key that signs as another wallet, and stores nothing", async () => {
  const env = envOn(), o = fakeOrderly();
  o.setBankr(mallory);
  const res = await call(env, "POST", "/v2/key/bankr-register", { walletAddress: alice.address, bankrApiKey: "bk_test" }, o);
  assert.equal(res.status, 401);
  assert.equal(stored(env), null);
  assert.equal(o.keys.size, 0);
});

test("a revoked wallet can still register a v2 key (its path back), and the v1 Bankr routes stay refused", () => {
  const revoked = new Set([A]);
  const recover = recoverEthAddress;
  assert.equal(revokedTradingRefusal({ method: "POST", parts: ["v2", "key", "bankr-register"], body: { walletAddress: A }, revoked, recover }), null);
  assert.equal(revokedTradingRefusal({ method: "POST", parts: ["proxy", "bankr-register"], body: { walletAddress: A }, revoked, recover }).status, 403);
});

test("two completes at once under the lock: one key registered", async () => {
  const env = envOn({ NEXUS_LOCK: lockNs() }), o = fakeOrderly();
  const sess = await session(alice);
  const begun = await (await call(env, "POST", "/v2/key/begin", { wallet: A, session: sess }, o)).json();
  const sig = await signAdd(alice, begun.typedData);
  const go = async () => call(env, "POST", "/v2/key/complete", { wallet: A, session: sess, pendingId: begun.pendingId, ...(await challenge(env, alice, "key.register")), eip712Sig: sig }, o);
  const [r1, r2] = await Promise.all([go(), go()]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal(o.calls.filter((c) => c === "POST /v1/orderly_key").length, 1);
});

test("the challenge actions exist for /auth/challenge to mint", () => {
  assert.ok(AUTH_V2_ACTIONS.has("key.register") && AUTH_V2_ACTIONS.has("key.remove"));
});

test("status: expired keys read as expired; no record reads inactive", () => {
  assert.deepEqual(publicKeyStatus(null), { active: false });
  const rec = { v: 2, orderlyKey: "ed25519:x", scope: "read,trading", accountId: ACCT, registeredAt: T0, expiresAt: T0 + 30 * DAY, retired: [] };
  assert.equal(publicKeyStatus(rec, T0 + 31 * DAY).expired, true);
  assert.equal(publicKeyStatus(rec, T0 + 2 * DAY).expiresInDays, 28);
});
