// Run: node --test workers/nexus-lab-api/routes-account.test.mjs
// The trading-account record user:{addr}: register-key stores only what Orderly accepted, and no
// trading-key route takes a signature from the URL. Real route code, fake KV, fake Orderly (no network).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleAccount, registerKeyTarget, orderHistoryResult } from "./routes-account.mjs";

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

test("register-key: on success, stores the key Orderly registered, for the address it checked", async () => {
  const env = { LAB_STORE: kv() };
  const { f, calls } = fakeOrderly({ success: true, data: { orderly_key: KEY } });
  const body = regBody({ userAddress: A.toUpperCase().replace("0X", "0x") });
  const r = await call(env, f, "POST", "/proxy/register-key", body);
  assert.equal(r.status, 200); assert.equal(r.body.success, true);
  const rec = JSON.parse(env.LAB_STORE.m.get(`user:${A}`));
  assert.deepEqual(Object.keys(rec).sort(), ["accountId", "orderlyKey", "registeredAt"]);
  assert.equal(rec.accountId, "0xacc");
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

test("no trading-key route reads a signature from the URL", () => {
  // walletSig derives the trading key; a URL lands in logs. The Holders Room check (routes-feed.mjs)
  // is the one exception: a 10-minute, read-only challenge signature, not the trading-key one.
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.equal(/\.get\(\s*"(sig|walletSig)"\s*\)/.test(src), false, "index.js reads a signature from the query string");
  assert.match(src, /error: "signature_in_url"/, "/positions and /balance must refuse a signature in the URL");
});

test("order-history: Orderly's rows become the list, with when it was read", () => {
  const reply = JSON.stringify({ success: true, data: { rows: [
    { order_id: 7, symbol: "PERP_BTC_USDC", side: "BUY", type: "LIMIT", status: "NEW", price: 60000, quantity: 0.01,
      executed: 0, average_executed_price: null, total_fee: 0, fee_asset: "USDC", created_time: 1, updated_time: 2 },
  ] } });
  const r = orderHistoryResult(200, reply, 1234);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true); assert.equal(r.body.count, 1); assert.equal(r.body.fetchedAt, 1234);
  assert.deepEqual(r.body.orders[0], {
    orderId: 7, symbol: "PERP_BTC_USDC", side: "BUY", type: "LIMIT", status: "NEW", price: 60000, quantity: 0.01,
    executedQty: 0, avgPrice: null, fee: 0, feeCurrency: "USDC", createdAt: 1, updatedAt: 2,
  });
  // A real empty book is still an empty list.
  const empty = orderHistoryResult(200, JSON.stringify({ success: true, data: { rows: [] } }));
  assert.equal(empty.status, 200); assert.equal(empty.body.count, 0);
});

test("order-history: a refused read is a 502, never an empty book", () => {
  for (const [status, text, code] of [
    [401, JSON.stringify({ success: false, code: -1004, message: "orderly key error" }), -1004],
    [429, JSON.stringify({ success: false, code: -1003, message: "too many requests" }), -1003],
    [200, JSON.stringify({ success: true, data: {} }), null], // no rows array: not a list
    [403, "<html>Just a moment...</html>", null],
  ]) {
    const r = orderHistoryResult(status, text);
    assert.equal(r.status, 502, text);
    assert.equal(r.body.ok, false); assert.equal(r.body.error, "orderly_error");
    assert.equal(r.body.upstreamStatus, status); assert.equal(r.body.code, code);
    assert.equal("orders" in r.body, false); assert.equal("count" in r.body, false);
  }
});
