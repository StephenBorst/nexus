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
  const X = { chainId: 8453, wallet: ME, boughtToken: WETH, contraToken: USDC, maxFromAmount: 10000000000000000n };
  const br = (m = {}, d = {}) => order({ fromToken: WETH, toToken: USDC, deadline: String(NOW + 30 * 86400), fromAmount: "9000000000000000", ...m }, d);
  assert.equal(checkFlashBracket(br(), X).ok, true); // long-lived resting order is fine
  assert.match(checkFlashBracket(br({ recipient: EVIL }), X).reason, /not bound to your wallet/);
  assert.match(checkFlashBracket(br({ fromToken: USDC, toToken: WETH }), X).reason, /different tokens/);
  assert.match(checkFlashBracket(br({}, { verifyingContract: EVIL }), X).reason, /unknown Flash contract/);
  assert.match(checkFlashBracket(br({}, { chainId: "10" }), X).reason, /another chain/);
  // it pulls from the wallet: a max far above what this trade buys would sell tokens held before
  assert.match(checkFlashBracket(br({ fromAmount: "5000000000000000000" }), X).reason, /more than this trade buys/);
  assert.match(checkFlashBracket(br(), { ...X, maxFromAmount: undefined }).reason, /more than this trade buys/);
  assert.match(checkFlashBracket(br({ fromAmount: "0" }), X).reason, /amount missing/);
});

// ── resting orders, shared approvals, cancel (live quotes, Base, 2026-09-27) ────────────────
// Every order type below is a REAL Flash quote (public dev key, funder = our subscription
// receiver, nothing signed or sent). They all sign the same FlashOrder struct; the deadline is
// the only thing that differs by type.
import { readFileSync } from "node:fs";
import { deadlineOk, openSpend, approvalPlan, flashCancelMessage, utf8Hex, isOrderId, GTC_DEADLINE } from "./flashGuards.mjs";

const LIVE = JSON.parse(readFileSync(new URL("./__fixtures__/flash-quotes.json", import.meta.url)));
const RECEIVER = "0x06cD9c281E6ab09906B46a10e059F2770EfdE49A";
const QUOTE_AT = 1790491060; // when these quotes were taken (market deadline − ~300 s)
const typed = (q) => JSON.parse(q.evm.orderTypedData);
const setupAmount = (q) => BigInt("0x" + q.evm.approveTx.data.slice(-64));

test("live quotes: every order type signs the same FlashOrder, bound to the wallet", () => {
  const cases = [
    ["market", { orderType: "market" }, USDC, WETH, 20000000n],
    ["limit", { orderType: "limit", expireAtS: null }, USDC, WETH, 20000000n],
    ["limit_gtt", { orderType: "limit", expireAtS: Date.parse("2026-10-04T00:00:00Z") / 1000 }, USDC, WETH, 20000000n],
    ["twap", { orderType: "twap", durationS: 3600 }, USDC, WETH, 20000000n],
    ["stoploss", { orderType: "stop-loss", expireAtS: null }, WETH, USDC, 5000000000000000n],
  ];
  for (const [name, rule, from, to, max] of cases) {
    const r = checkFlashOrder(LIVE[name].evm.orderTypedData, { chainId: 8453, wallet: RECEIVER, fromToken: from, toToken: to, maxFromAmount: max, nowS: QUOTE_AT, ...rule });
    assert.equal(r.ok, true, `${name}: ${r.reason}`);
    assert.equal(r.fromAmount, max);
  }
});

test("GTC means Flash's 2^48−1 sentinel; GTT means the expiry we asked for — nothing else", () => {
  assert.equal(Number(typed(LIVE.limit).message.deadline), GTC_DEADLINE);
  assert.equal(Number(typed(LIVE.stoploss).message.deadline), GTC_DEADLINE);
  const exp = Date.parse("2026-10-04T00:00:00Z") / 1000;
  assert.equal(Number(typed(LIVE.limit_gtt).message.deadline), exp);
  const at = { nowS: QUOTE_AT };
  assert.equal(deadlineOk(GTC_DEADLINE, { ...at, orderType: "limit" }), true);
  assert.equal(deadlineOk(GTC_DEADLINE, { ...at, orderType: "limit", expireAtS: exp }), false, "asked GTT, got GTC");
  assert.equal(deadlineOk(exp, { ...at, orderType: "limit" }), false, "asked GTC, got a date");
  assert.equal(deadlineOk(exp + 7 * 86400, { ...at, orderType: "limit", expireAtS: exp }), false, "a week longer than asked");
  assert.equal(deadlineOk(exp + 60, { ...at, orderType: "stop", expireAtS: exp }), true, "rounding slack");
  assert.equal(deadlineOk(GTC_DEADLINE, { ...at, orderType: "market" }), false, "a market order can't rest forever");
  assert.equal(deadlineOk(GTC_DEADLINE, { ...at, orderType: "twap", durationS: 3600 }), false);
  assert.equal(deadlineOk(QUOTE_AT + 600, { ...at, orderType: "bracket" }), false, "unknown type: refuse");
});

test("TWAP: deadline = start + duration + Flash's 60 s buffer; longer is refused", () => {
  const dl = Number(typed(LIVE.twap).message.deadline);
  assert.equal(deadlineOk(dl, { nowS: QUOTE_AT, orderType: "twap", durationS: 3600 }), true);
  assert.equal(deadlineOk(dl, { nowS: QUOTE_AT, orderType: "twap", durationS: 900 }), false, "signed for an hour, asked for 15 min");
  assert.equal(deadlineOk(dl, { nowS: QUOTE_AT, orderType: "twap", durationS: 60 }), false, "below Flash's 5-min minimum");
  const start = QUOTE_AT + 7200;
  assert.equal(deadlineOk(start + 3660, { nowS: QUOTE_AT, orderType: "twap", durationS: 3600, startAtS: start }), true, "scheduled start");
});

test("forceMinimalAllowance: Flash's approve is exactly the order (no open orders); without it, unlimited", () => {
  assert.equal(setupAmount(LIVE.market), maxUint256);
  for (const n of ["market_min", "limit", "limit_gtt", "twap"]) assert.equal(setupAmount(LIVE[n]), 20000000n, n);
  assert.equal(setupAmount(LIVE.stoploss), 5000000000000000n);
});

// A GET /v1/orders row, shaped from Flash's OpenAPI schema.
const row = (o = {}) => ({
  orderId: "5d0aaee6-1111-4222-8333-944445555666", orderType: "limit", side: "buy", status: "ORDER_STATUS_ACCEPTED",
  targetAsset: { address: WETH, ticker: "WETH", chain: { id: "base", name: "base" } },
  contraAsset: { address: USDC, ticker: "USDC", chain: { id: "base", name: "base" } },
  qty: "40", filled: { targetAmount: "0", contraAmount: "0" }, ...o,
});
const U = { chain: "base", token: USDC, decimals: 6 };

test("openSpend: what the wallet's OPEN orders can still pull from a token", () => {
  assert.equal(openSpend([], U), 0n);
  assert.equal(openSpend([row()], U), 40000000n);
  assert.equal(openSpend([row({ status: "ORDER_STATUS_PARTIALLY_FILLED", filled: { contraAmount: "15.5" } })], U), 24500000n);
  for (const s of ["ORDER_STATUS_FILLED", "ORDER_STATUS_CANCELLED", "ORDER_STATUS_REJECTED", "ORDER_STATUS_TERMINATED"])
    assert.equal(openSpend([row({ status: s })], U), 0n, s);
  // a sell spends the TARGET asset, so it never counts against USDC
  assert.equal(openSpend([row({ side: "sell", qty: "0.5" })], U), 0n);
  assert.equal(openSpend([row({ side: "sell", qty: "0.5" })], { chain: "base", token: WETH, decimals: 18 }), 500000000000000000n);
  // same address on another chain (WETH is 0x4200…0006 on Base AND Optimism) doesn't count
  assert.equal(openSpend([row({ contraAsset: { address: USDC, chain: { id: "optimism", name: "optimism" } } })], U), 0n);
  // a pending SL/TP pair will pull the RECEIVED token once live
  const pend = row({ orderType: "market", attachedBracket: { status: "pending_activation", signedMaxFromAmount: "0.0077550489485031" } });
  assert.equal(openSpend([pend], { chain: "base", token: WETH, decimals: 18 }), 7755048948503100n);
  // unreadable rows fail closed
  assert.equal(openSpend([row({ qty: "lots" })], U), null);
  assert.equal(openSpend([row({ side: "sideways" })], U), null);
  assert.equal(openSpend(null, U), null);
});

test("approvalPlan: never unlimited, never beyond this order + the open ones, never below this order", () => {
  const f = 20000000n;
  assert.deepEqual(approvalPlan({ flashAmount: null, fromAmount: f, openAmount: 0n }), { ok: true, amount: null });
  assert.deepEqual(approvalPlan({ flashAmount: 0n, fromAmount: f, openAmount: 0n }), { ok: true, amount: 0n });
  // the live unlimited approve (no forceMinimalAllowance, e.g. a bracket entry) → capped to what we can account for
  assert.deepEqual(approvalPlan({ flashAmount: maxUint256, fromAmount: f, openAmount: 40000000n }), { ok: true, amount: 60000000n, capped: true });
  // forceMinimalAllowance with a 40-USDC order already open → Flash asks 60, which we can account for
  assert.deepEqual(approvalPlan({ flashAmount: 60000000n, fromAmount: f, openAmount: 40000000n }), { ok: true, amount: 60000000n, capped: false });
  assert.equal(approvalPlan({ flashAmount: 19999999n, fromAmount: f, openAmount: 0n }).ok, false);
  assert.equal(approvalPlan({ flashAmount: 1n, fromAmount: 0n, openAmount: 0n }).ok, false);
});

test("the live bracket quote: its SL/TP pair needs its OWN approval of the bought token", async () => {
  const ab = LIVE.bracket.attachedBracket;
  // Flash puts the pair's approve on attachedBracket.evm — NOT in setupTxs (which only carries the
  // entry's USDC approve). Missing it = the exits fail the moment a leg fires.
  assert.equal(LIVE.bracket.setupTxs.length, 1);
  const pairApprove = checkFlashSetupTx({ ...ab.evm.approveTx, value: 0n }, { fromToken: WETH });
  assert.equal(pairApprove.ok, true, pairApprove.reason);
  assert.equal(pairApprove.amount, maxUint256);
  const pairOrder = typed({ evm: ab.evm }).message;
  assert.equal(BigInt(pairOrder.fromAmount), toBaseUnits(ab.signedMaxFromAmount, 18));
  assert.deepEqual(approvalPlan({ flashAmount: pairApprove.amount, fromAmount: BigInt(pairOrder.fromAmount), openAmount: 0n }), { ok: true, amount: 7755048948503100n, capped: true });
  // the live pair's signed max sits ~5% over the quoted output — inside the 1.2× cap the ticket uses
  const cap = (toBaseUnits(LIVE.bracket.to.amount, 18) * 6n) / 5n;
  const { checkFlashBracket } = await import("./flashGuards.mjs");
  const r = checkFlashBracket(ab.evm.orderTypedData, { chainId: 8453, wallet: RECEIVER, boughtToken: WETH, contraToken: USDC, maxFromAmount: cap });
  assert.equal(r.ok, true, r.reason);
});

test("cancel message: Flash's exact bytes (em dash, one newline, the id)", () => {
  const id = "b895f841-3c4c-4705-ab44-1bf274c762f1";
  const m = flashCancelMessage(id);
  assert.equal(m, "Definitive Flash v1 — Cancel Order\nOrder: b895f841-3c4c-4705-ab44-1bf274c762f1");
  assert.equal(utf8Hex("—\n"), "0xe280940a");
  assert.equal(Buffer.from(utf8Hex(m).slice(2), "hex").toString("utf8"), m);
  for (const bad of ["", "x", "b895f841-3c4c-4705-ab44-1bf274c762f", "../orders", null]) {
    assert.equal(isOrderId(bad), false);
    assert.throws(() => flashCancelMessage(bad));
  }
});
