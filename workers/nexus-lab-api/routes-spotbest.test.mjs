import { test } from "node:test";
import assert from "node:assert/strict";
import { handleSpotBest } from "./routes-spotbest.mjs";

const WETH = "0x4200000000000000000000000000000000000006";
const ENV = { FLASH_API_KEY: "k", FLASH_FEE_BPS: "10" };
const req = (q, method = "GET") => new Request(`https://og.nexustradinglabs.com/spot/best?${q}`, { method });
function fakeFetch({ flashOut = "0.008430", decimals = 18 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    if (url.startsWith("https://flash.")) return Response.json({ to: { asset: "target", amount: flashOut } });
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x" + decimals.toString(16).padStart(64, "0") });
  };
  f.calls = calls;
  return f;
}
const spot = async () => ({ ok: true, outAmount: "8472375047237527" });
let n = 0;
const q = () => `chain=8453&tokenOut=${WETH}&amount=${20000000 + ++n}`; // fresh cache key per test

test("compares spanDEX and Flash for a USDC buy; Flash gets our fee and key in a header", async () => {
  const f = fakeFetch();
  const j = await (await handleSpotBest(["spot", "best"], req(q()), ENV, { fetchImpl: f, spot })).json();
  assert.equal(j.best, "spandex");
  assert.equal(j.decimals, 18);
  const flash = f.calls.find((c) => c.url.startsWith("https://flash."));
  assert.equal(flash.body.flashIntegratorFeeBps, "10");
  assert.equal(flash.body.side, "buy");
  assert.equal(flash.body.contraAsset, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(flash.headers["x-definitive-api-key"], "k");
  assert.equal(flash.body.funderAddress, undefined, "a price check, no wallet");
});

test("cached for 20 s per (chain, token, amount)", async () => {
  const f = fakeFetch();
  const qq = q();
  await handleSpotBest(["spot", "best"], req(qq), ENV, { fetchImpl: f, spot, now: 1000 });
  const before = f.calls.length;
  await handleSpotBest(["spot", "best"], req(qq), ENV, { fetchImpl: f, spot, now: 5000 });
  assert.equal(f.calls.length, before);
});

test("one router down → the other alone, no comparison claimed", async () => {
  const j = await (await handleSpotBest(["spot", "best"], req(q()), ENV, { fetchImpl: fakeFetch(), spot: async () => ({ ok: false }) })).json();
  assert.equal(j.best, "flash");
  assert.equal(j.edgePct, null);
});

test("bad params, wrong method, gate refusal, not our route", async () => {
  assert.equal((await handleSpotBest(["spot", "best"], req(`chain=56&tokenOut=${WETH}&amount=1`), ENV, { spot })).status, 400);
  assert.equal((await handleSpotBest(["spot", "best"], req(`chain=8453&tokenOut=0x12&amount=1`), ENV, { spot })).status, 400);
  assert.equal((await handleSpotBest(["spot", "best"], req(`chain=8453&tokenOut=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&amount=1`), ENV, { spot })).status, 400);
  assert.equal((await handleSpotBest(["spot", "best"], req(q(), "POST"), ENV, { spot })).status, 405);
  assert.equal((await handleSpotBest(["spot", "best"], req(q()), ENV, { spot, gate: () => new Response("no", { status: 403 }) })).status, 403);
  assert.equal(await handleSpotBest(["spot", "fill"], req(q()), ENV, { spot }), null);
});
