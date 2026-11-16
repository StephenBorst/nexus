import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  runRegWatch, registrationsFromLogs, judgeIndex, REGWATCH_KEY, GRACE_MS, MAX_TRIES, LOOKBACK_BLOCKS, SCAN_FAILS_ALERT,
  makeLogsRpc, logsRpcUrls, scanForward, PUBLIC_LOGS_RPCS, CHUNK, MAX_CHUNKS, RETRY_WAITS_MS,
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
  const deps = { logsRpc: c.rpc, now: () => 0, index: async () => ({}), send: async () => true, scanOpts: { sleep: async () => {} } };
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
  assert.match(five, /logsRpc: makeLogsRpc\(logsRpcUrls\(env\)\)/, "getLogs on ARBITRUM_RPC_URL / ARB_LOGS_RPC, then public endpoints");
});

// ── 2026-11-16: the public RPC answered 429 for 6 runs; own endpoint first, backoff, fallback, smaller ranges ──────
const reply = (status, body) => ({ status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

test("endpoints: the configured one first (either name, https only), then the public ones", () => {
  assert.deepEqual(logsRpcUrls({}), [...PUBLIC_LOGS_RPCS]);
  assert.deepEqual(logsRpcUrls({ ARBITRUM_RPC_URL: " https://arb.example/key123 " })[0], "https://arb.example/key123");
  assert.deepEqual(logsRpcUrls({ ARB_LOGS_RPC: "https://logs.example/k" })[0], "https://logs.example/k");
  assert.deepEqual(logsRpcUrls({ ARBITRUM_RPC_URL: "http://plain.example" }), [...PUBLIC_LOGS_RPCS], "no plain http");
  assert.ok(PUBLIC_LOGS_RPCS.length >= 3);
});

test("a 429 waits and retries with growing waits, then moves to the next endpoint", async () => {
  const hits = [], waits = [];
  const fetchImpl = async (url) => {
    hits.push(new URL(url).host);
    if (url.includes("one")) return reply(429, "Too Many Requests");
    return reply(200, { jsonrpc: "2.0", id: 1, result: "0x10" });
  };
  const rpc = makeLogsRpc(["https://one.example", "https://two.example"], { fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(await rpc("eth_blockNumber", []), "0x10");
  assert.deepEqual(waits, [...RETRY_WAITS_MS], "backoff grows");
  assert.deepEqual(hits, ["one.example", "one.example", "one.example", "one.example", "two.example"]);
  hits.length = 0;
  await rpc("eth_blockNumber", []);
  assert.deepEqual(hits, ["two.example"], "the endpoint that answered is tried first next time");
});

test("a JSON-RPC rate-limit error body counts as a 429; a range refusal is thrown for the scanner", async () => {
  let n = 0;
  const fetchImpl = async () => (++n === 1 ? reply(200, { error: { code: -32005, message: "rate limit exceeded" } }) : reply(200, { error: { code: -32602, message: "query exceeds max block range 2000" } }));
  const rpc = makeLogsRpc(["https://a.example"], { fetchImpl, sleep: async () => {} });
  await assert.rejects(rpc("eth_getLogs", [{}]), /max block range/);
  assert.equal(n, 2, "retried once after the rate limit, then got the range answer");
});

test("every endpoint limited = one error naming the host, never the key", async () => {
  const rpc = makeLogsRpc(["https://arb.example/SECRETKEY"], { fetchImpl: async () => reply(429, "Too Many Requests"), sleep: async () => {} });
  await assert.rejects(rpc("eth_blockNumber", []), (e) => /arb\.example: Too Many Requests/.test(e.message) && !/SECRETKEY/.test(e.message));
});

test("ranges: 10k blocks a call, halving on a range refusal; partial progress isn't blindness", async () => {
  assert.equal(CHUNK, 10_000);
  assert.ok(CHUNK * (MAX_CHUNKS - 3) >= LOOKBACK_BLOCKS, "the first run covers the lookback with room to halve");
  const spans = [];
  let calls = 0;
  const rpc = async (m, p) => {
    if (m === "eth_blockNumber") return "0x" + (100_000).toString(16);
    const span = parseInt(p[0].toBlock, 16) - parseInt(p[0].fromBlock, 16) + 1;
    spans.push(span);
    if (span > 2_500) throw new Error("query exceeds max block range 2500");
    if (++calls === 3) throw new Error("Too Many Requests");
    return [];
  };
  const r = await scanForward(rpc, { scannedTo: 90_000 }, { sleep: async () => {} });
  assert.deepEqual(spans.slice(0, 3), [10_000, 5_000, 2_500]);
  assert.equal(r.progressed, true);
  assert.match(r.error, /Too Many/);
  // runRegWatch: progress + a late error = not a blind run
  const env = { LAB_STORE: kv() };
  await env.LAB_STORE.put(REGWATCH_KEY, JSON.stringify({ scannedTo: 90_000, scanFails: 5 }));
  calls = 0; spans.length = 0;
  const sent = [];
  await runRegWatch(env, { logsRpc: rpc, now: () => 0, index: async () => ({}), send: async (m) => { sent.push(m); return true; }, scanOpts: { sleep: async () => {} } });
  assert.equal(JSON.parse(env.LAB_STORE.m.get(REGWATCH_KEY)).scanFails, 0);
  assert.deepEqual(sent, [], "no blind alert; it was only 5 runs, so no 'reads again' either");
});

// ── The digest's watchdog line (2026-11-16) ──────────────────────────────────────────────────────────────────
import { watchdogLine, LATE_WINDOW_MS } from "./regWatch.mjs";
import { digestText } from "../../app/lib/opsDigest.mjs";

test("the watchdog records when it last read and each call it indexed late; the digest says it in one line", async () => {
  const env = { LAB_STORE: kv() };
  const { rpc } = chain({ logs: [log(1, 999_990)] });
  let t = 1_000_000_000_000;
  const deps = { logsRpc: rpc, now: () => t, index: async () => ({ status: 200, body: { ok: true, symbol: "PERP_ETH_USDC", direction: "LONG" } }), send: async () => true };
  await runRegWatch(env, deps); t += GRACE_MS; await runRegWatch(env, deps);
  const st = JSON.parse(env.LAB_STORE.m.get(REGWATCH_KEY));
  assert.equal(st.lastReadAt, t);
  assert.deepEqual(st.late, [t]);
  assert.equal(watchdogLine(st, t + 2 * 60_000), "Reading, last read 2 min ago. 1 call indexed late in 7 days (the publisher skipped /theses/index).");
  assert.equal(watchdogLine({ ...st, late: [t - LATE_WINDOW_MS - 1] }, t), "Reading, last read 0 min ago. No call needed indexing this week.");
  assert.match(watchdogLine({ ...st, scanFails: 7, lastReadAt: t - 3 * 3_600_000 }, t), /^Can't read Arbitrum logs \(7 runs in a row, last read 3h ago\)\. Set ARBITRUM_RPC_URL/);
  assert.equal(watchdogLine(null), "No run recorded yet.");
  const text = digestText({ asOf: t, stages: null, paper: [], pending: [], watchdog: watchdogLine(st, t) });
  assert.match(text, /<b>On-chain → Lab watchdog<\/b>\nReading, last read 0 min ago\. 1 call indexed late/);
});

test("the digest reads the watchdog's state; /wallets/onchain uses the same multi-endpoint reader", () => {
  const dig = readFileSync(new URL("./opsDigest.mjs", import.meta.url), "utf8");
  assert.match(dig, /watchdogLine\(await readJson\(env\.LAB_STORE, REGWATCH_KEY\), nowMs\)/);
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("function arbLogsRpc(env) {"), src.indexOf("async function getOnChainWallets("));
  assert.match(fn, /return makeLogsRpc\(logsRpcUrls\(env\), \{ waits: \[300\] \}\);/);
  assert.doesNotMatch(fn, /fetch\(url/, "no single-endpoint fetch left");
});

// ── 2026-11-16 live read: ARBITRUM_RPC_URL = publicnode without its token answers "Archive requests require a personal
//    token" past ~10 blocks; drpc errored; arb1 served a 500-block read. The configured endpoint must not blind it. ──
import { isProviderRefusal, PROVIDER_MIN_SPAN } from "./regWatch.mjs";

test("an endpoint that refuses (token / archive / key) is skipped, never the watchdog's answer", async () => {
  assert.ok(isProviderRefusal("Archive requests require a personal token"));
  assert.ok(isProviderRefusal("", 403));
  assert.ok(isProviderRefusal("this method is not supported on the free plan"));
  assert.ok(!isProviderRefusal("query exceeds max block range 10000"));
  const hits = [];
  const fetchImpl = async (url, init) => {
    const host = new URL(url).host; hits.push(host);
    const { method } = JSON.parse(init.body);
    if (host === "arbitrum-one-rpc.publicnode.com" && method === "eth_getLogs") return reply(200, { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "Archive requests require a personal token" } });
    if (host === "arbitrum.drpc.org") return reply(500, "internal error");
    return reply(200, { jsonrpc: "2.0", id: 1, result: method === "eth_getLogs" ? [] : "0x10" });
  };
  const urls = logsRpcUrls({ ARBITRUM_RPC_URL: "https://arbitrum-one-rpc.publicnode.com" });
  assert.equal(urls[0], "https://arbitrum-one-rpc.publicnode.com");
  const rpc = makeLogsRpc(urls, { fetchImpl, sleep: async () => {} });
  assert.deepEqual(await rpc("eth_getLogs", [{ fromBlock: "0x1", toBlock: "0x2711" }]), []);
  assert.deepEqual(hits, ["arbitrum-one-rpc.publicnode.com", "arb1.arbitrum.io"]);
});

test("a provider capped below 2,000 blocks is skipped once the scanner has halved down to it", async () => {
  const hits = [];
  const fetchImpl = async (url, init) => {
    const host = new URL(url).host; hits.push(host);
    void init;
    if (host === "tiny.example") return reply(200, { error: { code: -32602, message: "block range too large, max 10 blocks" } });
    return reply(200, { result: [] });
  };
  const rpc = makeLogsRpc(["https://tiny.example", "https://arb1.arbitrum.io/rpc"], { fetchImpl, sleep: async () => {} });
  await assert.rejects(rpc("eth_getLogs", [{ fromBlock: "0x1", toBlock: "0x2710" }]), /block range too large/, "10k: the scanner halves first");
  hits.length = 0;
  assert.deepEqual(await rpc("eth_getLogs", [{ fromBlock: "0x1", toBlock: "0x" + PROVIDER_MIN_SPAN.toString(16) }]), []);
  assert.deepEqual(hits, ["tiny.example", "arb1.arbitrum.io"], "at ≤ 2,000 blocks it moves on");
  // end to end: the watchdog reads through it and is never blind
  const env = { LAB_STORE: kv() };
  const r = await runRegWatch(env, { logsRpc: makeLogsRpc(["https://tiny.example", "https://arb1.arbitrum.io/rpc"], {
    fetchImpl: async (url, init) => {
      const { method } = JSON.parse(init.body);
      if (method === "eth_blockNumber") return reply(200, { result: "0x" + (200_000).toString(16) });
      if (new URL(url).host === "tiny.example") return reply(200, { error: { message: "block range too large, max 10 blocks" } });
      return reply(200, { result: [] });
    }, sleep: async () => {} }), now: () => 0, index: async () => ({}), send: async () => true, scanOpts: { sleep: async () => {} } });
  assert.equal(r.scanError, null);
  assert.ok(JSON.parse(env.LAB_STORE.m.get(REGWATCH_KEY)).scannedTo > 200_000 - LOOKBACK_BLOCKS);
});
