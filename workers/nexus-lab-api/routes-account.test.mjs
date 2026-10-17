// Run: node --test workers/nexus-lab-api/routes-account.test.mjs
// The trading-account record user:{addr}: nothing serves a wallet's positions or orders without its
// signature, nothing stores the trading key's seed, the seeds already stored are removed, and
// register-key stores only what Orderly accepted. Real route code, fake KV, fake Orderly (no network).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleAccount, registerKeyTarget, scrubStoredSeeds, SCRUB_STATE_KEY } from "./routes-account.mjs";

const A = "0x" + "a".repeat(40);
const KEY = "ed25519:" + "8".repeat(44);
const OTHER_KEY = "ed25519:" + "9".repeat(44);

function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const log = [];
  return {
    m, log,
    async get(k) { log.push(["get", k]); return m.has(k) ? m.get(k) : null; },
    async put(k, v) { log.push(["put", k]); m.set(k, v); },
    async delete(k) { log.push(["delete", k]); m.delete(k); },
    async list({ prefix, cursor, limit = 1000 }) {
      const all = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const keys = all.slice(start, start + limit).map((name) => ({ name }));
      const end = start + keys.length;
      return end >= all.length ? { keys, list_complete: true } : { keys, list_complete: false, cursor: String(end) };
    },
  };
}
function fakeOrderly(answer) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/v1/get_account")) return new Response(JSON.stringify({ success: true, data: { account_id: "0xacc" } }));
    return new Response(JSON.stringify(answer));
  };
  return { f, calls };
}
const req = (method, path, body) => new Request(`https://og.test${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});
const call = async (env, f, method, path, body) => {
  const res = await handleAccount(path.split("?")[0].split("/").filter(Boolean), req(method, path, body), env, { fetch: f });
  return { status: res.status, body: await res.json() };
};
const regBody = (over = {}) => ({
  message: { brokerId: "nexus_trading", chainId: 42161, orderlyKey: KEY, scope: "read,trading", timestamp: 1, expiration: 2 },
  signature: "0x" + "11".repeat(65), userAddress: A, orderlyKey: KEY, ...over,
});

test("/account-snapshot is retired: 410, and it reads nothing", async () => {
  const env = { LAB_STORE: kv({ [`user:${A}`]: { accountId: "0xacc", orderlyKey: KEY, seed: "ab".repeat(32) } }) };
  const { f, calls } = fakeOrderly({});
  const r = await call(env, f, "GET", `/account-snapshot?wallet=${A}`);
  assert.equal(r.status, 410);
  assert.equal(r.body.error, "gone");
  assert.match(r.body.hint, /POST \/positions/);
  assert.equal(env.LAB_STORE.log.length, 0);
  assert.equal(calls.length, 0);
});

test("register-key: nothing stored unless Orderly says success === true", async () => {
  for (const answer of [
    { success: false, code: -1, message: "address and signature do not match" },
    { success: false, data: { account_id: "0xacc" } }, // the old `success || data` stored this one
    { data: { account_id: "0xacc" } },
  ]) {
    const env = { LAB_STORE: kv() };
    const { f } = fakeOrderly(answer);
    const r = await call(env, f, "POST", "/proxy/register-key", regBody());
    assert.equal(r.status, 200);
    assert.equal(env.LAB_STORE.m.has(`user:${A}`), false, JSON.stringify(answer));
  }
});

test("register-key: on success, stores the key Orderly registered, for the address it checked, and no seed", async () => {
  const env = { LAB_STORE: kv() };
  const { f, calls } = fakeOrderly({ success: true, data: { orderly_key: KEY } });
  const body = regBody({ userAddress: A.toUpperCase().replace("0X", "0x") });
  const r = await call(env, f, "POST", "/proxy/register-key", body);
  assert.equal(r.status, 200); assert.equal(r.body.success, true);
  const rec = JSON.parse(env.LAB_STORE.m.get(`user:${A}`));
  assert.deepEqual(Object.keys(rec).sort(), ["accountId", "orderlyKey", "registeredAt"]);
  assert.equal(rec.orderlyKey, KEY);
  // The request goes to Orderly exactly as signed.
  const sent = calls.find((c) => c.url.endsWith("/v1/orderly_key"));
  assert.deepEqual(JSON.parse(sent.init.body), body);
});

test("register-key: a top-level key that isn't the signed one, or no signed key, is refused before Orderly", async () => {
  for (const [body, why] of [
    [regBody({ orderlyKey: OTHER_KEY }), /does not match/],
    [regBody({ message: { brokerId: "nexus_trading" } }), /message.orderlyKey/],
    [regBody({ userAddress: "not-an-address" }), /userAddress/],
  ]) {
    const env = { LAB_STORE: kv() };
    const { f, calls } = fakeOrderly({ success: true });
    const r = await call(env, f, "POST", "/proxy/register-key", body);
    assert.equal(r.status, 400); assert.match(r.body.error, why);
    assert.equal(calls.length, 0);
    assert.equal(env.LAB_STORE.m.size, 0);
  }
  // The app's own shape passes.
  assert.deepEqual(registerKeyTarget(regBody()), { ok: true, wallet: A, orderlyKey: KEY });
});

test("scrub: removes every stored seed over several runs, two passes, touches nothing else", async () => {
  const init = { "lab:x": { theses: [], seed: "keep-not-a-user-record" } };
  for (let i = 0; i < 5; i++) init[`user:0x${String(i).repeat(40)}`] = { accountId: `a${i}`, orderlyKey: KEY, seed: "cd".repeat(32) };
  init[`user:0x${"7".repeat(40)}`] = { accountId: "a7", orderlyKey: KEY }; // no seed: never rewritten
  const env = { LAB_STORE: kv(init) };
  let r, runs = 0;
  do { r = await scrubStoredSeeds(env, { page: 2, now: () => 1000 + runs }); runs++; } while (!r.done && runs < 20);
  assert.equal(r.done, true); assert.equal(r.passes, 2);
  assert.equal(r.scrubbed, 5);
  for (const [k, v] of env.LAB_STORE.m) if (k.startsWith("user:")) {
    const rec = JSON.parse(v);
    assert.equal("seed" in rec, false, k);
    assert.equal(rec.orderlyKey, KEY);
  }
  assert.equal(JSON.parse(env.LAB_STORE.m.get("lab:x")).seed, "keep-not-a-user-record");
  assert.equal(env.LAB_STORE.log.filter(([op, k]) => op === "put" && k === `user:0x${"7".repeat(40)}`).length, 0);
  // Done means done: no more reads.
  const before = env.LAB_STORE.log.length;
  assert.equal((await scrubStoredSeeds(env)).ran, false);
  assert.equal(env.LAB_STORE.log.length, before + 1); // just the state read
  // Progress route: counts only.
  const st = await call(env, fakeOrderly({}).f, "GET", "/ops/seed-scrub");
  assert.deepEqual(Object.keys(st.body).sort(), ["doneAt", "done", "scanned", "scrubbed", "startedAt"].sort());
  assert.equal(st.body.done, true); assert.equal(st.body.scrubbed, 5);
});

test("scrub: a record rewritten between its two reads is left for the next pass", async () => {
  const k = `user:${A}`;
  const store = kv({ [k]: { accountId: "old", orderlyKey: KEY, seed: "ee".repeat(32) } });
  let reads = 0;
  const realGet = store.get.bind(store);
  store.get = async (key) => {
    if (key === k && ++reads === 2) store.m.set(k, JSON.stringify({ accountId: "new", orderlyKey: OTHER_KEY, registeredAt: 5 }));
    return realGet(key);
  };
  await scrubStoredSeeds({ LAB_STORE: store }, { page: 10 });
  assert.equal(JSON.parse(store.m.get(k)).accountId, "new"); // the fresh registration survived
  assert.equal(JSON.parse(store.m.get(SCRUB_STATE_KEY)).scrubbed, 0);
});

test("nothing in the worker writes or reads a stored seed any more", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.equal(/\bseed\s*:/.test(src), false, "a `seed:` field is written somewhere in index.js");
  assert.equal(/\.seed\b/.test(src), false, "a stored `.seed` is read somewhere in index.js");
  assert.equal(/account-snapshot"/.test(src), false, "the snapshot route is back in index.js");
});

test("no trading-key route reads a signature from the URL", () => {
  // walletSig derives the trading key; a URL lands in logs. The Holders Room check (routes-feed.mjs)
  // is the one exception: a 10-minute, read-only challenge signature, not the trading-key one.
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.equal(/\.get\(\s*"(sig|walletSig)"\s*\)/.test(src), false, "index.js reads a signature from the query string");
  assert.match(src, /error: "signature_in_url"/, "/positions and /balance must refuse a signature in the URL");
});
