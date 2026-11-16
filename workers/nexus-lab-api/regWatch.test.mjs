import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  runRegWatch, registrationsFromLogs, judgeIndex, REGWATCH_KEY, GRACE_MS, MAX_TRIES, LOOKBACK_BLOCKS, SCAN_FAILS_ALERT,
} from "./regWatch.mjs";
import { THESIS_REGISTRY } from "../../app/lib/registryEvent.mjs";

const W = "0x3b2c00000000000000000000000000000000bfe4";
const word = (hexs) => "0x" + hexs.replace(/^0x/, "").padStart(64, "0");
const tx = (n) => "0x" + String(n).padStart(64, "a");
const log = (n, block, wallet = W) => ({
  address: THESIS_REGISTRY, transactionHash: tx(n), blockNumber: "0x" + block.toString(16),
  topics: [word("479428a8"), word(n.toString(16)), word(wallet)],
});

function kv() { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; }
function chain({ latest = 1_000_000, logs = [], fail = null } = {}) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push([method, params]);
    if (method === "eth_blockNumber") return "0x" + latest.toString(16);
    if (method === "eth_getLogs") {
      if (fail) throw new Error(fail);
      const from = parseInt(params[0].fromBlock, 16), to = parseInt(params[0].toBlock, 16);
      return logs.filter((l) => { const b = parseInt(l.blockNumber, 16); return b >= from && b <= to; });
    }
    throw new Error("unexpected " + method);
  };
  return { rpc, calls };
}

test("registrations come from the registry's layout only, with their tx", () => {
  const other = { ...log(2, 5), address: "0x" + "1".repeat(40) };
  const out = registrationsFromLogs([log(1, 5), other, { ...log(3, 5), transactionHash: "nope" }]);
  assert.deepEqual(out, [{ txHash: tx(1), wallet: W, block: 5 }]);
});

test("index answers: already = silent, new = alert, pending = retry, refused = alert", () => {
  assert.deepEqual(judgeIndex({ status: 200, body: { ok: true, already: true } }), { done: true, alert: null });
  assert.deepEqual(judgeIndex({ status: 200, body: { ok: true } }), { done: true, alert: "indexed" });
  assert.deepEqual(judgeIndex({ status: 202, body: { pending: true } }), { done: false, alert: null });
  assert.deepEqual(judgeIndex({ status: 503, body: {} }), { done: false, alert: null });
  assert.deepEqual(judgeIndex({ status: 422, body: { error: "too_old" } }), { done: true, alert: "failed" });
});

test("a registration the publisher never indexed is indexed after the grace, and the owner is told", async () => {
  const env = { LAB_STORE: kv() };
  const { rpc } = chain({ latest: 1_000_000, logs: [log(1, 999_990)] });
  const indexed = [], sent = [];
  let t = 1_000_000_000_000;
  const deps = {
    logsRpc: rpc, now: () => t,
    index: async (h, w) => { indexed.push([h, w]); return { status: 200, body: { ok: true, symbol: "PERP_ETH_USDC", direction: "LONG" } }; },
    send: async (m) => { sent.push(m); return true; },
  };
  const r1 = await runRegWatch(env, deps);
  assert.equal(r1.found, 1);
  assert.equal(indexed.length, 0, "the publisher's own index gets the grace first");
  t += GRACE_MS;
  const r2 = await runRegWatch(env, deps);
  assert.deepEqual(indexed, [[tx(1), W]]);
  assert.equal(r2.indexed, 1);
  assert.match(sent[0], /missing from the Lab, indexed now by the watchdog: .*ETH LONG/);
  t += GRACE_MS;
  await runRegWatch(env, deps);
  assert.equal(indexed.length, 1, "never twice");
  assert.equal(sent.length, 1);
});

test("already in the Lab = no alert; a refusal or too-old is reported once", async () => {
  const env = { LAB_STORE: kv() };
  const { rpc } = chain({ logs: [log(1, 999_990), log(2, 999_991)] });
  const sent = [];
  let t = 0;
  const deps = {
    logsRpc: rpc, now: () => t, send: async (m) => { sent.push(m); return true; },
    index: async (h) => (h === tx(1) ? { status: 200, body: { ok: true, already: true } } : { status: 422, body: { error: "too_old", hint: "Only registrations from the last 6h can be indexed" } }),
  };
  await runRegWatch(env, deps); t += GRACE_MS; await runRegWatch(env, deps); t += GRACE_MS; await runRegWatch(env, deps);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /could NOT be added to the Lab: .* too_old: Only registrations/);
  assert.doesNotMatch(sent[0], new RegExp(tx(1).slice(0, 6) + "…" + tx(1).slice(-4)));
});

test("unconfirmed keeps trying, then is reported; a failed send is kept for the next run", async () => {
  const env = { LAB_STORE: kv() };
  const { rpc } = chain({ logs: [log(1, 999_990)] });
  const sent = [];
  let t = 0, sendOk = false;
  const deps = { logsRpc: rpc, now: () => t, index: async () => ({ status: 202, body: { pending: true } }), send: async (m) => { if (sendOk) sent.push(m); return sendOk; } };
  await runRegWatch(env, deps);
  for (let i = 0; i < MAX_TRIES; i++) { t += GRACE_MS; await runRegWatch(env, deps); }
  assert.equal(sent.length, 0);
  assert.equal(JSON.parse(env.LAB_STORE.m.get(REGWATCH_KEY)).alerts.length, 1, "held, not dropped");
  sendOk = true; t += GRACE_MS;
  await runRegWatch(env, deps);
  assert.match(sent[0], /still not in the Lab after 12 tries/);
});

test("first run looks back past the 6h window; later runs continue from the cursor", async () => {
  const env = { LAB_STORE: kv() };
  const c = chain({ latest: 1_000_000 });
  const deps = { logsRpc: c.rpc, now: () => 0, index: async () => ({}), send: async () => true };
  await runRegWatch(env, deps);
  const first = c.calls.find(([m]) => m === "eth_getLogs")[1][0];
  assert.equal(parseInt(first.fromBlock, 16), 1_000_000 - LOOKBACK_BLOCKS + 1);
  assert.ok(LOOKBACK_BLOCKS * 0.25 > 6 * 3600, "lookback covers the 6h index window at ~0.25 s blocks");
  assert.equal(JSON.parse(env.LAB_STORE.m.get(REGWATCH_KEY)).scannedTo, 1_000_000);
});

test("a blind watchdog says so once, and again when it reads", async () => {
  const env = { LAB_STORE: kv() };
  const sent = [];
  let fail = "upstream down";
  const rpc = async (m) => { if (m === "eth_blockNumber") return "0x10"; if (fail) throw new Error(fail); return []; };
  const deps = { logsRpc: rpc, now: () => 0, index: async () => ({}), send: async (m) => { sent.push(m); return true; } };
  for (let i = 0; i < SCAN_FAILS_ALERT + 3; i++) await runRegWatch(env, deps);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /can't read Arbitrum logs/);
  fail = null;
  await runRegWatch(env, deps);
  assert.match(sent[1], /reads Arbitrum again/);
});

test("wired on the */5 cron through the /theses/index path and the owner chat", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const five = src.slice(src.indexOf("if (minute % 5 === 0) {"), src.indexOf("return;", src.indexOf("if (minute % 5 === 0) {")));
  assert.match(five, /runRegWatch\(env, \{/);
  assert.match(five, /index: \(txHash, wallet\) => indexRegistration\(env, \{ txHash, wallet, rpc: indexRpc, readMark: readPublishMark \}\)/);
  assert.match(five, /send: \(text\) => sendOwner\(env, text\)/);
  assert.match(five, /logsRpc: makeRpc\(\[DEFAULT_LOGS_RPC\]\)/, "getLogs on the public RPC (Alchemy's free tier allows 10 blocks)");
});
