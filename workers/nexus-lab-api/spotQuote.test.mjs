// /swap/quote via spanDEX. The network is always faked (tests never touch the real network).
import test from "node:test";
import assert from "node:assert/strict";
import { spotQuote, spotFee, parseSpotRequest, pickSpotQuote, feeEcho, PREVIEW_SWAPPER } from "./spotQuote.mjs";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const TAKER = "0x1111111111111111111111111111111111111111";
const FEE_TO = "0x34dFC08eB3B7eD60D00e5B2CB611ac27C152B45c";
const ROUTER = "0x2222222222222222222222222222222222222222";
const ENV = { SPOT_FEE_BPS: "10", SPOT_FEE_RECIPIENT: FEE_TO };
const qs = (o) => new URLSearchParams(o);
const REQ = { chain: "8453", tokenIn: USDC, tokenOut: WETH, amount: "20000000", taker: TAKER };

// Fake fetch: records every URL; answers Nordstern + 0x with shapes the SDK parses.
function fakeNet({ nordstern = "ok", zerox = "ok", nordsternFee = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    calls.push({ url: u, headers: init?.headers || {} });
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (u.host === "api.nordstern.finance") {
      if (nordstern === "fail") return reply(500, { error: "down" });
      if (u.searchParams.has("convenienceFee") && nordstern === "refuse_fee") return reply(400, { error: "fee" });
      const body = {
        src: USDC, dst: WETH, fromAmount: u.searchParams.get("amount"), toAmount: "5000000000000000",
        tx: { to: ROUTER, data: "0xabcdef", value: "0" }, swaps: [],
      };
      if (nordsternFee && u.searchParams.has("convenienceFee")) body.convenienceFee = { amount: "20000", token: USDC };
      return reply(200, body);
    }
    if (u.host === "api.0x.org") {
      if (zerox === "fail") return reply(400, { name: "INPUT_INVALID" });
      return reply(200, {
        sellToken: USDC, buyToken: WETH, sellAmount: u.searchParams.get("sellAmount"), buyAmount: "5100000000000000",
        minBuyAmount: "5049000000000000", allowanceTarget: "0x0000000000001fF3684f28c67538d4D072C22734",
        transaction: { to: "0x0000000000001fF3684f28c67538d4D072C22734", data: "0x1234", value: "0" },
        fees: { integratorFee: u.searchParams.has("swapFeeBps") ? { amount: "20000", token: USDC } : null },
        route: { tokens: [], fills: [] },
      });
    }
    throw new Error("unexpected host " + u.host);
  };
  return calls;
}

test("fee config: both vars valid and ≤100 bps, else off", () => {
  assert.deepEqual(spotFee(ENV), { bps: 10, recipient: FEE_TO });
  assert.equal(spotFee({ SPOT_FEE_BPS: "10" }), null);
  assert.equal(spotFee({ SPOT_FEE_BPS: "101", SPOT_FEE_RECIPIENT: FEE_TO }), null);
  assert.equal(spotFee({ SPOT_FEE_BPS: "0", SPOT_FEE_RECIPIENT: FEE_TO }), null);
  assert.equal(spotFee({}), null);
});

test("bad params are refused before any network call", () => {
  for (const bad of [{ ...REQ, amount: "0" }, { ...REQ, amount: "1e6" }, { ...REQ, tokenOut: "WETH" }, { ...REQ, chain: "" }, { ...REQ, tokenOut: USDC }]) {
    assert.equal(parseSpotRequest(qs(bad)).error, "bad_params");
  }
  const p = parseSpotRequest(qs({ ...REQ, taker: "" }));
  assert.equal(p.executable, false);
  assert.equal(p.swap.swapperAccount, PREVIEW_SWAPPER);
});

test("Nordstern gets our fee on the wire as convenienceFee (percent) + recipient", async () => {
  const calls = fakeNet();
  const r = await spotQuote(ENV, qs(REQ));
  const n = calls.find((c) => c.url.host === "api.nordstern.finance");
  assert.equal(n.url.pathname, "/aggregator/8453");
  assert.equal(n.url.searchParams.get("convenienceFee"), "0.1");
  assert.equal(n.url.searchParams.get("convenienceFeeRecipient"), FEE_TO);
  assert.equal(n.url.searchParams.get("from"), TAKER);
  assert.equal(n.url.searchParams.get("amount"), "20000000");
  assert.equal(r.ok, true);
  assert.equal(r.router, "spanDEX");
  assert.equal(r.provider, "Nordstern");
  assert.equal(r.feeApplied, true);
  assert.equal(r.feeBps, 10);
  assert.deepEqual(r.approval, { token: USDC, amount: "20000000", spender: ROUTER });
  assert.deepEqual(r.tx, { to: ROUTER, data: "0xabcdef", value: "0" });
  assert.equal(r.priceImpact, null);
  assert.equal(calls.some((c) => c.url.host === "api.0x.org"), false, "0x is off without a key");
});

test("no fee set: nothing fee-related goes on the wire", async () => {
  const calls = fakeNet();
  const r = await spotQuote({}, qs(REQ));
  const n = calls.find((c) => c.url.host === "api.nordstern.finance");
  assert.equal(n.url.searchParams.has("convenienceFee"), false);
  assert.equal(r.feeApplied, false);
  assert.equal(r.feeConfigured, false);
  assert.equal(r.feeBps, 0);
});

test("fee not echoed by the provider ⇒ feeApplied stays false (never asserted)", async () => {
  fakeNet({ nordsternFee: false });
  const r = await spotQuote(ENV, qs(REQ));
  assert.equal(r.ok, true);
  assert.equal(r.feeApplied, false);
  assert.equal(r.feeBps, 0);
  assert.equal(r.feeConfigured, true);
});

test("0x joins with a key, keeps the key in a header, carries swapFeeBps, and the better output wins", async () => {
  const calls = fakeNet();
  const r = await spotQuote({ ...ENV, ZEROX_API_KEY: "secret-key" }, qs(REQ));
  const z = calls.find((c) => c.url.host === "api.0x.org");
  assert.equal(z.headers["0x-api-key"], "secret-key");
  assert.equal(z.url.search.includes("secret-key"), false);
  assert.equal(z.url.searchParams.get("swapFeeBps"), "10");
  assert.equal(z.url.searchParams.get("swapFeeRecipient"), FEE_TO);
  assert.equal(z.url.searchParams.get("taker"), TAKER);
  assert.equal(r.provider, "0x");
  assert.equal(r.outAmount, "5100000000000000");
  assert.equal(r.minOut, "5049000000000000");
  assert.equal(r.feeApplied, true);
});

test("a preview (no taker) never returns calldata", async () => {
  const calls = fakeNet();
  const r = await spotQuote(ENV, qs({ ...REQ, taker: "" }));
  assert.equal(r.ok, true);
  assert.equal(r.tx, null);
  assert.equal(calls[0].url.searchParams.get("from"), PREVIEW_SWAPPER);
});

test("a provider that refuses the fee still leaves a clean quote", async () => {
  const calls = fakeNet({ nordstern: "refuse_fee" });
  const r = await spotQuote(ENV, qs(REQ));
  assert.equal(r.ok, true);
  assert.equal(r.feeApplied, false);
  assert.equal(r.feeConfigured, true);
  assert.equal(calls.filter((c) => c.url.host === "api.nordstern.finance").length, 2);
});

test("every provider failing ⇒ ok:false with the reasons (client falls back to Uniswap)", async () => {
  fakeNet({ nordstern: "fail" });
  const r = await spotQuote(ENV, qs(REQ));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_route");
  assert.ok(r.failures.length >= 1);
});

test("pickSpotQuote drops anything we wouldn't let a wallet sign", () => {
  const swap = parseSpotRequest(qs(REQ)).swap;
  const good = { success: true, provider: "nordstern", inputAmount: 20000000n, outputAmount: 5n, txData: { to: ROUTER, data: "0x" }, approval: { token: USDC, spender: ROUTER } };
  assert.equal(pickSpotQuote([good], swap), good);
  const bad = [
    { ...good, success: false },
    { ...good, inputAmount: 20000001n },                              // spends more than asked
    { ...good, outputAmount: 0n },
    { ...good, txData: { ...good.txData, value: 1n } },               // native value on an ERC-20 swap
    { ...good, approval: { token: WETH, spender: ROUTER } },          // approve a token we didn't choose
    { ...good, approval: undefined },
    { ...good, txData: { to: "nope", data: "0x" } },
  ];
  for (const q of bad) assert.equal(pickSpotQuote([q], swap), null);
  const better = { ...good, outputAmount: 9n };
  assert.equal(pickSpotQuote([good, better], swap), better);
});

test("feeEcho reads 0x's integratorFee and a positive fee-named field, nothing else", () => {
  assert.deepEqual(feeEcho({ provider: "0x", details: { fees: { integratorFee: { amount: "5", token: USDC } } } }), { amount: "5", token: USDC });
  assert.equal(feeEcho({ provider: "0x", details: { fees: { integratorFee: null } } }), null);
  assert.equal(feeEcho({ provider: "nordstern", details: { convenienceFee: "0" } }), null);
  assert.deepEqual(feeEcho({ provider: "nordstern", details: { convenienceFeeAmount: "12" } }), { field: "convenienceFeeAmount", amount: "12" });
});
