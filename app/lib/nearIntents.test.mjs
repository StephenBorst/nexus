// Guards for the NEAR Intents 1Click deposit-address flow. The fixtures are REAL signed
// responses from https://1click.chaindefuser.com/v0/quote (Sept 27 2026, 20 USDC on
// Arbitrum → ETH on Base, recipient/refund = our subscription receiver, no funds sent).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyQuoteSignature, checkQuote, addressFitsChain, quoteHash } from "./nearIntents.mjs";

const load = (n) => JSON.parse(readFileSync(new URL(`./__fixtures__/oneclick-quote-${n}.json`, import.meta.url)));
const USER = "0x06cD9c281E6ab09906B46a10e059F2770EfdE49A";
const INTENT = {
  originAsset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
  destinationAsset: "nep141:base.omft.near",
  amount: "20000000",
  recipient: USER,
  refundTo: USER,
  originChain: "arb",
  maxSlippageBps: 100,
  now: Date.parse("2026-09-27T03:54:00Z"),
};
const clone = (o) => JSON.parse(JSON.stringify(o));

test("real 1Click signatures verify against the pinned key (dry and live)", () => {
  assert.equal(verifyQuoteSignature(load("dry")), true);
  assert.equal(verifyQuoteSignature(load("live")), true);
});

test("a live quote for the user's own swap passes and returns its deposit address", () => {
  const r = checkQuote(load("live"), INTENT);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.depositAddress, load("live").quote.depositAddress);
  assert.equal(r.minAmountOut, load("live").quote.minAmountOut);
});

test("a swapped deposit address breaks the signature", () => {
  const r = clone(load("live"));
  r.quote.depositAddress = "0x1111111111111111111111111111111111111111";
  assert.equal(verifyQuoteSignature(r), false);
  assert.deepEqual(checkQuote(r, INTENT), { ok: false, reason: "signature" });
});

test("any signed field altered in transit fails: output, recipient, timestamp", () => {
  for (const mutate of [
    (r) => { r.quote.minAmountOut = "1"; },
    (r) => { r.quoteRequest.recipient = "0x2222222222222222222222222222222222222222"; },
    (r) => { r.timestamp = "2026-09-27T03:53:56.000Z"; },
  ]) {
    const r = clone(load("live")); mutate(r);
    assert.equal(checkQuote(r, INTENT).reason, "signature");
  }
});

test("a genuinely signed quote for SOMEONE ELSE's swap is refused (signature alone is not enough)", () => {
  // Same real, validly signed quote — but the user asked to be paid at a different address.
  const other = { ...INTENT, recipient: "0x3333333333333333333333333333333333333333" };
  assert.equal(checkQuote(load("live"), other).reason, "recipient");
  const refund = { ...INTENT, refundTo: "0x3333333333333333333333333333333333333333" };
  assert.equal(checkQuote(load("live"), refund).reason, "refund address");
});

test("assets, amount and slippage must match what the user asked for", () => {
  assert.equal(checkQuote(load("live"), { ...INTENT, destinationAsset: "nep141:sol.omft.near" }).reason, "assets");
  assert.equal(checkQuote(load("live"), { ...INTENT, amount: "10000000" }).reason, "amount");
  assert.equal(checkQuote(load("live"), { ...INTENT, maxSlippageBps: 50 }).reason, "slippage");
});

test("a dry quote can never be executed", () => {
  assert.equal(checkQuote(load("dry"), INTENT).reason, "dry quote");
});

test("an expired quote is refused", () => {
  assert.equal(checkQuote(load("live"), { ...INTENT, now: Date.parse("2026-10-01T00:00:00Z") }).reason, "expired");
});

test("the EARLIER deadline governs: the price window, not the deposit address's 3-day life", () => {
  const live = load("live");
  // Real fixture: we asked for ~10 min; the address itself stays open for days.
  assert.ok(Date.parse(live.quote.deadline) - Date.parse(live.quoteRequest.deadline) > 24 * 3600e3);
  const r = checkQuote(live, INTENT);
  assert.equal(r.deadlineMs, Date.parse(live.quoteRequest.deadline));
  // Ten minutes after we asked: the address is still open, but the quote is stale → refused.
  assert.equal(checkQuote(live, { ...INTENT, now: Date.parse(live.quoteRequest.deadline) + 1000 }).reason, "expired");
});

test("the deposit address must fit the origin chain's format", () => {
  assert.equal(checkQuote(load("live"), { ...INTENT, originChain: "sol" }).reason, "deposit address");
  assert.equal(addressFitsChain("0x8E3253A1B380C140CD232afD366120DF4a4B7F60", "arb"), true);
  assert.equal(addressFitsChain("0x8E3253A1B380C140CD232afD366120DF4a4B7F6", "arb"), false);
  assert.equal(addressFitsChain("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "sol"), true);
  assert.equal(addressFitsChain("0x8E3253A1B380C140CD232afD366120DF4a4B7F60", "btc"), false); // unsupported origin: refuse
});

test("the hash is deterministic and key-order independent", () => {
  const r = load("live");
  const reordered = { timestamp: r.timestamp, quote: { ...r.quote }, quoteRequest: Object.fromEntries(Object.entries(r.quoteRequest).reverse()), signature: r.signature };
  assert.equal(quoteHash(reordered), quoteHash(r));
  assert.equal(verifyQuoteSignature(reordered), true);
});

test("garbage fails closed, never throws", () => {
  for (const r of [null, {}, { quote: {}, quoteRequest: {} }, { ...load("live"), signature: "ed25519:not-base58-!!" }]) {
    assert.equal(verifyQuoteSignature(r), false);
    assert.equal(checkQuote(r, INTENT).ok, false);
  }
});

// ── the card's transaction + input helpers ─────────────────────────────────────
import { encodeFunctionData, parseAbi } from "viem";
import { encodeTransfer, buildDepositTx, recipientFitsChain, toUnits, fromUnits, XC_ASSETS, sameAddress } from "./nearIntents.mjs";

test("encodeTransfer matches viem byte-for-byte", () => {
  const abi = parseAbi(["function transfer(address,uint256)"]);
  for (const amt of [1n, 20000000n, 2n ** 200n]) {
    const to = "0x8E3253A1B380C140CD232afD366120DF4a4B7F60";
    assert.equal(encodeTransfer(to, amt), encodeFunctionData({ abi, functionName: "transfer", args: [to, amt] }));
  }
  assert.throws(() => encodeTransfer("nope", 1n));
  assert.throws(() => encodeTransfer("0x8E3253A1B380C140CD232afD366120DF4a4B7F60", 0n));
});

test("buildDepositTx: ERC-20 = transfer on the PINNED token with zero value; native = plain value send", () => {
  const dep = load("live").quote.depositAddress;
  const usdc = buildDepositTx("USDC.arb", 20000000n, dep, USER);
  assert.equal(usdc.chainId, 42161);
  assert.equal(usdc.tx.to, XC_ASSETS["USDC.arb"].token);
  assert.equal(usdc.tx.value, "0x0");
  assert.equal(usdc.tx.data, encodeTransfer(dep, 20000000n));
  const eth = buildDepositTx("ETH.base", 10n ** 15n, dep, USER);
  assert.deepEqual(eth, { chainId: 8453, tx: { from: USER, to: dep, value: "0x38d7ea4c68000" } });
  assert.throws(() => buildDepositTx("SOL.sol", 1n, dep, USER), /origin/);       // not an in-app origin
  assert.throws(() => buildDepositTx("USDC.arb", 1n, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", USER), /deposit/);
});

test("the pinned asset ids match what 1Click signed for them", () => {
  assert.equal(load("live").quoteRequest.originAsset, XC_ASSETS["USDC.arb"].assetId);
  assert.equal(load("live").quoteRequest.destinationAsset, XC_ASSETS["ETH.base"].assetId);
});

test("recipient formats per destination chain", () => {
  assert.equal(recipientFitsChain(USER, "base"), true);
  assert.equal(recipientFitsChain("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "sol"), true);
  assert.equal(recipientFitsChain(USER, "sol"), false);
  assert.equal(recipientFitsChain("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "btc"), true);
  assert.equal(recipientFitsChain("0OIl-not-an-address", "btc"), false);
});

test("address matching: EVM ignores checksum case, Solana/bitcoin must match exactly", () => {
  assert.equal(sameAddress(USER, USER.toLowerCase()), true);
  const sol = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  assert.equal(sameAddress(sol, sol), true);
  assert.equal(sameAddress(sol, sol.toLowerCase()), false); // base58 is case-sensitive: a different key
  assert.equal(sameAddress("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ"), false);
  assert.equal(sameAddress(null, USER), false);
});

test("toUnits is exact and refuses over-precision; fromUnits formats", () => {
  assert.equal(toUnits("20", 6), 20000000n);
  assert.equal(toUnits("0.000001", 6), 1n);
  assert.equal(toUnits("0.0000001", 6), null);
  assert.equal(toUnits("1e3", 6), null);
  assert.equal(toUnits("0", 6), null);
  assert.equal(fromUnits("7324345646481841", 18), "0.007324");
  assert.equal(fromUnits("20000000", 6), "20");
});
