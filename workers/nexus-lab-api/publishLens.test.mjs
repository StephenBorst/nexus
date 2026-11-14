// What the lenses showed at a call's first publish (publishLens.mjs + callLock.mjs). Run: node --test workers/nexus-lab-api/publishLens.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readLensBoards, lensesForPublishes, isLens } from "./publishLens.mjs";
import { sealTheses, SERVER_FIELDS } from "./callLock.mjs";

const NOW = Date.UTC(2026, 10, 15, 12);
const kv = (o) => ({ get: async (k) => (k in o ? o[k] : null) });
const call = (over = {}) => ({ id: "c1", symbol: "ETH", direction: "SHORT", entryPrice: 100, stopLoss: 105, takeProfit1: 90, createdAt: NOW, status: "ACTIVE", ...over });
const boards = {
  smart: { consensus: { ETH: { side: "SHORT", long: 2, short: 9 }, BTC: { long: 5, short: 4 } } },
  mispriced: { markets: [{ coin: "ETH", stretched: true, fundingAnnualPct: 21 }, { coin: "BTC", stretched: false, fundingAnnualPct: 6 }] },
};

test("reads the two cached boards from KV, last-good when the cache is cold, null when unreadable", async () => {
  const env = { NEXUS_AGENT: kv({ "sm:consensus": JSON.stringify(boards.smart.consensus) }), LAB_STORE: kv({ "intel:mispriced:lastgood": JSON.stringify(boards.mispriced) }) };
  const b = await readLensBoards(env);
  assert.equal(b.smart.consensus.ETH.short, 9);
  assert.equal(b.mispriced.markets[0].coin, "ETH");
  const none = await readLensBoards({ NEXUS_AGENT: kv({}), LAB_STORE: kv({ "intel:mispriced:v1": "not json" }) });
  assert.deepEqual(none, { smart: null, mispriced: null });
});

test("one snapshot per newly published call: the 2× rule and the funding stretch, as the drawer reads them", () => {
  const out = lensesForPublishes([call(), call({ id: "c2", symbol: "PERP_BTC_USDC", direction: "LONG" }), call({ id: "old" })], ["c1", "c2"], boards, NOW);
  assert.deepEqual(out.c1, { smartSide: "SHORT", smartL: 2, smartS: 9, stretched: true, fundAnnual: 21, at: NOW });
  assert.equal(out.c2.smartSide, "NONE", "5 vs 4 is no clear agreement");
  assert.equal(out.c2.stretched, false);
  assert.ok(!("old" in out), "only the calls this save publishes anew");
  assert.deepEqual(lensesForPublishes([call()], ["c1"], { smart: null, mispriced: null }, NOW), {});
});

test("the registry pins it at the first publish; no save can add, move or drop it", () => {
  assert.ok(SERVER_FIELDS.includes("publishLens"));
  const lens = lensesForPublishes([call()], ["c1"], boards, NOW);
  const first = sealTheses({ prev: [], incoming: [call({ isPublic: true })], registry: { v: 1, calls: {}, order: [] }, now: NOW, publishLenses: lens });
  assert.deepEqual(first.theses[0].publishLens, lens.c1);
  // a later save that forges or drops it changes nothing
  const forged = sealTheses({ prev: first.theses, incoming: [{ ...first.theses[0], publishLens: { smartSide: "LONG", stretched: false, at: NOW } }], registry: first.registry, now: NOW + 60e3 });
  assert.deepEqual(forged.theses[0].publishLens, lens.c1);
  const dropped = sealTheses({ prev: first.theses, incoming: [{ ...first.theses[0], publishLens: undefined }], registry: first.registry, now: NOW + 60e3 });
  assert.deepEqual(dropped.theses[0].publishLens, lens.c1);
  // a client can't set one on its own private call either
  const priv = sealTheses({ prev: [], incoming: [call({ publishLens: { smartSide: "SHORT", stretched: true, at: NOW } })], registry: { v: 1, calls: {}, order: [] }, now: NOW });
  assert.equal(priv.theses[0].publishLens, undefined);
  // a stale snapshot (read long before the publish) is refused
  const stale = sealTheses({ prev: [], incoming: [call({ isPublic: true })], registry: { v: 1, calls: {}, order: [] }, now: NOW, publishLenses: { c1: { ...lens.c1, at: NOW - 10 * 60e3 } } });
  assert.equal(stale.theses[0].publishLens, undefined);
});

test("shape check", () => {
  assert.equal(isLens({ smartSide: "SHORT", stretched: null, at: 1 }), true);
  assert.equal(isLens({ smartSide: null, stretched: null, at: 1 }), false);
  assert.equal(isLens({ smartSide: "UP", stretched: true, at: 1 }), false);
});
