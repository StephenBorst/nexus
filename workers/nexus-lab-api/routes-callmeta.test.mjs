// GET /thesis/:wallet/:id/meta — public calls only, grade only from a current stamp, no candle reads.
// Run: node --test workers/nexus-lab-api/routes-callmeta.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { handleCallMeta } from "./routes-callmeta.mjs";
import { GRADE_V } from "./grading.mjs";

const W = "0x9a3012988d60d61b34660be06a321f7bf7bccb28";
const call = (o = {}) => ({ id: "c1", symbol: "PERP_ETH_USDC", direction: "SHORT", entryPrice: 2416.7, stopLoss: 2450, takeProfit1: 2350, isPublic: true, createdAt: Date.UTC(2026, 9, 12), ...o });
const env = (theses, profile) => ({ LAB_STORE: { get: async (k) => k === `lab:${W}` ? JSON.stringify({ theses }) : k === `profile:${W}` && profile ? JSON.stringify(profile) : null } });
const get = (path, e) => handleCallMeta(path.split("/").filter(Boolean), new Request(`https://og.x${path}`), e);
const noFetch = () => { const orig = globalThis.fetch; globalThis.fetch = () => { throw new Error("no network in a meta read"); }; return () => { globalThis.fetch = orig; }; };

test("public call → 200 with the model; profile name used", async () => {
  const restore = noFetch();
  try {
    const res = await get(`/thesis/${W}/c1/meta`, env([call()], { displayName: "Engine B" }));
    assert.equal(res.status, 200);
    const { meta } = await res.json();
    assert.match(meta.title, /^ETH SHORT call by Engine B · /);
    assert.match(meta.description, /Entry \$2,416\.70 · stop \$2,450\.00 · target \$2,350\.00/);
  } finally { restore(); }
});

test("current stamp → graded; old stamp → not graded", async () => {
  const cur = await (await get(`/thesis/${W}/c1/meta`, env([call({ gradedOutcome: "WIN", gradedR: 2, gradeV: GRADE_V })]))).json();
  assert.match(cur.meta.title, /graded WIN \+2\.00R/);
  const old = await (await get(`/thesis/${W}/c1/meta`, env([call({ gradedOutcome: "WIN", gradedR: 2, gradeV: GRADE_V - 1 })]))).json();
  assert.doesNotMatch(old.meta.title, /graded/);
});

test("private, holders-only, duplicate copy, unknown id, unknown wallet → 404", async () => {
  for (const theses of [[call({ isPublic: false })], [call({ holdersOnly: true })], [call({ duplicateOf: "0xabc" })], [call({ id: "other" })]]) {
    assert.equal((await get(`/thesis/${W}/c1/meta`, env(theses))).status, 404);
  }
  assert.equal((await get(`/thesis/0x0000000000000000000000000000000000000001/c1/meta`, env([call()]))).status, 404);
});

test("only the exact /meta path; other /thesis paths fall through", async () => {
  assert.equal(await get(`/thesis/${W}/c1`, env([call()])), null);
  assert.equal(await get(`/thesis/${W}/c1/meta/x`, env([call()])), null);
  assert.equal((await handleCallMeta(["thesis", W, "c1", "meta"], new Request("https://og.x/", { method: "POST" }), env([call()]))).status, 405);
});
