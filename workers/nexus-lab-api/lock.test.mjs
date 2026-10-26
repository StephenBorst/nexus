// Run: node --test workers/nexus-lab-api/lock.test.mjs
// The one-at-a-time lease (lock.mjs) and the paid paths that use it. Each race test runs twice: with
// no lock (the race is real: both requests win) and with the lock (exactly one wins). A fake Durable
// Object namespace runs the REAL NexusLock class, one request at a time per instance, the way the
// runtime does.
import test from "node:test";
import assert from "node:assert/strict";
import { NexusLock, leaseDecision, withLock, lockFor, LockBusy, LockError, LOCK_KEYS } from "./lock.mjs";
import { redeemOnce, takeSimCredit, takeCapSlot, addSimCredits, refundSimCredit } from "./payGuards.mjs";
import { handleThesisRegistration } from "./routes-thesisreg.mjs";
import { THESIS_REGISTRY } from "./thesisRegister.mjs";

const T0 = 1_790_000_000_000;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// KV whose every read and write takes a few ms, so two requests interleave like they do in production.
function slowKv(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    async get(k) { await pause(3); return m.has(k) ? m.get(k) : null; },
    async put(k, v) { await pause(3); m.set(k, v); },
    async delete(k) { await pause(3); m.delete(k); },
  };
}

// A Durable Object namespace: one NexusLock per name, requests to one instance run one at a time.
function lockNs({ broken = false } = {}) {
  const objs = new Map();
  const ns = {
    requests: 0,
    idFromName: (name) => name,
    get(id) {
      if (!objs.has(id)) {
        const store = new Map();
        const obj = new NexusLock({ storage: {
          get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); },
        } });
        let queue = Promise.resolve();
        objs.set(id, {
          fetch(url) {
            ns.requests++;
            if (broken) return Promise.reject(new Error("network down"));
            const p = queue.then(() => obj.fetch(new Request(url)));
            queue = p.catch(() => {});
            return p;
          },
        });
      }
      return objs.get(id);
    },
  };
  return ns;
}
const fast = { waitMs: 2_000, stepMs: 5 };

test("lease rule: free, expired or own → taken; someone else's → refused; only the owner releases", () => {
  assert.equal(leaseDecision(null, "acquire", "a", T0, 30_000).ok, true);
  assert.deepEqual(leaseDecision(null, "acquire", "a", T0, 30_000).next, { owner: "a", until: T0 + 30_000 });
  const held = { owner: "a", until: T0 + 30_000 };
  assert.equal(leaseDecision(held, "acquire", "b", T0 + 1, 30_000).ok, false);
  assert.equal(leaseDecision(held, "acquire", "a", T0 + 1, 30_000).ok, true, "the owner can renew");
  assert.equal(leaseDecision(held, "acquire", "b", T0 + 30_000, 30_000).ok, true, "an expired lease is free: a dead request can't block a key forever");
  assert.equal(leaseDecision(held, "release", "b", T0, 0).next, undefined, "someone else's release changes nothing");
  assert.equal(leaseDecision(held, "release", "a", T0, 0).next, null);
  assert.equal(leaseDecision(null, "acquire", "a", T0, 99 * 3600_000).next.until, T0 + 10 * 60_000, "ttl capped at 10 min");
});

test("withLock: no binding runs unlocked; busy past waitMs → LockBusy; unreachable → LockError, fn never runs", async () => {
  assert.equal(await withLock({}, "k", async () => 7), 7);
  const env = { NEXUS_LOCK: lockNs() };
  let release;
  const holder = withLock(env, "k", () => new Promise((r) => { release = r; }), fast);
  await pause(10);
  await assert.rejects(withLock(env, "k", async () => "never", { waitMs: 30, stepMs: 5 }), LockBusy);
  release("done");
  assert.equal(await holder, "done");
  assert.equal(await withLock(env, "k", async () => "next", fast), "next", "released: the next caller gets it");
  let ran = false;
  await assert.rejects(withLock({ NEXUS_LOCK: lockNs({ broken: true }) }, "k", async () => { ran = true; }), LockError);
  assert.equal(ran, false);
});

test("a lease is released even when fn throws", async () => {
  const env = { NEXUS_LOCK: lockNs() };
  await assert.rejects(withLock(env, "k", async () => { throw new Error("boom"); }, fast), /boom/);
  assert.equal(await withLock(env, "k", async () => "free", { waitMs: 0 }), "free");
});

test("one sim credit, two runs at once: unlocked both spend it; locked exactly one does", async () => {
  const unlocked = slowKv({ "sim:credits:0xa": "1" });
  const u = await Promise.all([takeSimCredit(unlocked, "sim:credits:0xa"), takeSimCredit(unlocked, "sim:credits:0xa")]);
  assert.equal(u.filter((r) => r.ok).length, 2, "the race is real without a lock");

  const store = slowKv({ "sim:credits:0xa": "1" });
  const lock = lockFor({ NEXUS_LOCK: lockNs() }, fast);
  const r = await Promise.all([takeSimCredit(store, "sim:credits:0xa", lock), takeSimCredit(store, "sim:credits:0xa", lock)]);
  assert.equal(r.filter((x) => x.ok).length, 1);
  assert.equal(store.m.get("sim:credits:0xa"), "0");
});

test("a purchase landing during a run doesn't lose credits (grant, take and refund share the wallet's lease)", async () => {
  const store = slowKv({ "sim:credits:0xa": "1" });
  const lock = lockFor({ NEXUS_LOCK: lockNs() }, fast);
  await Promise.all([
    takeSimCredit(store, "sim:credits:0xa", lock),
    addSimCredits(store, "sim:credits:0xa", 5, lock),
    refundSimCredit(store, "sim:credits:0xa", lock),
  ]);
  assert.equal(store.m.get("sim:credits:0xa"), "6", "1 − 1 + 5 + 1");
});

test("the day's cap: one slot left, two runs at once → one slot", async () => {
  const store = slowKv({ "miro:runs:2026-10-23": "19" });
  const lock = lockFor({ NEXUS_LOCK: lockNs() }, fast);
  const r = await Promise.all([takeCapSlot(store, "miro:runs:2026-10-23", 20, 60, lock), takeCapSlot(store, "miro:runs:2026-10-23", 20, 60, lock)]);
  assert.equal(r.filter((x) => x.ok).length, 1);
  assert.equal(store.m.get("miro:runs:2026-10-23"), "20");
});

test("hosted AI: one call left today, two at once → unlocked both pass the cap; locked one does", async () => {
  const key = "ai:usage:0xabc:claude-sonnet-4-6:2026-10-26";
  const unlocked = slowKv({ [key]: "39" });
  const u = await Promise.all([takeCapSlot(unlocked, key, 40, 60), takeCapSlot(unlocked, key, 40, 60)]);
  assert.equal(u.filter((x) => x.ok).length, 2, "the race is real without the lock");
  const store = slowKv({ [key]: "39" });
  const ns = lockNs();
  const lock = lockFor({ NEXUS_LOCK: ns }, fast);
  const r = await Promise.all([takeCapSlot(store, key, 40, 60, lock, LOCK_KEYS.aiUsage(key)), takeCapSlot(store, key, 40, 60, lock, LOCK_KEYS.aiUsage(key))]);
  assert.equal(r.filter((x) => x.ok).length, 1);
  assert.equal(store.m.get(key), "40");
  assert.equal(LOCK_KEYS.aiUsage(key), `aiusage:${key}`, "its own lease, not the sim cap's");
});

test("one payment tx redeemed twice at once: unlocked both grant; locked one grants, one is told it's used", async () => {
  const tx = "0x" + "aa".repeat(32);
  let grants = 0;
  const grant = async () => { grants++; await pause(3); return "granted"; };
  const raw = slowKv();
  await Promise.all([redeemOnce(raw, tx, "sub:redeemed:", "0xp", grant), redeemOnce(raw, tx, "sub:redeemed:", "0xp", grant)]);
  assert.equal(grants, 2, "the race is real without a lock");

  grants = 0;
  const store = slowKv();
  const lock = lockFor({ NEXUS_LOCK: lockNs() }, fast);
  // PRO and sim credits racing on ONE tx: still one product.
  const r = await Promise.all([
    redeemOnce(store, tx, "sub:redeemed:", "0xp", grant, lock),
    redeemOnce(store, tx, "sim:redeemed:", "0xp", grant, lock),
  ]);
  assert.equal(grants, 1);
  assert.deepEqual(r.map((x) => x.ok).sort(), [false, true]);
  assert.equal(LOCK_KEYS.redeem(tx.toUpperCase()), LOCK_KEYS.redeem(tx), "the key ignores hex case");
});

// ── /proxy/thesis-register across two isolates ─────────────────────────────────────────────────
// A second copy of the route module = a second isolate (its own `inflight` set). The KV marker and
// that set can't stop two identical requests landing on two isolates at once; the lease does.
const W = "0x" + "ab".repeat(20);
const word = (a) => "0x" + "0".repeat(24) + a.slice(2);
const hash = (n) => "0x" + n.toString(16).padStart(64, "0");
const memKv = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); }, async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; } }; };
function world() {
  const txs = new Map();
  let submits = 0, n = 1;
  const rpc = async (method, params) => {
    if (method === "eth_call") { await pause(20); return "0x" + "0".repeat(63) + "1"; }
    const t = txs.get(params[0]);
    if (method === "eth_getTransactionReceipt") return t ? t.receipt : null;
    if (method === "eth_getTransactionByHash") return t ? { input: t.input } : null;
    if (method === "eth_getBlockByNumber") return { timestamp: "0x" + Math.floor(T0 / 1000).toString(16) };
    throw new Error("unexpected " + method);
  };
  const fetchImpl = async (_url, init) => {
    submits++;
    const h = hash(0xbeef00 + n++);
    txs.set(h, { input: JSON.parse(init.body).transaction.data, receipt: { status: "0x1", blockNumber: "0x10", logs: [{ address: THESIS_REGISTRY, topics: ["0x" + "1".repeat(64), hash(100), word(W)] }] } });
    return { status: 200, json: async () => ({ success: true, transactionHash: h }) };
  };
  return { rpc, fetchImpl, submits: () => submits };
}
const body = { walletAddress: W, bankrApiKey: "bk_test", symbol: "BTC", direction: "LONG", entryPrice: 84150, stopLoss: 83300, takeProfit1: 85425, takeProfit2: 87550, notes: "x" };
let ip = 0;
const send = async (mod, env, w) => {
  const path = "/proxy/thesis-register";
  const request = new Request(`https://og.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": `10.9.0.${++ip}` }, body: JSON.stringify(body) });
  const res = await mod.handleThesisRegistration(path.split("/").filter(Boolean), request, env, { rpc: w.rpc, fetchImpl: w.fetchImpl, readMark: async () => null, now: () => T0 + 60_000, sleep: async () => {} });
  return { status: res.status, body: await res.json() };
};

test("thesis-register: two isolates, one call, same instant → unlocked sends twice; locked sends once", async () => {
  const isoA = { handleThesisRegistration };
  const isoB = await import("./routes-thesisreg.mjs?isolate=b");
  assert.notEqual(isoA.handleThesisRegistration, isoB.handleThesisRegistration);

  const w1 = world();
  const envNoLock = { LAB_STORE: memKv(), NEXUS_AGENT: memKv() };
  await Promise.all([send(isoA, envNoLock, w1), send(isoB, envNoLock, w1)]);
  assert.equal(w1.submits(), 2, "the gap is real without the lock");

  const w2 = world();
  const env = { LAB_STORE: memKv(), NEXUS_AGENT: memKv(), NEXUS_LOCK: lockNs() };
  const [a, b] = await Promise.all([send(isoA, env, w2), send(isoB, env, w2)]);
  assert.equal(w2.submits(), 1);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal([a, b].find((r) => r.status === 409).body.error, "in_flight");
});

test("thesis-register: lock unreachable → 503, nothing sent", async () => {
  const w = world();
  const env = { LAB_STORE: memKv(), NEXUS_AGENT: memKv(), NEXUS_LOCK: lockNs({ broken: true }) };
  const r = await send({ handleThesisRegistration }, env, w);
  assert.deepEqual([r.status, r.body.error, w.submits()], [503, "lock_unavailable", 0]);
});
