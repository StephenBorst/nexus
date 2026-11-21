// Run: node --test workers/nexus-lab-api/swrCache.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { swrServe, SWR_FRESH_MS } from "./swrCache.mjs";

const memKv = () => {
  const m = new Map(), puts = [];
  return { m, puts, get: async (k) => m.get(k) ?? null, put: async (k, v, o) => { m.set(k, v); puts.push([k, o]); }, delete: async (k) => { m.delete(k); } };
};
const NOW = 1_800_000_000_000;

test("fresh copy: served as is, nothing built", async () => {
  const kv = memKv(); kv.m.set("k", JSON.stringify({ builtAt: NOW - 10_000, x: 1 }));
  let built = 0;
  const r = await swrServe({ kv, key: "k", now: NOW, compose: async () => { built++; return { builtAt: NOW }; }, waitUntil: () => assert.fail("no refresh") });
  assert.deepEqual([r.served, r.body.x, built], ["fresh", 1, 0]);
});

test("older copy: the visitor gets it at once; ONE rebuild runs after the response; a second visitor doesn't start another", async () => {
  const kv = memKv(); kv.m.set("k", JSON.stringify({ builtAt: NOW - SWR_FRESH_MS - 1, x: "old" }));
  let built = 0, release; const bg = [];
  const gate = new Promise((r) => { release = r; }); // the rebuild stays in flight while the second visitor arrives
  const compose = async () => { built++; await gate; return { builtAt: NOW, x: "new" }; };
  const a = await swrServe({ kv, key: "k", now: NOW, compose, waitUntil: (p) => bg.push(p) });
  const b = await swrServe({ kv, key: "k", now: NOW, compose, waitUntil: (p) => bg.push(p) });
  assert.deepEqual([a.served, a.body.x, b.served, b.body.x], ["stale", "old", "stale", "old"]);
  assert.equal(bg.length, 1, "one background refresh");
  release();
  await Promise.all(bg);
  assert.equal(built, 1);
  assert.equal(JSON.parse(kv.m.get("k")).x, "new");
  assert.equal(kv.m.get("k:refreshing"), undefined, "marker cleared");
  assert.deepEqual(kv.puts.find(([k]) => k === "k")[1], { expirationTtl: 3600 });
});

test("a failed refresh keeps the old copy and clears its marker; a refresh `keep` refuses is not stored", async () => {
  const kv = memKv(); kv.m.set("k", JSON.stringify({ builtAt: NOW - 120_000, x: "old" }));
  const bg = [];
  const err = console.error; console.error = () => {};
  try {
    await swrServe({ kv, key: "k", now: NOW, compose: async () => { throw new Error("boom"); }, waitUntil: (p) => bg.push(p) });
    await Promise.all(bg);
  } finally { console.error = err; }
  assert.equal(JSON.parse(kv.m.get("k")).x, "old");
  assert.equal(kv.m.get("k:refreshing"), undefined);
  bg.length = 0;
  await swrServe({ kv, key: "k", now: NOW, compose: async () => ({ builtAt: NOW, rows: [] }), keep: (o) => o.rows.length > 0, waitUntil: (p) => bg.push(p) });
  await Promise.all(bg);
  assert.equal(JSON.parse(kv.m.get("k")).x, "old", "an empty build never replaces a good copy");
});

test("nothing stored: the request builds inline (first deploy); no waitUntil = the old path", async () => {
  const kv = memKv();
  const r = await swrServe({ kv, key: "k", now: NOW, compose: async () => ({ builtAt: NOW, x: 2 }) });
  assert.deepEqual([r.served, r.body.x], ["built", 2]);
  kv.m.set("k", JSON.stringify({ builtAt: NOW - 120_000, x: "old" }));
  const s = await swrServe({ kv, key: "k", now: NOW, compose: async () => ({ builtAt: NOW, x: 3 }) });
  assert.deepEqual([s.served, s.body.x], ["built", 3]);
});

test("the Wire, the bell and the table serve through it, with the request's waitUntil", () => {
  for (const f of ["routes-wire.mjs", "routes-bell.mjs", "routes-table.mjs"]) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    assert.match(src, /swrServe\(\{/, f);
  }
  const idx = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  for (const h of ["handleBell", "handleWire", "handleTable"]) {
    const call = idx.slice(idx.indexOf(`await ${h}(parts, request, env, {`), idx.indexOf(`await ${h}(parts, request, env, {`) + 400);
    assert.match(call, /waitUntil: \(p\) => ctx\.waitUntil\(p\)/, h);
  }
});
