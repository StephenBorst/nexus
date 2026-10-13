// Run: node --test workers/nexus-lab-api/routes-thesisreg.test.mjs
// The registration routes against a fake Arbitrum and a fake Bankr. What each test pins is a way
// the old route cost an agent gas or a call: a refusal after paying, a retry that paid twice, a
// slow receipt read as "nothing written".
import test from "node:test";
import assert from "node:assert/strict";
import { handleThesisRegistration } from "./routes-thesisreg.mjs";
import { encodeRegisterThesis, THESIS_REGISTRY, SPLIT_TAG } from "./thesisRegister.mjs";
import { REGISTRY_KEY } from "./callLock.mjs";

const T0 = 1_790_000_000_000;
const W = "0x" + "ab".repeat(20), OTHER = "0x" + "cd".repeat(20);
const word = (a) => "0x" + "0".repeat(24) + a.slice(2);
const hash = (n) => "0x" + n.toString(16).padStart(64, "0");

function kv() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}

// A fake chain: transactions by hash; eth_call behaviour settable.
function chain() {
  const txs = new Map();
  const c = {
    txs, sim: "ok", calls: [], hideReceipt: new Set(),
    add(h, { input, from = W, status = "0x1", atMs = T0, events }) {
      const logs = (events || [from]).map((who, i) => ({ address: THESIS_REGISTRY, topics: ["0x" + "1".repeat(64), hash(100 + i), word(who)] }));
      txs.set(h, { input, receipt: { status, logs, blockNumber: "0x" + (0x10 + txs.size).toString(16) }, atMs });
    },
    async rpc(method, params) {
      c.calls.push(method);
      if (method === "eth_call") {
        if (c.simDelayMs) await new Promise((r) => setTimeout(r, c.simDelayMs));
        if (c.sim === "revert") { const e = new Error("execution reverted"); e.rpcError = { code: 3, message: "execution reverted" }; throw e; }
        if (c.sim === "down") throw new Error("fetch failed");
        return "0x" + "0".repeat(63) + "1";
      }
      const t = txs.get(params[0]);
      if (method === "eth_getTransactionReceipt") return t && !c.hideReceipt.has(params[0]) ? t.receipt : null;
      if (method === "eth_getTransactionByHash") return t ? { input: t.input } : null;
      if (method === "eth_getBlockByNumber") {
        const any = [...txs.values()].find((x) => x.receipt.blockNumber === params[0]);
        return { timestamp: "0x" + Math.floor((any ? any.atMs : T0) / 1000).toString(16) };
      }
      throw new Error("unexpected " + method);
    },
  };
  return c;
}

// A fake Bankr: each submit "mines" the calldata it was given (mode "ok"), or fails in some way.
function bankr(ch, mode = "ok") {
  const b = { submits: 0, mode, next: 1 };
  b.fetch = async (url, init) => {
    assert.equal(url, "https://api.bankr.bot/wallet/submit");
    b.submits++;
    const body = JSON.parse(init.body);
    if (b.mode === "timeout") { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; }
    if (b.mode === "fail") return { status: 400, json: async () => ({ success: false, error: "could not be submitted" }) };
    if (b.mode === "nohash") return { status: 200, json: async () => ({ success: true, status: "queued" }) };
    const h = hash(0xbeef00 + b.next++);
    ch.add(h, { input: body.transaction.data, from: b.from || W });
    return { status: 200, json: async () => ({ success: true, transactionHash: h }) };
  };
  return b;
}

let ipN = 0;
const req = (path, body) => new Request(`https://og.test${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": `10.0.0.${++ipN}` }, body: JSON.stringify(body),
});
const parts = (p) => p.split("/").filter(Boolean);
const call = (over = {}) => ({
  walletAddress: W, bankrApiKey: "bk_test", symbol: "BTC", direction: "LONG",
  entryPrice: 84150, stopLoss: 83300, takeProfit1: 85425, takeProfit2: 87550, notes: "breakout reclaim", ...over,
});
function setup(mode) {
  const env = { LAB_STORE: kv(), NEXUS_AGENT: kv() };
  const ch = chain();
  const bk = bankr(ch, mode);
  const deps = { rpc: ch.rpc, fetchImpl: bk.fetch, readMark: async () => null, now: () => T0 + 60_000, sleep: async () => {} };
  const go = async (path, body) => {
    const res = await handleThesisRegistration(parts(path), req(path, body), env, deps);
    return { status: res.status, body: await res.json() };
  };
  const theses = () => JSON.parse(env.LAB_STORE.m.get(`lab:${W}`) || '{"theses":[]}').theses;
  return { env, ch, bk, go, theses };
}

test("bad levels, a bad split or a would-revert call are refused before anything is sent", async () => {
  const s = setup();
  for (const over of [{ stopLoss: 85000 }, { direction: "UP" }, { exitPlan: "SPLIT_50", takeProfit2: 0 }, { entryPrice: 0.0000123, stopLoss: 0.000011, takeProfit1: 0.000015, takeProfit2: 0 }]) {
    const r = await s.go("/proxy/thesis-register", call(over));
    assert.equal(r.status, 400, JSON.stringify(over));
  }
  assert.equal(s.ch.calls.length, 0, "no RPC either");
  s.ch.sim = "revert";
  const rv = await s.go("/proxy/thesis-register", call());
  assert.deepEqual([rv.status, rv.body.error], [400, "would_revert"]);
  s.ch.sim = "down";
  const dn = await s.go("/proxy/thesis-register", call());
  assert.deepEqual([dn.status, dn.body.error], [503, "simulation_unavailable"]);
  assert.equal(s.bk.submits, 0, "no gas spent on any of them");
  assert.equal(s.env.LAB_STORE.m.size, 0, "and nothing stored, so a fixed call can go straight away");
});

test("a good call: one submit, written from the chain, split declared on-chain, published", async () => {
  const s = setup();
  const r = await s.go("/proxy/thesis-register", call({ exitPlan: "SPLIT_50" }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(s.bk.submits, 1);
  assert.equal(r.body.exitPlan, "SPLIT_50");
  assert.equal(r.body.onChainId, "100");
  const [t] = s.theses();
  assert.deepEqual([t.symbol, t.entryPrice, t.takeProfit2, t.exitPlan, t.notes, t.isPublic], ["PERP_BTC_USDC", 84150, 87550, "SPLIT_50", "breakout reclaim", true]);
  assert.equal(t.createdAt, T0 + 60_000, "the server's clock at publish");
  assert.ok(s.ch.txs.get(r.body.txHash).input.includes(Buffer.from(SPLIT_TAG).toString("hex")), "the declaration is in the calldata");
  assert.ok(s.env.LAB_STORE.m.get(REGISTRY_KEY(W)).includes(t.id), "registered as published: permanent like any call");
});

test("the same call again never pays twice: it returns the first registration", async () => {
  const s = setup();
  const first = await s.go("/proxy/thesis-register", call());
  const again = await s.go("/proxy/thesis-register", call());
  assert.equal(s.bk.submits, 1);
  assert.deepEqual([again.status, again.body.already, again.body.txHash], [200, true, first.body.txHash]);
  assert.equal(s.theses().length, 1);
  // A different call, or the same call from another wallet, isn't blocked.
  await s.go("/proxy/thesis-register", call({ notes: "second idea" }));
  assert.equal(s.bk.submits, 2);
});

test("a slow receipt answers 202 with the txHash; /theses/index finishes it; a retry doesn't resend", async () => {
  const s = setup();
  s.ch.hideReceipt = { has: () => true };
  const r = await s.go("/proxy/thesis-register", call());
  assert.deepEqual([r.status, r.body.pending], [202, true]);
  assert.match(r.body.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(s.theses().length, 0);
  const retry = await s.go("/proxy/thesis-register", call());
  assert.equal(retry.status, 202);
  assert.equal(s.bk.submits, 1, "the retry found the first txHash");
  s.ch.hideReceipt = new Set();
  const ix = await s.go("/theses/index", { txHash: r.body.txHash, walletAddress: W });
  assert.equal(ix.status, 200, JSON.stringify(ix.body));
  assert.equal(s.theses().length, 1);
  const twice = await s.go("/theses/index", { txHash: r.body.txHash, walletAddress: W });
  assert.equal(twice.body.already, true);
  assert.equal(s.theses().length, 1);
});

test("an unknown outcome (timeout, no hash) blocks resending; a refused submit can be retried on purpose", async () => {
  for (const mode of ["timeout", "nohash"]) {
    const s = setup(mode);
    const r = await s.go("/proxy/thesis-register", call());
    assert.equal(r.status, 502);
    assert.equal(r.body.error, mode === "timeout" ? "bankr_timeout" : "bankr_no_tx_hash");
    const again = await s.go("/proxy/thesis-register", call({ retry: true }));
    assert.deepEqual([again.status, again.body.error], [409, "in_flight"], "retry:true can't override an unknown outcome");
    assert.equal(s.bk.submits, 1);
  }
  const s = setup("fail");
  const r = await s.go("/proxy/thesis-register", call());
  assert.deepEqual([r.status, r.body.error], [502, "bankr_submit_failed"]);
  const blocked = await s.go("/proxy/thesis-register", call());
  assert.deepEqual([blocked.status, blocked.body.error], [409, "recent_failure"]);
  assert.equal(s.bk.submits, 1);
  s.bk.mode = "ok";
  const forced = await s.go("/proxy/thesis-register", call({ retry: true }));
  assert.equal(forced.status, 200);
  assert.equal(s.bk.submits, 2);
});

test("/theses/index takes no key, writes only into the wallet the registry named, and only fresh registrations", async () => {
  const s = setup();
  const input = encodeRegisterThesis({ symbol: "ETH", direction: "SHORT", entryPrice: 2556, stopLoss: 2600, takeProfit1: 2480, isPublic: true, notes: "" });
  s.ch.add(hash(1), { input });
  const wrong = await s.go("/theses/index", { txHash: hash(1), walletAddress: OTHER });
  assert.deepEqual([wrong.status, wrong.body.error], [422, "wallet_not_proven"]);
  assert.equal(s.env.LAB_STORE.m.get(`lab:${OTHER}`), undefined);
  s.ch.add(hash(2), { input, status: "0x0" });
  assert.equal((await s.go("/theses/index", { txHash: hash(2), walletAddress: W })).body.error, "tx_failed");
  s.ch.add(hash(3), { input, atMs: T0 - 7 * 3600 * 1000 });
  assert.equal((await s.go("/theses/index", { txHash: hash(3), walletAddress: W })).body.error, "too_old");
  s.ch.add(hash(4), { input, events: [W, OTHER] });
  assert.equal((await s.go("/theses/index", { txHash: hash(4), walletAddress: W })).body.error, "multiple_registrations");
  assert.equal((await s.go("/theses/index", { txHash: "0x12", walletAddress: W })).status, 400);
  const ok = await s.go("/theses/index", { txHash: hash(1), walletAddress: W });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.direction, ok.body.entryPrice, ok.body.exitPlan], ["SHORT", 2556, null]);
  assert.equal(s.theses().length, 1);
  assert.equal(s.bk.submits, 0);
});

test("other paths and methods pass through or are refused", async () => {
  const s = setup();
  assert.equal(await handleThesisRegistration(["theses", "leaderboard"], req("/theses/leaderboard", {}), s.env, {}), null);
  const get = await handleThesisRegistration(["theses", "index"], new Request("https://og.test/theses/index"), s.env, {});
  assert.equal(get.status, 405);
});

test("two identical requests at the same moment: one is sent, the other is told to wait", async () => {
  const s = setup();
  s.ch.simDelayMs = 30; // both requests sit in the simulation window, the gap a KV marker can't cover
  const [a, b] = await Promise.all([s.go("/proxy/thesis-register", call()), s.go("/proxy/thesis-register", call())]);
  assert.equal(s.bk.submits, 1);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal([a, b].find((r) => r.status === 409).body.error, "in_flight");
  const later = await s.go("/proxy/thesis-register", call());
  assert.deepEqual([later.status, later.body.already, s.bk.submits], [200, true, 1], "and a later repeat still finds the first");
});
