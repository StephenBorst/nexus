// The Holders Room's rules + its server route (holdersRoom.mjs, routes-feed.mjs /feed/holders, kvList.mjs).
// Run: node --test app/lib/holdersRoom.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { holdersRoomMessage, signHoldersAccess, isHoldersCall, holderRows, holderCallState, lockState, roomError, authorStatusLine } from "./holdersRoom.mjs";
import { holdersRoomMessage as workerMessage } from "../../workers/nexus-lab-api/shared.mjs";
import { handleFeed } from "../../workers/nexus-lab-api/routes-feed.mjs";
import { listAllKeys } from "../../workers/nexus-lab-api/kvList.mjs";

const alice = privateKeyToAccount("0x" + "a1".repeat(32));
const A = alice.address.toLowerCase();

test("one challenge for client and server", () => {
  assert.equal(workerMessage(A, 5), holdersRoomMessage(A, 5));
  assert.equal(holdersRoomMessage("0xABC", 1), "Nexus Holders Room\nAddress: 0xabc\nTimestamp: 1");
});

test("signs with the connected wallet's provider (WalletConnect / Android), never only an injected one", async () => {
  const calls = [];
  const provider = { request: async ({ method, params }) => {
    calls.push(method);
    if (method === "eth_accounts") return [alice.address];
    if (method === "personal_sign") return alice.signMessage({ message: { raw: params[0] } });
    return null;
  } };
  const { ts, sig } = await signHoldersAccess(alice.address, { provider }, 1234);
  assert.equal(ts, 1234);
  assert.ok(await import("viem").then((v) => v.verifyMessage({ address: alice.address, message: holdersRoomMessage(A, 1234), signature: sig })));
  assert.deepEqual(calls, ["eth_accounts", "personal_sign"]);
  await assert.rejects(() => signHoldersAccess("So1anaAddr111111111111111111111111111111111", { provider }), /EVM wallet/);
  await assert.rejects(() => signHoldersAccess(alice.address, null), /Connect your wallet/);
  const other = { request: async ({ method }) => (method === "eth_accounts" ? ["0x" + "9".repeat(40)] : null) };
  await assert.rejects(() => signHoldersAccess(alice.address, { provider: other }), /Switch your wallet/);
});

test("rows: holders calls only, newest first; a private holders call is never shown as graded", () => {
  const rows = holderRows([
    { id: "a", symbol: "ETH", holdersOnly: true, createdAt: 1 },
    { id: "b", symbol: "BTC", holdersOnly: true, createdAt: 3 },
    { id: "c", symbol: "SOL", isPublic: true, createdAt: 2 },
    { id: "d", symbol: "SOL", holdersOnly: true, duplicateOf: "x", createdAt: 4 },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["b", "a"]);
  assert.equal(isHoldersCall({ symbol: "X", holdersOnly: true }), true);
  assert.deepEqual(holderCallState({ status: "HIT_TP" }), { graded: false, line: "The author marks it: hit target." });
  assert.equal(holderCallState({ status: "HIT_TP", gradedOutcome: "WIN" }).graded, false, "a stray grade on a private call is not shown");
  assert.deepEqual(holderCallState({ isPublic: true, gradedOutcome: "LOSS", gradedR: -1 }), { graded: true, line: "Graded: lost −1.00R." });
  assert.equal(authorStatusLine("weird"), "No status from the author.");
});

test("the lock says why: not EVM, unread (never 'locked'), or how far below the line", () => {
  assert.equal(lockState({ address: "So1ana", balance: null, need: 50e6 }).kind, "NOT_EVM");
  const u = lockState({ address: A, balance: null, need: 50e6 });
  assert.equal(u.kind, "UNREAD");
  assert.match(u.line, /isn’t a verdict/);
  const b = lockState({ address: A, balance: 12_500_000.7, need: 50e6 });
  assert.equal(b.line, "You hold 12,500,000 $NEXUS. The room opens at 50,000,000: 37,500,000 to go.");
  assert.match(roomError(503), /couldn’t read your balance/);
  assert.match(roomError(403), /under the room’s line/);
  assert.match(roomError(401), /Sign again/);
});

function kv(init = {}, { pageSize = 1000 } = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    async get(k, type) { const v = m.get(k); return v == null ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async list({ prefix, cursor }) {
      const all = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = cursor ? Number(cursor) : 0;
      const keys = all.slice(from, from + pageSize).map((name) => ({ name }));
      const done = from + pageSize >= all.length;
      return { keys, list_complete: done, cursor: done ? undefined : String(from + pageSize) };
    },
  };
}

test("listAllKeys pages past the first page (one list() call stops at 1000)", async () => {
  const init = {};
  for (let i = 0; i < 25; i++) init[`lab:0x${String(i).padStart(40, "0")}`] = "{}";
  const store = kv(init, { pageSize: 10 });
  assert.equal((await store.list({ prefix: "lab:" })).keys.length, 10);
  assert.equal((await listAllKeys(store, "lab:")).length, 25);
});

const req = (body, method = "POST") => new Request("https://og.nexustradinglabs.com/feed/holders", {
  method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined,
});

async function withRpc(result, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => (result === "down" ? Promise.reject(new Error("down")) : new Response(JSON.stringify({ result })));
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const hex = (n) => "0x" + n.toString(16);
const OPERATOR = 50000000n * 10n ** 18n;

test("/feed/holders: POST body only, 503 when the balance is unread, records past page one reach the room", async () => {
  const ts = Date.now();
  const sig = await alice.signMessage({ message: holdersRoomMessage(A, ts) });
  const init = {};
  for (let i = 0; i < 12; i++) init[`lab:0x${String(i).padStart(40, "0")}`] = JSON.stringify({ theses: [] });
  init["lab:0xffffffffffffffffffffffffffffffffffffffff"] = JSON.stringify({ theses: [
    { id: "h1", symbol: "ETH", holdersOnly: true, createdAt: 5 }, { id: "p1", symbol: "BTC", isPublic: true, createdAt: 6 },
  ] });
  const env = { LAB_STORE: kv(init, { pageSize: 5 }) };

  const get = await handleFeed(["feed", "holders"], req(null, "GET"), env);
  assert.equal(get.status, 405, "a signature never goes in a URL");

  const unread = await withRpc("down", () => handleFeed(["feed", "holders"], req({ address: A, ts, sig }), env));
  assert.equal(unread.status, 503);
  assert.equal((await unread.json()).error, "balance_unread");

  const below = await withRpc(hex(OPERATOR - 1n), () => handleFeed(["feed", "holders"], req({ address: A, ts, sig }), env));
  assert.equal(below.status, 403);

  const bad = await withRpc(hex(OPERATOR), () => handleFeed(["feed", "holders"], req({ address: A, ts, sig: sig.slice(0, -2) + "00" }), env));
  assert.equal(bad.status, 401);

  const ok = await withRpc(hex(OPERATOR), () => handleFeed(["feed", "holders"], req({ address: A, ts, sig }), env));
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.deepEqual(j.feed.map((t) => t.id), ["h1"], "the holders call on page three is there; the public call is not");
  assert.ok(env.LAB_STORE.m.has("feed:holders:v1"), "the built feed is kept 60 s");
});

test("the screen: POST body, connected-wallet signer, no direction in green/red, unread is not locked", () => {
  const src = readFileSync(new URL("../components/HoldersRoom.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /feed\/holders\?/, "the signature used to ride in the query string");
  assert.doesNotMatch(src, /signWithInjected/);
  assert.match(src, /method: "POST"/);
  assert.match(src, /useLabWallet\(\)/);
  assert.match(src, /lockState\(/);
  assert.match(src, /NOT_GRADED_LINE/);
  assert.doesNotMatch(src, /t\.direction === "LONG" \? "#3ecf8e"/);
});
