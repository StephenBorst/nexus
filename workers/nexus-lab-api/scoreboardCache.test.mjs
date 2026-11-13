// The scoreboard is built on a schedule; a request never waits on a rebuild while a copy exists.
// Run: node --test workers/nexus-lab-api/scoreboardCache.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rebuildScoreboard, serveScoreboard, lastGoodKey, SCOREBOARD_TTL_S, SCOREBOARD_REBUILD_MINUTE } from "./scoreboardCache.mjs";

function fakeKv() {
  const m = new Map(), ttl = new Map();
  return {
    m, ttl,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, o) { m.set(k, v); ttl.set(k, o?.expirationTtl); },
    expire(k) { m.delete(k); },
  };
}
const KEY = "axisbt:v26:min20";

test("a stored copy is served as is: no rebuild in the request", async () => {
  const kv = fakeKv();
  await kv.put(KEY, JSON.stringify({ asOf: "a" }));
  let builds = 0;
  const out = await serveScoreboard(kv, KEY, async () => { builds++; return { asOf: "b" }; });
  assert.deepEqual(out, { asOf: "a" });
  assert.equal(builds, 0);
});

test("no copy: build once, store it and a last-good copy", async () => {
  const kv = fakeKv();
  const out = await serveScoreboard(kv, KEY, async () => ({ asOf: "b" }));
  assert.deepEqual(out, { asOf: "b" });
  assert.equal(kv.m.get(KEY), JSON.stringify({ asOf: "b" }));
  assert.equal(kv.m.get(lastGoodKey(KEY)), JSON.stringify({ asOf: "b" }));
  assert.equal(kv.ttl.get(KEY), SCOREBOARD_TTL_S);
});

test("a failed build serves the last good copy, marked stale with the reason; nothing is overwritten", async () => {
  const kv = fakeKv();
  await rebuildScoreboard(kv, KEY, async () => ({ asOf: "old" }));
  kv.expire(KEY);
  const out = await serveScoreboard(kv, KEY, async () => { throw new Error("Worker exceeded CPU time limit."); });
  assert.equal(out.asOf, "old");
  assert.equal(out.stale, true);
  assert.match(out.staleReason, /CPU time limit/);
  assert.equal(kv.m.get(KEY), undefined, "a failed build writes no served copy");
  assert.equal(kv.m.get(lastGoodKey(KEY)), JSON.stringify({ asOf: "old" }));
});

test("a failed build with nothing stored fails loudly (never an empty board)", async () => {
  const kv = fakeKv();
  await assert.rejects(serveScoreboard(kv, KEY, async () => { throw new Error("boom"); }), /boom/);
});

test("the served copy outlives the gap between hourly builds", () => {
  assert.ok(SCOREBOARD_TTL_S > 3600);
});

test("lab-api wires it: the request serves through it, the minute cron rebuilds at its own minute", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /serveScoreboard\(env\.LAB_STORE, CACHE, \(\) => buildAxisScorecard\(env, min\)\)/);
  assert.match(src, /minute === SCOREBOARD_REBUILD_MINUTE/);
  assert.match(src, /rebuildScoreboard\(env\.LAB_STORE, axisbtCacheKey\(20\), \(\) => buildAxisScorecard\(env, 20\)\)/);
  assert.ok(![17, 41, 47].includes(SCOREBOARD_REBUILD_MINUTE) && SCOREBOARD_REBUILD_MINUTE % 5 !== 0,
    "its own minute: not the hourly jobs, the tape, the judge or a push-alert minute");
});
