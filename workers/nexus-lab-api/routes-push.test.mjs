// /push/* end to end with a real wallet signature (the same Lab signature the app already holds).
import { test } from "node:test";
import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { labSaveMessage } from "../../app/lib/labAuth.mjs";
import { handlePush } from "./routes-push.mjs";
import { b64u } from "./webpush.mjs";

const alice = privateKeyToAccount("0x" + "a1".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const A = alice.address.toLowerCase();
const jwk = JSON.stringify(nodeCrypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }));
const auth = async (acct) => { const ts = Date.now(); return { ts, sig: await acct.signMessage({ message: labSaveMessage(acct.address, ts) }) }; };

function kv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, String(v)); }, async delete(k) { m.delete(k); } };
}
const e = nodeCrypto.createECDH("prime256v1"); e.generateKeys();
const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/phone1", keys: { p256dh: b64u.encode(e.getPublicKey()), auth: b64u.encode(nodeCrypto.randomBytes(16)) } };
const call = (env, method, path, body) => handlePush(path.split("/").filter(Boolean),
  new Request(`https://og.test${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

test("config says off until the secret is set, and every write route refuses", async () => {
  const env = { LAB_STORE: kv() };
  assert.deepEqual(await (await call(env, "GET", "/push/config")).json(), { enabled: false, publicKey: null });
  assert.equal((await call(env, "POST", "/push/subscribe", { wallet: A, subscription: SUB, labAuth: await auth(alice) })).status, 404);
  assert.equal(env.LAB_STORE.m.size, 0);
});

test("config hands out the public key the server signs with", async () => {
  const r = await (await call({ LAB_STORE: kv(), VAPID_PRIVATE_JWK: jwk }, "GET", "/push/config")).json();
  assert.equal(r.enabled, true);
  assert.equal(b64u.decode(r.publicKey).length, 65);
});

test("subscribe needs the wallet's own signature", async () => {
  const env = { LAB_STORE: kv(), VAPID_PRIVATE_JWK: jwk };
  assert.equal((await call(env, "POST", "/push/subscribe", { wallet: A, subscription: SUB })).status, 401);
  assert.equal((await call(env, "POST", "/push/subscribe", { wallet: A, subscription: SUB, labAuth: await auth(mallory) })).status, 401);
  assert.equal(env.LAB_STORE.m.size, 0, "a refused subscribe writes nothing");
  const bad = { ...SUB, endpoint: "https://evil.example/collect" };
  assert.equal((await call(env, "POST", "/push/subscribe", { wallet: A, subscription: bad, labAuth: await auth(alice) })).status, 400);

  const ok = await call(env, "POST", "/push/subscribe", { wallet: A, subscription: SUB, topics: { social: true }, labAuth: await auth(alice) });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).topics, { calls: true, agent: true, social: true });
  assert.equal(JSON.parse(env.LAB_STORE.m.get(`push:wallet:${A}`)).length, 1);
});

test("test push: one per minute, only to a subscribed device; unsubscribe by endpoint", async () => {
  const env = { LAB_STORE: kv(), VAPID_PRIVATE_JWK: jwk };
  assert.equal((await call(env, "POST", "/push/test", { endpoint: SUB.endpoint })).status, 404);
  await call(env, "POST", "/push/subscribe", { wallet: A, subscription: SUB, labAuth: await auth(alice) });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 201 });
  try {
    assert.equal((await call(env, "POST", "/push/test", { endpoint: SUB.endpoint })).status, 200);
    assert.equal((await call(env, "POST", "/push/test", { endpoint: SUB.endpoint })).status, 429);
  } finally { globalThis.fetch = realFetch; }
  const un = await (await call(env, "POST", "/push/unsubscribe", { endpoint: SUB.endpoint })).json();
  assert.deepEqual(un, { ok: true, removed: true });
  assert.equal(env.LAB_STORE.m.get(`push:wallet:${A}`), undefined);
});
