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

import { snapshotHlRecord, readHlHist, handleSmart } from "./routes-smart.mjs";

const HL = "0x" + "c".repeat(40);
const T0 = 1_790_000_000_000;
const tapeAt = (syncedAt, fills = [], completeFrom = null) => ({ record: { v: 1, fills, completeFrom, syncedAt, seededAt: syncedAt } });

test("Hyperliquid wallets on the board get a daily record from their fill tape; a stale tape is never stored", async () => {
  const env = { LAB_STORE: kv({ "sm:board:v5": JSON.stringify({ traders: [{ source: "hl", address: HL }, { source: "orderly", address: A }] }) }) };
  const aggregate = async () => full(100);
  let syncs = 0;
  const hlSync = async (_env, a, { now }) => { syncs++; assert.equal(a, HL); return tapeAt(now); };
  const r1 = await sweepTrackedXray(env, { aggregate, hlSync, hlNow: () => T0, sleep: async () => {} });
  assert.deepEqual(r1.hl, { watched: 1, snapped: 1, partial: 0 });
  assert.equal(syncs, 1, "the Orderly wallet is not read on Hyperliquid");
  assert.equal((await readHlHist(env, HL))[0].anchor, T0);

  const stale = async (_env, _a, { now }) => tapeAt(now - 60 * 60e3);
  const r2 = await sweepTrackedXray(env, { aggregate, hlSync: stale, hlNow: () => T0 + 86_400_000, sleep: async () => {} });
  assert.deepEqual(r2.hl, { watched: 1, snapped: 0, partial: 1 });
  assert.equal((await readHlHist(env, HL)).length, 1);

  const fills = [[1, T0 + 1000, "ETH", "1", "1", "A", "Close Long", "250", "5"]];
  const ok = async (_env, _a, { now }) => tapeAt(now, fills);
  const s3 = await snapshotHlRecord(env, HL, { sync: ok, now: () => T0 + 86_400_000 });
  assert.equal(s3.length, 2);
  assert.equal(s3[1].realized, 245);
});

test("/smart/xray/tracked and /smart/xray/history read the Hyperliquid record when there's no Orderly one", async () => {
  const rows = [0, 1, 2, 3, 4, 5].map((d) => ({ t: T0 + d * 86_400_000, anchor: T0, realized: d * 100, markets: 1, venue: "hl" }));
  const env = { LAB_STORE: kv({ ["xray:hlhist:" + HL]: JSON.stringify(rows) }) };
  const req = (u) => new Request(`https://og.example${u}`);
  const t = await (await handleSmart(["smart", "xray", "tracked"], req(`/smart/xray/tracked?addresses=${HL}`), env, {})).json();
  assert.equal(t.tracked[HL].venue, "hl");
  assert.equal(t.tracked[HL].scored, true);
  assert.equal(t.tracked[HL].netRealized, 500);
  // history: the stored Orderly series is empty; the snapshot attempt reads nothing (no network in tests → it fails closed).
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("no network in tests"); };
  try {
    const h = await (await handleSmart(["smart", "xray", "history"], req(`/smart/xray/history?address=${HL}`), env, {})).json();
    assert.equal(h.venue, "hl");
    assert.equal(h.track.netRealized, 500);
  } finally { globalThis.fetch = realFetch; }
});
