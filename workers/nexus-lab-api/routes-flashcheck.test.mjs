import { test } from "node:test";
import assert from "node:assert/strict";
import { handleFlashSettlement, BASE_RPCS } from "./routes-flashcheck.mjs";
import { ERC8021_MARKER } from "../../app/lib/flashSettlement.mjs";

const ID = "3f1c2a9e-1b2c-4d5e-8f90-0123456789ab";
const WALLET = "0x" + "12".repeat(20);
const TX = "0x" + "ab".repeat(32);
const ENV = { FLASH_API_KEY: "k", FLASH_FEE_BPS: "10", FLASH_ATTRIBUTION_CODE: "bc_lrqwbh7u" };
const hex = (s) => Buffer.from(s, "ascii").toString("hex");
const codes = hex("definitive,bc_lrqwbh7u");
const INPUT = "0xa9059cbb" + "00".repeat(64) + codes + (codes.length / 2).toString(16).padStart(2, "0") + "00" + ERC8021_MARKER;
const CHAIN = { id: "base", name: "Base", namespace: "eip155" };
const FLASH_BODY = {
  order: { orderId: ID, status: "ORDER_STATUS_FILLED", orderType: "market", integratorFeeBps: "10", targetAsset: { chain: CHAIN }, contraAsset: { chain: CHAIN } },
  fills: [{ transactionId: TX, status: "CHAIN_STATUS_FINALIZED", notional: "5", integratorFeeNotional: "0.005", feeTicker: "USDC" }],
};

function fakeFetch({ flashStatus = 200, flashBody = FLASH_BODY, input = INPUT, rpcDown = 0, listOrders = [] } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.startsWith("https://flash.definitive.fi/v1/orders?")) return Response.json({ orders: listOrders });
    if (url.startsWith("https://flash.definitive.fi/")) return new Response(JSON.stringify(flashBody), { status: flashStatus });
    const i = BASE_RPCS.indexOf(url);
    if (i >= 0 && i < rpcDown) throw new Error("rpc down");
    if (i >= 0) return Response.json({ jsonrpc: "2.0", id: 1, result: { hash: TX, input, to: "0x" + "cd".repeat(20) } });
    throw new Error("unexpected " + url);
  };
  f.calls = calls;
  return f;
}
const req = (path, method = "GET") => new Request(`https://og.nexustradinglabs.com${path}`, { method, headers: { "cf-connecting-ip": "1.2.3.4" } });
const parts = (path) => path.split("?")[0].split("/").filter(Boolean);
const call = (path, o = {}) => handleFlashSettlement(parts(path), req(path, o.method), o.env ?? ENV, { fetchImpl: o.fetchImpl ?? fakeFetch(), overLimit: o.overLimit ?? (() => false) });

test("not our route → null", async () => {
  assert.equal(await call(`/flash/orders/${ID}?funderAddress=${WALLET}`), null);
});

test("a settled order with our fee and our code passes both, read-only", async () => {
  const f = fakeFetch();
  const r = await call(`/flash/settlement/${ID}?funderAddress=${WALLET}`, { fetchImpl: f });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.fee.verdict, "PASS");
  assert.equal(j.code.verdict, "PASS");
  assert.deepEqual(j.fills[0].attribution.codes, ["definitive", "bc_lrqwbh7u"]);
  // Only one Flash GET (with our key, in a header) and one RPC read; no POST to Flash.
  const flash = f.calls.filter((c) => c.url.startsWith("https://flash."));
  assert.equal(flash.length, 1);
  assert.equal(flash[0].init.method ?? "GET", "GET");
  assert.equal(flash[0].init.headers["x-definitive-api-key"], "k");
  assert.ok(!flash[0].url.includes("k&") && !flash[0].url.includes("api-key"));
});

test("missing code at the end of calldata → code FAIL", async () => {
  const j = await (await call(`/flash/settlement/${ID}?funderAddress=${WALLET}`, { fetchImpl: fakeFetch({ input: "0xa9059cbb" }) })).json();
  assert.equal(j.code.verdict, "FAIL");
  assert.equal(j.fee.verdict, "PASS");
});

test("first RPC down → falls back; all down → UNREAD, never PASS", async () => {
  assert.equal((await (await call(`/flash/settlement/${ID}?funderAddress=${WALLET}`, { fetchImpl: fakeFetch({ rpcDown: 1 }) })).json()).code.verdict, "PASS");
  assert.equal((await (await call(`/flash/settlement/${ID}?funderAddress=${WALLET}`, { fetchImpl: fakeFetch({ rpcDown: 3 }) })).json()).code.verdict, "UNREAD");
});

test("bad input, unknown order, missing key, over budget, wrong method", async () => {
  assert.equal((await call(`/flash/settlement/not-a-uuid?funderAddress=${WALLET}`)).status, 400);
  assert.equal((await call(`/flash/settlement/${ID}/x?funderAddress=${WALLET}`)).status, 400);
  assert.equal((await call(`/flash/settlement/${ID}?funderAddress=0x12`)).status, 400);
  assert.equal((await call(`/flash/settlement/${ID}?funderAddress=${WALLET}`, { fetchImpl: fakeFetch({ flashStatus: 404 }) })).status, 404);
  assert.equal((await call(`/flash/settlement/${ID}?funderAddress=${WALLET}`, { env: {} })).status, 503);
  assert.equal((await call(`/flash/settlement/${ID}?funderAddress=${WALLET}`, { overLimit: () => true })).status, 429);
  assert.equal((await call(`/flash/settlement/${ID}?funderAddress=${WALLET}`, { method: "POST" })).status, 405);
});

test("no fills yet → PENDING on both", async () => {
  const j = await (await call(`/flash/settlement/${ID}?funderAddress=${WALLET}`, { fetchImpl: fakeFetch({ flashBody: { ...FLASH_BODY, fills: [] } }) })).json();
  assert.equal(j.fee.verdict, "PENDING");
  assert.equal(j.code.verdict, "PENDING");
});

test("no order id → the wallet's newest filled order", async () => {
  const OLD = "11111111-1111-4111-8111-111111111111";
  const f = fakeFetch({ listOrders: [{ orderId: OLD, closedAt: "2026-10-01T00:00:00Z" }, { orderId: ID, closedAt: "2026-10-27T00:00:00Z" }] });
  const j = await (await call(`/flash/settlement?funderAddress=${WALLET}`, { fetchImpl: f })).json();
  assert.equal(j.code.verdict, "PASS");
  assert.ok(f.calls.some((c) => c.url.includes(`/orders/${ID}?`)));
  assert.ok(f.calls[0].url.includes("statuses=ORDER_STATUS_FILLED"));
  assert.equal((await call(`/flash/settlement?funderAddress=${WALLET}`, { fetchImpl: fakeFetch({ listOrders: [] }) })).status, 404);
});
