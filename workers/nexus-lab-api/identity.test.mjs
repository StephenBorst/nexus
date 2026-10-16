import { test } from "node:test";
import assert from "node:assert/strict";
import { loadIdentity, identityCardVersion } from "./identity.mjs";

const W = "0xd9f7b3273b504e1473c3faba6341299d0ec9b449";
const kv = (map = {}) => ({ LAB_STORE: { get: async (k) => map[k] ?? null } });

test("record + rank come from the grader's stats", async () => {
  const stats = async () => ({ [W]: { calls: 28, wins: 10, rSum: 1.47, expectancy: null, plan: null } });
  const { profile, record, displayName } = await loadIdentity(kv({ [`profile:${W}`]: JSON.stringify({ displayName: "Bankr" }) }), W, { computeCallerStats: stats });
  assert.deepEqual(record, { calls: 28, hitRate: 35.7, avgR: 0.05 });
  assert.equal(displayName, "Bankr");
  assert.ok(profile.meritRank === null || typeof profile.meritRank.title === "string");
});

test("a failed stats read gives the zero record, never invented numbers", async () => {
  const stats = async () => { throw new Error("kv down"); };
  const { record, profile } = await loadIdentity(kv(), W, { computeCallerStats: stats });
  assert.deepEqual(record, { calls: 0, hitRate: null, avgR: null });
  assert.equal(profile.meritRank, null);
});

test("no stats for the wallet = zero record", async () => {
  const { record } = await loadIdentity(kv(), W, { computeCallerStats: async () => ({}) });
  assert.equal(record.calls, 0);
});

test("image version changes with the record or the rank", () => {
  const a = identityCardVersion({ calls: 28, hitRate: 35.7, avgR: 0.05 }, { tier: "SIGNAL" });
  assert.notEqual(a, identityCardVersion({ calls: 29, hitRate: 34.5, avgR: 0.02 }, { tier: "SIGNAL" }));
  assert.notEqual(a, identityCardVersion({ calls: 28, hitRate: 35.7, avgR: 0.05 }, null));
  assert.match(a, /^[0-9A-Za-z.-]+$/);
});
