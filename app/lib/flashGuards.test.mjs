// Flash pre-signature guards. Fixtures mirror a LIVE Flash quote (Base, 2026-09-25).
// Run: node --test app/lib/flashGuards.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi, maxUint256 } from "viem";
import { checkFlashOrder, checkFlashSetupTx, encodeApprove, toBaseUnits, FLASH_ALLOWANCE } from "./flashGuards.mjs";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const ME = "0x1111111111111111111111111111111111111111";
const EVIL = "0x2222222222222222222222222222222222222222";
const NOW = 1790349000;
const order = (m = {}, d = {}, primaryType = "FlashOrder") => ({
  primaryType,
  domain: { name: "DefinitiveFlashAllowance", version: "1", chainId: "8453", verifyingContract: "0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78", ...d },
  message: { deadline: String(NOW + 669), fromAmount: "25000000", fromToken: USDC, recipient: ME, salt: "1", swapper: ME, toToken: WETH, vault: "0x77304b5Fe89B984635fa32de0D908a86d37422e7", ...m },
});
const EXPECT = { chainId: 8453, wallet: ME, fromToken: USDC, toToken: WETH, maxFromAmount: 25000000n, nowS: NOW };

test("toBaseUnits: exact decimal math, truncates, rejects junk", () => {
  assert.equal(toBaseUnits("25", 6), 25000000n);
  assert.equal(toBaseUnits("0.01", 18), 10000000000000000n);
  assert.equal(toBaseUnits("1.1234567", 6), 1123456n);
  assert.equal(toBaseUnits(".5", 6), 500000n);
  assert.equal(toBaseUnits("abc", 6), null);
  assert.equal(toBaseUnits("", 6), null);
  assert.equal(toBaseUnits("1", -1), null);
});

test("a live-shaped order passes (JSON string or object)", () => {
  const r = checkFlashOrder(JSON.stringify(order()), EXPECT);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.fromAmount, 25000000n);
  assert.equal(checkFlashOrder(order(), EXPECT).ok, true);
});

test("the order is refused if it redirects output, swaps tokens, overspends, or targets the wrong chain/contract", () => {
  const bad = [
    [order({ recipient: EVIL }), /another address/],
    [order({ swapper: EVIL }), /swapper/],
    [order({ fromToken: WETH }), /different token than this trade/],
    [order({ toToken: USDC }), /buys a different token/],
    [order({ fromAmount: "25000001" }), /more than you entered/],
    [order({ fromAmount: "0" }), /amount missing/],
    [order({}, { chainId: "1" }), /chain 1/],
    [order({}, { verifyingContract: EVIL }), /unknown Flash contract/],
    [order({}, {}, "Permit"), /unexpected order type/],
    [order({ deadline: String(NOW - 1) }), /deadline/],
    [order({ deadline: String(NOW + 86400) }), /deadline/],
    ["not json", /not valid typed data/],
    [null, /no order/],
  ];
  for (const [t, re] of bad) {
    const r = checkFlashOrder(t, EXPECT);
    assert.equal(r.ok, false);
    assert.match(r.reason, re);
  }
  assert.match(checkFlashOrder(order(), { ...EXPECT, wallet: "" }).reason, /no wallet/);
});

test("the live unlimited approve is recognised (spender pinned) — and flagged as unlimited", () => {
  const live = { to: USDC, data: "0x095ea7b30000000000000000000000005d00000873b6bf41539e6f5365b0ff7d3c368f78ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", value: 0n };
  const r = checkFlashSetupTx(live, { fromToken: USDC });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.amount, maxUint256);
});

test("setup txs that send ETH, call anything but approve, hit another token or spender are refused", () => {
  const appr = (spender, amt = 1n) => encodeApprove(spender, amt);
  const transfer = encodeFunctionData({ abi: parseAbi(["function transfer(address,uint256)"]), functionName: "transfer", args: [EVIL, 1n] });
  const cases = [
    [{ to: USDC, data: appr(FLASH_ALLOWANCE), value: 1n }, /ETH/],
    [{ to: USDC, data: transfer, value: 0n }, /not a token approval/],
    [{ to: WETH, data: appr(FLASH_ALLOWANCE), value: 0n }, /different token/],
    [{ to: USDC, data: appr(EVIL), value: 0n }, /unknown spender/],
    [{ to: "nope", data: "0x", value: 0n }, /no target/],
  ];
  for (const [tx, re] of cases) {
    const r = checkFlashSetupTx(tx, { fromToken: USDC });
    assert.equal(r.ok, false);
    assert.match(r.reason, re);
  }
});

test("encodeApprove matches viem byte-for-byte (the exact-amount approve we send instead)", () => {
  const abi = parseAbi(["function approve(address,uint256)"]);
  for (const amt of [0n, 1n, 25000000n, maxUint256]) {
    assert.equal(encodeApprove(FLASH_ALLOWANCE, amt), encodeFunctionData({ abi, functionName: "approve", args: [FLASH_ALLOWANCE, amt] }));
  }
  assert.throws(() => encodeApprove("nope", 1n));
});

test("bracket: must be a wallet-bound FlashOrder selling the bought token for the contra token", async () => {
  const { checkFlashBracket } = await import("./flashGuards.mjs");
  const X = { chainId: 8453, wallet: ME, boughtToken: WETH, contraToken: USDC };
  const br = (m = {}, d = {}) => order({ fromToken: WETH, toToken: USDC, deadline: String(NOW + 30 * 86400), fromAmount: "9000000000000000", ...m }, d);
  assert.equal(checkFlashBracket(br(), X).ok, true); // long-lived resting order is fine
  assert.match(checkFlashBracket(br({ recipient: EVIL }), X).reason, /not bound to your wallet/);
  assert.match(checkFlashBracket(br({ fromToken: USDC, toToken: WETH }), X).reason, /different tokens/);
  assert.match(checkFlashBracket(br({}, { verifyingContract: EVIL }), X).reason, /unknown Flash contract/);
  assert.match(checkFlashBracket(br({}, { chainId: "10" }), X).reason, /another chain/);
});
