// The /og/thesis share card shows a call's levels and notes. It must render a public call and
// refuse anything the feed doesn't show (private, ◆ HOLDERS, a duplicate copy), on BOTH the SVG and
// the PNG path, before any rendering or candle read happens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleOgThesis } from "./routes-ogthesis.mjs";

const W = "0x1111111111111111111111111111111111111111";
const base = {
  symbol: "PERP_BTC_USDC", direction: "LONG", entryPrice: 100, stopLoss: 95, takeProfit1: 110,
  createdAt: Date.UTC(2026, 9, 1, 12), notes: "SECRET-NOTE",
};
const theses = [
  { ...base, id: "pub", isPublic: true },
  { ...base, id: "priv", isPublic: false },
  { ...base, id: "nopub" },
  { ...base, id: "holders", isPublic: false, holdersOnly: true },
  { ...base, id: "legacyholders", isPublic: true, holdersOnly: true },
  { ...base, id: "dup", isPublic: true, duplicateOf: "0x2222222222222222222222222222222222222222" },
];
const env = { LAB_STORE: { get: async (k) => (k === `lab:${W}` ? JSON.stringify({ theses }) : k === `profile:${W}` ? JSON.stringify({ displayName: "tester" }) : null) } };
const req = (method = "GET") => ({ method, headers: new Map() });
const parts = (id) => ["og", "thesis", W, id];

function spyDeps() {
  const calls = { png: 0, candles: 0 };
  return {
    calls,
    deps: {
      getCandles: async () => { calls.candles++; return null; },
      renderPng: async () => { calls.png++; return new Uint8Array([137, 80, 78, 71]); },
    },
  };
}

test("renders a public call (SVG) with its levels", async () => {
  const { deps } = spyDeps();
  const res = await handleOgThesis(parts("pub"), req(), env, deps);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "image/svg+xml");
  const svg = await res.text();
  assert.match(svg, /BTC/);
  assert.match(svg, /SECRET-NOTE/);
});

test("renders a public call (PNG) through renderPng", async () => {
  const { deps, calls } = spyDeps();
  const res = await handleOgThesis(parts("pub.png"), req(), env, deps);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "image/png");
  assert.equal(calls.png, 1);
});

for (const id of ["priv", "nopub", "holders", "legacyholders", "dup", "missing"]) {
  test(`refuses ${id} with a 404 on SVG and PNG, rendering nothing`, async () => {
    for (const path of [id, `${id}.png`]) {
      const { deps, calls } = spyDeps();
      const res = await handleOgThesis(parts(path), req(), env, deps);
      assert.equal(res.status, 404, path);
      assert.doesNotMatch(await res.text(), /SECRET-NOTE|95|110/);
      assert.deepEqual(calls, { png: 0, candles: 0 }, path);
    }
  });
}

test("unknown wallet → 404; other paths → null; non-GET → 405", async () => {
  const res = await handleOgThesis(["og", "thesis", "0x3333333333333333333333333333333333333333", "pub"], req(), env, {});
  assert.equal(res.status, 404);
  assert.equal(await handleOgThesis(["og", "identity", W], req(), env, {}), null);
  assert.equal((await handleOgThesis(parts("pub"), req("POST"), env, {})).status, 405);
});

test("a call the grader can never grade reads NOT GRADED on its card, never ACTIVE", async () => {
  const W2 = "0x4444444444444444444444444444444444444444";
  const calls = [
    { ...base, id: "short-split", isPublic: true, exitPlan: "SPLIT_50", takeProfit2: 105 },   // TP2 short of TP1 (110)
    { ...base, id: "equal-split", isPublic: true, exitPlan: "SPLIT_50", takeProfit2: 110 },   // Engine B v2.1: one target
  ];
  const env2 = { LAB_STORE: { get: async (k) => (k === `lab:${W2}` ? JSON.stringify({ theses: calls }) : null) } };
  const { deps } = spyDeps();
  const bad = await (await handleOgThesis(["og", "thesis", W2, "short-split"], req(), env2, deps)).text();
  assert.match(bad, /NOT GRADED/);
  const ok = await (await handleOgThesis(["og", "thesis", W2, "equal-split"], req(), env2, deps)).text();
  assert.doesNotMatch(ok, /NOT GRADED/);
  assert.match(ok, /ACTIVE/);
});
