import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkPreview, quoteErrorText, maxSendable, GAS_RESERVE, xcSteps, pushHistory, HISTORY_MAX } from "./xcCardKit.mjs";
import { XC_ASSETS } from "./nearIntents.mjs";

const fx = (n) => JSON.parse(readFileSync(new URL(`./__fixtures__/${n}.json`, import.meta.url)));
const DRY = fx("oneclick-quote-dry");   // real signed DRY quote: 20 USDC Arbitrum → ETH Base
const LIVE = fx("oneclick-quote-live"); // real signed non-dry quote, same pair
const ASK = { originAsset: XC_ASSETS["USDC.arb"].assetId, destinationAsset: XC_ASSETS["ETH.base"].assetId, amount: "20000000" };
const clone = (o) => JSON.parse(JSON.stringify(o));

test("checkPreview: the real dry quote gives the estimate; tampered, live, or a different ask is refused", () => {
  const r = checkPreview(DRY, ASK);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.amountOut, DRY.quote.amountOut);
  assert.equal(r.minAmountOut, DRY.quote.minAmountOut);
  const t = clone(DRY); t.quote.amountOut = String(BigInt(t.quote.amountOut) * 2n);
  assert.equal(checkPreview(t, ASK).reason, "signature", "an inflated estimate");
  assert.equal(checkPreview(LIVE, ASK).reason, "not a preview");
  assert.equal(checkPreview(DRY, { ...ASK, amount: "20000001" }).reason, "amount");
  assert.equal(checkPreview(DRY, { ...ASK, destinationAsset: XC_ASSETS["SOL.sol"].assetId }).reason, "assets");
  assert.equal(checkPreview(null, ASK).ok, false);
});

test("quoteErrorText: the errors seen live read in plain words, with the minimum in human units", () => {
  const usdc = { sym: "USDC", decimals: 6 };
  assert.equal(quoteErrorText("Amount is too low for bridge, try at least 90534", usdc), "Too small for this route. Send at least 0.090534 USDC.");
  assert.equal(quoteErrorText("Amount is too low for bridge, try at least 2000000", usdc), "Too small for this route. Send at least 2 USDC.");
  assert.match(quoteErrorText("No liquidity available", usdc), /No route for this amount/);
  assert.match(quoteErrorText("recipient is not valid", usdc), /destination address isn’t valid/);
  assert.match(quoteErrorText("", usdc), /No quote right now/);
  assert.equal(quoteErrorText("x".repeat(200)).length, 138);
  assert.equal(quoteErrorText("Something new"), "Something new");
});

test("maxSendable: a token sends its whole balance; native keeps the chain's gas reserve; never negative", () => {
  assert.equal(maxSendable({ balance: 5_000_000n, native: false, chain: "arb" }), 5_000_000n);
  assert.equal(maxSendable({ balance: 10n ** 18n, native: true, chain: "base" }), 10n ** 18n - GAS_RESERVE.base);
  assert.equal(maxSendable({ balance: 10n ** 18n, native: true, chain: "eth" }), 10n ** 18n - GAS_RESERVE.eth);
  assert.equal(maxSendable({ balance: 1_000_000_000n, native: true, chain: "sol" }), 990_000_000n);
  assert.equal(maxSendable({ balance: GAS_RESERVE.arb, native: true, chain: "arb" }), 0n);
  assert.equal(maxSendable({ balance: "junk", native: true, chain: "arb" }), 0n);
  assert.equal(maxSendable({ balance: 0n, native: false, chain: "arb" }), 0n);
});

test("xcSteps: the last step is the on-chain proof; 1Click's word alone never completes it", () => {
  const states = (t) => xcSteps(t).map((x) => `${x.label}:${x.state}`);
  assert.deepEqual(states({ status: "PENDING_DEPOSIT", hash: "0x1" }), ["Sent:done", "Deposit seen:active", "Swapping:todo", "Delivered:todo", "Confirmed:todo"]);
  assert.deepEqual(states({ status: "PROCESSING", hash: "0x1" }), ["Sent:done", "Deposit seen:done", "Swapping:active", "Delivered:todo", "Confirmed:todo"]);
  assert.deepEqual(states({ status: "SUCCESS", hash: "0x1" }), ["Sent:done", "Deposit seen:done", "Swapping:done", "Delivered:done", "Confirmed:active"]);
  assert.deepEqual(states({ status: "SUCCESS", hash: "0x1", check: { verdict: "DELIVERED", chain: "base" } }).at(-1), "Confirmed on Base:done");
  // A failed proof names the problem; it never reads "Confirmed".
  assert.deepEqual(states({ status: "SUCCESS", hash: "0x1", check: { verdict: "SHORT", chain: "base" } }).at(-1), "Short on Base:failed");
  assert.deepEqual(states({ status: "SUCCESS", hash: "0x1", check: { verdict: "MISMATCH", chain: "base" } }).at(-1), "Didn’t match the quote:failed");
  assert.deepEqual(states({ status: "REFUNDED", hash: "0x1", check: { verdict: "REFUND_SHORT", chain: "arb" } }).at(-1), "Refund short on Arbitrum:failed");
  for (const t of [{ status: "SUCCESS", check: { verdict: "SHORT", chain: "base" } }, { status: "SUCCESS", check: { verdict: "MALFORMED" } }, { status: "REFUNDED", check: { verdict: "REFUND_SHORT" } }])
    assert.ok(!xcSteps({ hash: "0x1", ...t }).some((x) => x.state === "failed" && /confirmed/i.test(x.label)), JSON.stringify(t));
  assert.deepEqual(states({ status: "SUCCESS", hash: "0x1", check: { verdict: "UNREAD" } }).at(-1), "Confirmed:active");
  assert.deepEqual(states({ status: "REFUNDED", hash: "0x1", check: { verdict: "REFUNDED", chain: "arb" } }), ["Sent:done", "Deposit seen:done", "Refunded:done", "Refund confirmed on Arbitrum:done"]);
  assert.deepEqual(states({ status: "INCOMPLETE_DEPOSIT", hash: "0x1" }).slice(-2), ["Short deposit · refunding:active", "Refund confirmed:todo"]);
  assert.deepEqual(states({ status: "FAILED", hash: "0x1" }).at(-1), "Failed at 1Click:failed");
  assert.deepEqual(xcSteps(null), []);
});

test("pushHistory: newest first, one row per deposit address, capped", () => {
  let h = [];
  for (let i = 0; i < 7; i++) h = pushHistory(h, { depositAddress: `0x${i}`, status: "SUCCESS" });
  assert.equal(h.length, HISTORY_MAX);
  assert.deepEqual(h.map((x) => x.depositAddress), ["0x6", "0x5", "0x4", "0x3", "0x2"]);
  h = pushHistory(h, { depositAddress: "0x4", status: "REFUNDED" });
  assert.deepEqual(h.map((x) => x.depositAddress), ["0x4", "0x6", "0x5", "0x3", "0x2"]);
  assert.equal(h[0].status, "REFUNDED");
  assert.deepEqual(pushHistory(h, null), h);
  assert.deepEqual(pushHistory("junk", { depositAddress: "0x9" }).map((x) => x.depositAddress), ["0x9"]);
});
