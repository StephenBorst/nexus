import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleXcSettlement, rpcCaller, restCaller, XC_RPCS, BTC_APIS } from "./routes-xcsettle.mjs";
import { TRANSFER_TOPIC } from "../../app/lib/nearSettlement.mjs";

// Real signed quote (USDC Arbitrum → USDC Base, no funds sent) + the real status reply's shape.
const fx = (n) => JSON.parse(readFileSync(new URL(`../../app/lib/__fixtures__/${n}.json`, import.meta.url)));
const QUOTE = fx("oneclick-quote-usdc-base");
const PENDING = fx("oneclick-status-pending");
const DEP = QUOTE.quote.depositAddress;
const USER = QUOTE.quoteRequest.recipient;
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TX = "0x" + "ab".repeat(32);
const hex = (n) => "0x" + BigInt(n).toString(16);
const T = Math.floor(Date.parse(QUOTE.timestamp) / 1000) + 60;

function statusFor(word, dest = [TX]) {
  const s = JSON.parse(JSON.stringify(PENDING));
  s.status = word;
  s.quoteResponse = JSON.parse(JSON.stringify(QUOTE));
  s.swapDetails.destinationChainTxHashes = dest.map((hash) => ({ hash, explorerUrl: "x" }));
  return s;
}
const receipt = (amount) => ({
  blockNumber: hex(900), status: "0x1",
  logs: [{ address: TOKEN, topics: [TRANSFER_TOPIC, "0x" + "0".repeat(64), "0x" + USER.toLowerCase().slice(2).padStart(64, "0")], data: hex(amount), removed: false }],
});

function fakeFetch({ status = statusFor("SUCCESS"), statusCode = 200, amount = QUOTE.quote.minAmountOut, baseDown = 0, finalized = 1000 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push(url);
    if (url.startsWith("https://1click.chaindefuser.com/v0/status?")) {
      assert.equal(new URL(url).searchParams.get("depositAddress"), DEP);
      return new Response(JSON.stringify(status), { status: statusCode });
    }
    const i = XC_RPCS.base.indexOf(url);
    if (i < 0) throw new Error("unexpected " + url);
    if (i < baseDown) throw new Error("rpc down");
    const { method, params } = JSON.parse(init.body);
    const result = method === "eth_getTransactionReceipt" ? receipt(amount)
      : method === "eth_getBlockByNumber" ? (params[0] === "finalized" ? { number: hex(finalized) } : { number: params[0], timestamp: hex(T) })
      : null;
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  };
  f.calls = calls;
  return f;
}
const req = (path, method = "GET") => new Request(`https://og.nexustradinglabs.com${path}`, { method, headers: { "cf-connecting-ip": "1.2.3.4" } });
const parts = (path) => path.split("?")[0].split("/").filter(Boolean);
const call = async (path, o = {}) => handleXcSettlement(parts(path), req(path, o.method), {}, { fetchImpl: o.fetchImpl ?? fakeFetch(), overLimit: o.overLimit ?? (() => false) });
const body = async (res) => res.json();

test("not our route → null; /xc/quote stays with the proxy", async () => {
  assert.equal(await call("/xc/quote"), null);
  assert.equal(await call("/flash/settlement"), null);
});

test("bad input → 400; POST → 405; over budget → 429", async () => {
  assert.equal((await call("/xc/settlement")).status, 400);
  assert.equal((await call("/xc/settlement?depositAddress=0x123")).status, 400);
  assert.equal((await call(`/xc/settlement/extra?depositAddress=${DEP}`)).status, 400);
  assert.equal((await call(`/xc/settlement?depositAddress=${DEP}`, { method: "POST" })).status, 405);
  assert.equal((await call(`/xc/settlement?depositAddress=${DEP}`, { overLimit: () => true })).status, 429);
});

test("SUCCESS + a final on-chain transfer ≥ the signed floor → DELIVERED, read from Base", async () => {
  const f = fakeFetch();
  const r = await body(await call(`/xc/settlement?depositAddress=${DEP}`, { fetchImpl: f }));
  assert.equal(r.verdict, "DELIVERED", r.reason);
  assert.deepEqual([r.depositAddress, r.to, r.chain, r.asset, r.bar], [DEP, USER, "base", "USDC", QUOTE.quote.minAmountOut]);
  assert.ok(f.calls.some((u) => u === XC_RPCS.base[0]));
});

test("a short on-chain credit → SHORT, whatever 1Click's status says", async () => {
  const r = await body(await call(`/xc/settlement?depositAddress=${DEP}`, { fetchImpl: fakeFetch({ amount: BigInt(QUOTE.quote.minAmountOut) - 1n }) }));
  assert.equal(r.verdict, "SHORT");
});

test("the first Base RPC down → the next one answers", async () => {
  const r = await body(await call(`/xc/settlement?depositAddress=${DEP}`, { fetchImpl: fakeFetch({ baseDown: 1 }) }));
  assert.equal(r.verdict, "DELIVERED");
});

test("every Base RPC down → UNREAD, never DELIVERED", async () => {
  const r = await body(await call(`/xc/settlement?depositAddress=${DEP}`, { fetchImpl: fakeFetch({ baseDown: 99 }) }));
  assert.equal(r.verdict, "UNREAD");
});

test("a status for ANOTHER deposit address's quote is refused (MISMATCH)", async () => {
  const s = statusFor("SUCCESS");
  s.quoteResponse = fx("oneclick-quote-live");
  const r = await body(await call(`/xc/settlement?depositAddress=${DEP}`, { fetchImpl: fakeFetch({ status: s }) }));
  assert.equal(r.verdict, "MISMATCH");
});

test("a status with a tampered echoed quote is refused (MALFORMED)", async () => {
  const s = statusFor("SUCCESS");
  s.quoteResponse.quote.minAmountOut = "1";
  const r = await body(await call(`/xc/settlement?depositAddress=${DEP}`, { fetchImpl: fakeFetch({ status: s }) }));
  assert.equal(r.verdict, "MALFORMED");
});

test("in flight → PENDING with no chain read; no echoed quote or 1Click down → UNREAD", async () => {
  const f = fakeFetch({ status: statusFor("PROCESSING") });
  assert.equal((await body(await call(`/xc/settlement?depositAddress=${DEP}`, { fetchImpl: f }))).verdict, "PENDING");
  assert.equal(f.calls.length, 1);
  const bare = statusFor("SUCCESS"); delete bare.quoteResponse;
  assert.equal((await body(await call(`/xc/settlement?depositAddress=${DEP}`, { fetchImpl: fakeFetch({ status: bare }) }))).verdict, "UNREAD");
  assert.equal((await body(await call(`/xc/settlement?depositAddress=${DEP}`, { fetchImpl: fakeFetch({ statusCode: 503 }) }))).verdict, "UNREAD");
  assert.equal((await call(`/xc/settlement?depositAddress=${DEP}`, { fetchImpl: fakeFetch({ statusCode: 404 }) })).status, 404);
});

test("rpcCaller: first non-null wins; all-null → null; none answering → throws", async () => {
  const mk = (answers) => async (url) => { const a = answers[url]; if (a instanceof Error) throw a; return Response.json({ jsonrpc: "2.0", id: 1, result: a }); };
  assert.equal(await rpcCaller(["a", "b"], mk({ a: null, b: { x: 1 } }))("m", []).then((r) => r.x), 1);
  assert.equal(await rpcCaller(["a", "b"], mk({ a: null, b: null }))("m", []), null);
  await assert.rejects(rpcCaller(["a", "b"], mk({ a: new Error("x"), b: new Error("y") }))("m", []));
});

test("restCaller: falls through a 404 or a dead API to the next", async () => {
  const f = async (url) => (url.startsWith(BTC_APIS[0]) ? new Response("nope", { status: 404 }) : Response.json({ ok: 1 }));
  assert.deepEqual(await restCaller(BTC_APIS, f)("/tx/abc"), { ok: 1 });
  await assert.rejects(restCaller(BTC_APIS, async () => { throw new Error("down"); })("/tx/abc"));
});

test("the worker routes /xc/settlement BEFORE the key-carrying /xc proxy", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const a = src.indexOf("handleXcSettlement(parts, request, env)");
  const b = src.indexOf('if (parts[0] === "xc") {');
  assert.ok(a > 0 && b > 0 && a < b);
});

import { kvMemo, settleDeposit } from "./routes-xcsettle.mjs";

test("kvMemo: credits are kept under xc:credit:* for a week; no KV → no memo", async () => {
  const puts = [];
  const kv = { get: async (k) => (k === "xc:credit:a" ? JSON.stringify({ credited: "5", method: "trace" }) : null), put: async (k, v, o) => puts.push([k, v, o]) };
  const m = kvMemo(kv);
  assert.deepEqual(await m.get("a"), { credited: "5", method: "trace" });
  assert.equal(await m.get("b"), null);
  await m.set("k", { credited: "7", method: "balance" });
  assert.deepEqual(puts, [["xc:credit:k", JSON.stringify({ credited: "7", method: "balance" }), { expirationTtl: 7 * 86400 }]]);
  assert.equal(kvMemo(undefined), null);
});

test("settleDeposit (shared with the spot ledger): same verdicts as the route; unknown address → UNKNOWN", async () => {
  assert.equal((await settleDeposit(DEP, {}, { fetchImpl: fakeFetch() })).verdict, "DELIVERED");
  assert.equal((await settleDeposit(DEP, {}, { fetchImpl: fakeFetch({ statusCode: 404 }) })).verdict, "UNKNOWN");
  assert.equal((await settleDeposit(DEP, {}, { fetchImpl: fakeFetch({ amount: 1n }) })).verdict, "SHORT");
});
