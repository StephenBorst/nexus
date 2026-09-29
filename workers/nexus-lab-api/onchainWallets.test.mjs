import { test } from "node:test";
import assert from "node:assert/strict";
import {
  walletsFromLogs, advanceIndex, findStartBlock, onchainResponse, isRangeError, MIN_CHUNK,
} from "./onchainWallets.mjs";
import { THESIS_REGISTRY } from "../../app/lib/registryEvent.mjs";

const pad = (a) => "0x" + "0".repeat(24) + a.slice(2).toLowerCase();
const id = (n) => "0x" + n.toString(16).padStart(64, "0");
const A = "0x" + "a".repeat(40), B = "0x" + "B".repeat(40), C = "0x" + "c".repeat(40);
const TOPIC0 = "0x" + "1".repeat(64);   // whatever the registry emits: never pinned
const reg = (block, who, thesis = 1, address = THESIS_REGISTRY) =>
  ({ address, blockNumber: "0x" + block.toString(16), topics: [TOPIC0, id(thesis), pad(who)] });

// A fake Arbitrum: blocks 0..latest, one block per second from t0, logs at given blocks.
function chain({ latest, t0 = 1_000, logs = [], maxRange = Infinity, failAt = null }) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "eth_blockNumber") return "0x" + latest.toString(16);
    if (method === "eth_getBlockByNumber") return { timestamp: "0x" + (t0 + parseInt(params[0], 16)).toString(16) };
    if (method === "eth_getLogs") {
      const { address, fromBlock, toBlock } = params[0];
      const from = parseInt(fromBlock, 16), to = parseInt(toBlock, 16);
      if (failAt != null && from <= failAt && failAt <= to) throw new Error("upstream 503");
      if (to - from + 1 > maxRange) throw new Error(`eth_getLogs is limited to a ${maxRange} block range`);
      return logs.filter((l) => l.address.toLowerCase() === address.toLowerCase()
        && parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to);
    }
    throw new Error("unexpected " + method);
  };
  return { rpc, calls };
}

test("walletsFromLogs: registry logs only, indexed-address layout only, deduped + lowercase", () => {
  const logs = [
    reg(1, A), reg(2, A, 2), reg(3, B),
    reg(4, C, 1, "0x" + "9".repeat(40)),                               // another contract
    { address: THESIS_REGISTRY, topics: [TOPIC0, id(5)] },             // no trader topic
    { address: THESIS_REGISTRY, topics: [TOPIC0, id(6), id(7).replace(/^0x0/, "0x1")] }, // not an address word
  ];
  assert.deepEqual(walletsFromLogs(logs), [A, B.toLowerCase()].sort());
  assert.deepEqual(walletsFromLogs(null), []);
});

test("findStartBlock: first block at or after the timestamp", async () => {
  const { rpc } = chain({ latest: 1_000_000, t0: 5_000 });
  assert.equal(await findStartBlock(rpc, 1_000_000, 5_000 + 123_456), 123_456);
  assert.equal(await findStartBlock(rpc, 1_000_000, 0), 0);
});

test("advanceIndex: starts at the floor, scans in chunks, resumes where it stopped", async () => {
  const logs = [reg(10, C), reg(50, A), reg(20_500, B), reg(29_999, C)];   // block 10 predates the floor
  const { rpc, calls } = chain({ latest: 30_000, t0: 0, logs });
  let r = await advanceIndex({ rpc, state: { chunk: 10_000 }, floorSec: 40, maxChunks: 2 });
  assert.equal(r.error, null);
  assert.equal(r.state.startBlock, 40);
  assert.equal(r.state.scannedTo, 40 + 2 * 10_000 - 1);
  assert.equal(r.backfilled, false);
  assert.deepEqual(r.state.wallets, [A]);                 // C's block-10 log is before the floor
  const seen = calls.filter((c) => c.method === "eth_getLogs").length;
  r = await advanceIndex({ rpc, state: r.state, maxChunks: 5 });
  assert.equal(r.backfilled, true);
  assert.equal(r.state.scannedTo, 30_000);
  assert.deepEqual(r.state.wallets, [A, B.toLowerCase(), C].sort());
  const next = calls.filter((c) => c.method === "eth_getLogs").slice(seen);
  assert.equal(parseInt(next[0].params[0].fromBlock, 16), 20_040);   // right after scannedTo
  assert.equal(next[0].params[0].address, THESIS_REGISTRY);
  assert.equal(next[0].params[0].topics, undefined);                  // no guessed topic0 filter
});

test("advanceIndex: the default chunk backfills a short chain in one call; an idle head costs no getLogs", async () => {
  const { rpc, calls } = chain({ latest: 30_000, t0: 0, logs: [reg(50, A)] });
  const r = await advanceIndex({ rpc, state: null, fromBlock: 0 });
  assert.equal(r.backfilled, true);
  assert.equal(calls.filter((c) => c.method === "eth_getLogs").length, 1);
  const again = await advanceIndex({ rpc, state: r.state });
  assert.equal(again.scanned, 0);
  assert.deepEqual(again.state.wallets, [A]);
});

test("advanceIndex: a provider range limit halves the chunk instead of failing", async () => {
  const { rpc } = chain({ latest: 100_000, t0: 0, logs: [reg(90_000, A)], maxRange: 25_000 });
  const r = await advanceIndex({ rpc, state: null, fromBlock: 0, maxChunks: 20 });
  assert.equal(r.error, null);
  assert.ok(r.state.chunk <= 25_000 && r.state.chunk >= MIN_CHUNK);
  assert.equal(r.backfilled, true);
  assert.deepEqual(r.state.wallets, [A]);
});

test("advanceIndex: an outage keeps progress + known wallets and reports the error", async () => {
  const { rpc } = chain({ latest: 50_000, t0: 0, logs: [reg(100, A), reg(40_000, B)], failAt: 30_000 });
  const r = await advanceIndex({ rpc, state: { chunk: 10_000, wallets: [C] }, fromBlock: 0, maxChunks: 10 });
  assert.match(r.error, /503/);
  assert.equal(r.backfilled, false);
  assert.equal(r.state.scannedTo, 29_999);               // the failed chunk isn't marked scanned
  assert.deepEqual(r.state.wallets, [A, C].sort());
});

test("advanceIndex: a dead RPC reports the error, never an empty 'zero callers' success", async () => {
  const rpc = async () => { throw new Error("fetch failed"); };
  const r = await advanceIndex({ rpc, state: null });
  assert.match(r.error, /fetch failed/);
  const res = onchainResponse(r.state, { error: r.error });
  assert.equal(res.backfilled, false);
  assert.equal(res.error, "fetch failed");
});

test("onchainResponse: count shown as a total only once backfilled", () => {
  assert.equal(onchainResponse({ wallets: [A], scannedTo: 5 }).backfilled, false);
  const done = onchainResponse({ wallets: [A, C], scannedTo: 9, backfilledAt: 1, updatedAt: 2 }, { fromCache: true });
  assert.deepEqual([done.backfilled, done.count, done.fromCache, "error" in done], [true, 2, true, false]);
});

test("isRangeError: range/size refusals shrink, outages don't", () => {
  assert.equal(isRangeError("Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range"), true);
  assert.equal(isRangeError("query returned more than 10000 results"), true);
  assert.equal(isRangeError("upstream 503"), false);
  assert.equal(isRangeError("eth_getLogs: HTTP 429"), false);
  assert.equal(isRangeError("rate limit exceeded"), false);
  assert.equal(isRangeError("Too Many Requests"), false);
});
