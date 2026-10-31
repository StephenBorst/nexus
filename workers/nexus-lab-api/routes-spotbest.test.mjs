import { test } from "node:test";
import assert from "node:assert/strict";
import { handleSpotBest, swapGasWei, BEST_CHAINS, SWAP_GAS_UNITS } from "./routes-spotbest.mjs";

const WETH = "0x4200000000000000000000000000000000000006";
const ENV = { FLASH_API_KEY: "k", FLASH_FEE_BPS: "10" };
const req = (q, method = "GET") => new Request(`https://og.nexustradinglabs.com/spot/best?${q}`, { method });
const hex = (n) => "0x" + BigInt(n).toString(16);
// gasPrice 0.01 gwei; L1 fee upper bound 0.000001 ETH. null = that read fails on every RPC.
function fakeFetch({ flashOut = "0.008430", decimals = 18, gasPrice = 10_000_000n, l1Fee = 1_000_000_000_000n } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, headers: init.headers });
    if (url.startsWith("https://flash.")) return Response.json({ to: { asset: "target", amount: flashOut } });
    if (url.includes("orderly")) throw new Error("tests never reach Orderly");
    if (body?.method === "eth_gasPrice") return gasPrice == null ? Response.json({ error: { code: -1 } }) : Response.json({ result: hex(gasPrice) });
    if (body?.method === "eth_call" && body.params[0].data.startsWith("0xf1c7a58b")) return l1Fee == null ? Response.json({ error: { code: -1 } }) : Response.json({ result: hex(l1Fee) });
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x" + decimals.toString(16).padStart(64, "0") });
  };
  f.calls = calls;
  return f;
}
const spot = async () => ({ ok: true, outAmount: "8472375047237527" });
const ethUsd = async () => 2500;
const noEth = async () => null;
let n = 0;
const q = () => `chain=8453&tokenOut=${WETH}&amount=${20000000 + ++n}`; // fresh cache key per test

test("compares spanDEX and Flash for a USDC buy; Flash gets our fee and key in a header", async () => {
  const f = fakeFetch();
  const j = await (await handleSpotBest(["spot", "best"], req(q()), ENV, { fetchImpl: f, spot, ethUsd })).json();
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
  await handleSpotBest(["spot", "best"], req(qq), ENV, { fetchImpl: f, spot, ethUsd, now: 1000 });
  const before = f.calls.length;
  await handleSpotBest(["spot", "best"], req(qq), ENV, { fetchImpl: f, spot, ethUsd, now: 5000 });
  assert.equal(f.calls.length, before);
});

test("one router down → the other alone, no comparison claimed", async () => {
  const j = await (await handleSpotBest(["spot", "best"], req(q()), ENV, { fetchImpl: fakeFetch(), spot: async () => ({ ok: false }), ethUsd })).json();
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

test("gas: live gas price × swap gas + the L1 fee on Base, priced in ETH, taken off spanDEX", async () => {
  const f = fakeFetch();
  const qq = q();
  const usd = Number(new URLSearchParams(qq).get("amount")) / 1e6;
  const j = await (await handleSpotBest(["spot", "best"], req(qq), ENV, { fetchImpl: f, spot, ethUsd })).json();
  // (0.01 gwei × 200k + 0.000001 ETH) = 0.000003 ETH × $2500 = $0.0075
  assert.ok(Math.abs(j.gasUsd - 0.0075) < 1e-9);
  assert.equal(j.gasIncluded, true);
  // $20 bought 0.0084724 WETH → $0.0075 of gas ≈ 0.00000318 WETH off spanDEX
  assert.ok(Math.abs(j.spandex - j.spandexAfterGas - 0.0075 * (j.spandex / usd)) < 1e-12);
  assert.match(j.note, /both after network gas/);
  const l1 = f.calls.find((c) => c.body?.params?.[0]?.data?.startsWith("0xf1c7a58b"));
  assert.equal(l1.body.params[0].to, "0x420000000000000000000000000000000000000F");
});

test("gas: no L1 fee read off OP-stack; any unreadable part → no estimate, said plainly", async () => {
  const arb = fakeFetch();
  await handleSpotBest(["spot", "best"], req(`chain=42161&tokenOut=${WETH}&amount=${20000000 + ++n}`), ENV, { fetchImpl: arb, spot, ethUsd });
  assert.equal(arb.calls.some((c) => c.body?.params?.[0]?.data?.startsWith("0xf1c7a58b")), false);
  assert.equal(await swapGasWei(BEST_CHAINS[42161], fakeFetch()), 10_000_000n * SWAP_GAS_UNITS);

  for (const opts of [{ fetchImpl: fakeFetch({ gasPrice: null }), ethUsd }, { fetchImpl: fakeFetch({ l1Fee: null }), ethUsd }, { fetchImpl: fakeFetch(), ethUsd: noEth }]) {
    const j = await (await handleSpotBest(["spot", "best"], req(q()), ENV, { spot, ...opts })).json();
    assert.equal(j.gasIncluded, false);
    assert.equal(j.gasUsd, null);
    assert.match(j.note, /not estimated here/);
  }
});

test("gas: Polygon (POL isn't priced) → no estimate, no gas reads", async () => {
  const f = fakeFetch();
  const j = await (await handleSpotBest(["spot", "best"], req(`chain=137&tokenOut=${WETH}&amount=${20000000 + ++n}`), ENV, { fetchImpl: f, spot, ethUsd })).json();
  assert.equal(j.gasIncluded, false);
  assert.equal(f.calls.some((c) => c.body?.method === "eth_gasPrice"), false);
});
