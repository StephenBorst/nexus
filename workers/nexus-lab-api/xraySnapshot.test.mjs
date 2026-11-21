// The Tracked Record sweep (routes-smart.mjs, fixed 2026-11-21): a partial read is never stored, it is retried
// once, and wallets are read one at a time (live records had 3 snapshots in 44 days under 48-wide bursts).
// Run: node --test workers/nexus-lab-api/xraySnapshot.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { snapshotXray, sweepTrackedXray, readXrayHist } from "./routes-smart.mjs";

const kv = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix = "" } = {}) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
};
const A = "0x" + "a".repeat(40), B = "0x" + "b".repeat(40);
const full = (realized) => ({ markets: 3, totalRealized: realized, totalUnrealized: 0, totalWins: 2, totalLosses: 1, totalOpen: 0, brokersFailed: [] });
const part = (realized) => ({ ...full(realized), brokersFailed: ["aden"] });

test("a full read is stored; a partial read never is", async () => {
  const env = { LAB_STORE: kv() };
  const s1 = await snapshotXray(env, A, full(1000), { now: () => 1_000 });
  assert.equal(s1.length, 1);
  const s2 = await snapshotXray(env, A, part(400), { now: () => 1_000 + 86_400_000 });
  assert.equal(s2.partial, true);
  assert.equal((await readXrayHist(env, A)).length, 1, "the understated read is not in the record");
});

test("the sweep reads one wallet at a time, ≥ 1 s apart, retries a partial once, and counts what it skipped", async () => {
  const env = { LAB_STORE: kv({ "sm:wl:0xowner": JSON.stringify([A, B]) }) };
  const calls = [], sleeps = [];
  let inFlight = 0, maxInFlight = 0;
  const reads = { [A]: [part(1), full(500)], [B]: [part(1), part(1)] };
  const aggregate = async (addr) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    calls.push(addr);
    await Promise.resolve();
    inFlight--;
    return reads[addr].shift();
  };
  const r = await sweepTrackedXray(env, { aggregate, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(maxInFlight, 1, "one wallet at a time");
  assert.deepEqual(calls, [A, A, B, B], "each partial read retried once");
  assert.ok(sleeps.includes(2000), "the retry waits 2 s");
  assert.deepEqual({ watched: r.watched, snapped: r.snapped, partial: r.partial }, { watched: 2, snapped: 1, partial: 1 });
  assert.equal((await readXrayHist(env, A)).length, 1);
  assert.equal((await readXrayHist(env, B)).length, 0, "two partial reads: nothing stored");
});
