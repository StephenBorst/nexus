// Run: node --test workers/nexus-lab-api/keyProxy.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { keyProxyOriginOk, makeRateLimiter } from "./keyProxy.mjs";

test("origin gate: our app origins pass; others, missing, look-alikes and http previews fail", () => {
  assert.equal(keyProxyOriginOk("https://trade.nexustradinglabs.com"), true);
  assert.equal(keyProxyOriginOk("https://nexus-trading-lab.pages.dev"), true);
  assert.equal(keyProxyOriginOk("https://abc123.nexus-trading-lab.pages.dev"), true);
  assert.equal(keyProxyOriginOk("http://localhost:5173"), true);
  for (const bad of ["", null, "https://evil.com", "https://evilnexus-trading-lab.pages.dev", "https://nexus-trading-lab.pages.dev.evil.com", "http://abc.nexus-trading-lab.pages.dev", "not a url"]) {
    assert.equal(keyProxyOriginOk(bad), false, String(bad));
  }
});

test("rate limiter: allows `limit` per window per key, then blocks, then resets", () => {
  const over = makeRateLimiter({ limit: 3, windowMs: 1000 });
  assert.deepEqual([over("a", 0), over("a", 1), over("a", 2), over("a", 3)], [false, false, false, true]);
  assert.equal(over("b", 3), false, "keys are independent");
  assert.equal(over("a", 1000), false, "new window");
});

import { flashUpstream } from "./keyProxy.mjs";
const Q = (o = {}) => new URLSearchParams(o);
const ADDR = "0x06cD9c281E6ab09906B46a10e059F2770EfdE49A";
const ID = "b895f841-3c4c-4705-ab44-1bf274c762f1";

test("flash proxy: exactly the five routes the Spot ticket uses, each to one fixed Flash URL", () => {
  assert.deepEqual(flashUpstream("POST", ["flash", "quote"], Q()), { url: "https://flash.definitive.fi/v1/quote", method: "POST", body: true });
  assert.deepEqual(flashUpstream("POST", ["flash", "order"], Q()), { url: "https://flash.definitive.fi/v1/order", method: "POST", body: true });
  assert.deepEqual(flashUpstream("POST", ["flash", "orders", ID, "cancel"], Q()), { url: `https://flash.definitive.fi/v1/orders/${ID}/cancel`, method: "POST", body: true });
  assert.deepEqual(flashUpstream("GET", ["flash", "orders", ID], Q({ funderAddress: ADDR })), { url: `https://flash.definitive.fi/v1/orders/${ID}?funderAddress=${ADDR}`, method: "GET", body: false });
  const list = flashUpstream("GET", ["flash", "orders"], Q({ funderAddress: ADDR, statuses: "ORDER_STATUS_PENDING,ORDER_STATUS_ACCEPTED", pageToken: "abc_12-3=" }));
  const u = new URL(list.url);
  assert.equal(u.origin + u.pathname, "https://flash.definitive.fi/v1/orders");
  assert.equal(u.searchParams.get("funderAddress"), ADDR);
  assert.equal(u.searchParams.get("statuses"), "ORDER_STATUS_PENDING,ORDER_STATUS_ACCEPTED");
  assert.equal(u.searchParams.get("pageToken"), "abc_12-3=");
  assert.equal(u.searchParams.get("pageSize"), "100");
});

test("flash proxy: anything else is refused (other endpoints, bad ids, bad funders, smuggled params)", () => {
  const bad = [
    ["POST", ["flash", "setup-transaction"], Q()],
    ["POST", ["flash", "orders", "cancel"], Q()],                       // batch cancel: not ours
    ["PATCH", ["flash", "orders", ID], Q()],
    ["DELETE", ["flash", "orders", ID], Q({ funderAddress: ADDR })],
    ["GET", ["flash", "quote"], Q()],
    ["GET", ["flash", "orders"], Q()],                                   // no funder
    ["GET", ["flash", "orders"], Q({ funderAddress: "0x123" })],
    ["GET", ["flash", "orders"], Q({ funderAddress: ADDR + "&pageSize=200" })],
    ["GET", ["flash", "orders", "..", "balances"], Q({ funderAddress: ADDR })],
    ["GET", ["flash", "orders", "not-a-uuid"], Q({ funderAddress: ADDR })],
    ["POST", ["flash", "orders", ID + "x", "cancel"], Q()],
    ["POST", ["flash", "orders", ID, "cancel", "x"], Q()],
    ["GET", ["flash", "orders"], Q({ funderAddress: ADDR, statuses: "ORDER_STATUS_FILLED,DROP" })],
    ["GET", ["flash", "orders"], Q({ funderAddress: ADDR, pageToken: "a b" })],
    ["GET", ["flash", "balances", ADDR], Q()],
    ["GET", ["swap", "orders"], Q({ funderAddress: ADDR })],
  ];
  for (const [m, p, q] of bad) assert.equal(flashUpstream(m, p, q), null, `${m} /${p.join("/")}?${q}`);
});

import { withFlashFee, flashFeeBps } from "./keyProxy.mjs";

test("Flash fee: unset/0/invalid ships the body untouched (dark)", () => {
  const body = JSON.stringify({ side: "buy", qty: "20" });
  for (const env of [{}, { FLASH_FEE_BPS: "" }, { FLASH_FEE_BPS: "0" }, { FLASH_FEE_BPS: "abc" }, { FLASH_FEE_BPS: "2.5" }, { FLASH_FEE_BPS: "-5" }, { FLASH_FEE_BPS: "101" }]) {
    assert.equal(withFlashFee(body, env), body, JSON.stringify(env));
    assert.equal(flashFeeBps(env), 0);
  }
});

test("Flash fee: set ⇒ the same string on every request; a browser-sent fee is always dropped", () => {
  const env = { FLASH_FEE_BPS: "10" };
  const q = JSON.parse(withFlashFee(JSON.stringify({ side: "buy", qty: "20" }), env));
  const o = JSON.parse(withFlashFee(JSON.stringify({ side: "buy", qty: "20", userSignature: "0x1", flashIntegratorFeeBps: "999" }), env));
  assert.equal(q.flashIntegratorFeeBps, "10");
  assert.equal(o.flashIntegratorFeeBps, "10");
  assert.equal(o.userSignature, "0x1");
  assert.equal("flashIntegratorFeeBps" in JSON.parse(withFlashFee(JSON.stringify({ flashIntegratorFeeBps: "50" }), {})), false);
  assert.equal(withFlashFee("not json", env), "not json");
});

import { withFlashAttribution, flashAttributionCode } from "./keyProxy.mjs";

test("Flash attribution: order-only, from our var; a browser-sent code is dropped on both routes", () => {
  const env = { FLASH_ATTRIBUTION_CODE: "nexustradinglabs" };
  const body = JSON.stringify({ side: "buy", qty: "20", erc8021AttributionCode: "someoneelse" });
  assert.equal(JSON.parse(withFlashAttribution(body, env, { isOrder: true })).erc8021AttributionCode, "nexustradinglabs");
  assert.equal("erc8021AttributionCode" in JSON.parse(withFlashAttribution(body, env, { isOrder: false })), false, "never on /quote");
  // unset: an untouched body ships byte-identical; a browser value is still stripped
  const plain = JSON.stringify({ side: "buy", qty: "20" });
  assert.equal(withFlashAttribution(plain, {}, { isOrder: true }), plain);
  assert.equal("erc8021AttributionCode" in JSON.parse(withFlashAttribution(body, {}, { isOrder: true })), false);
});

test("Flash attribution: a malformed code is omitted (Flash would reject the user's order)", () => {
  for (const c of ["", "a,b", "has space", "x".repeat(33), "emoji🙂"]) {
    assert.equal(flashAttributionCode({ FLASH_ATTRIBUTION_CODE: c }), "", JSON.stringify(c));
  }
  assert.equal(flashAttributionCode({ FLASH_ATTRIBUTION_CODE: " my.app_1-x " }), "my.app_1-x");
});

test("Flash fee + attribution compose on /order the way the worker calls them", () => {
  const env = { FLASH_FEE_BPS: "10", FLASH_ATTRIBUTION_CODE: "nexustradinglabs" };
  const o = JSON.parse(withFlashAttribution(withFlashFee(JSON.stringify({ side: "buy" }), env), env, { isOrder: true }));
  assert.deepEqual([o.flashIntegratorFeeBps, o.erc8021AttributionCode], ["10", "nexustradinglabs"]);
});
