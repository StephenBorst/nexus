// Quote refusal set for the 1Click guard (checkQuote): the ways a quote reply can be turned against
// the user, and the refusal each one must get. Runs on REAL signed replies (no funds sent):
// oneclick-quote-usdc-base (USDC Arbitrum → USDC Base, 2026-11-05) and oneclick-quote-live (USDC
// Arbitrum → ETH Base, 2026-09-27). nearIntents.test.mjs keeps the original spot checks; this file
// is the systematic sweep, driven by the list of fields 1Click signs.
//
// Three groups:
//   A. tampered in transit: any signed field changed, added or removed → "signature"
//   B. genuinely signed, but not THIS user's swap → the specific refusal
//   C. fields 1Click does NOT sign: changing them must not change what the user sends
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkQuote, verifyQuoteSignature, buildDepositTx, xcAppFees, XC_ASSETS } from "./nearIntents.mjs";

const fx = (n) => JSON.parse(readFileSync(new URL(`./__fixtures__/${n}.json`, import.meta.url)));
const clone = (o) => JSON.parse(JSON.stringify(o));
const USER = "0x06cD9c281E6ab09906B46a10e059F2770EfdE49A";
const OTHER = "0x2222222222222222222222222222222222222222";

const QUOTES = {
  "usdc-base": {
    q: fx("oneclick-quote-usdc-base"),
    intent: { originAsset: XC_ASSETS["USDC.arb"].assetId, destinationAsset: XC_ASSETS["USDC.base"].assetId, amount: "20000000", recipient: USER, refundTo: USER, originChain: "arb", maxSlippageBps: 100, deadline: fx("oneclick-quote-usdc-base").quoteRequest.deadline },
  },
  live: {
    q: fx("oneclick-quote-live"),
    intent: { originAsset: XC_ASSETS["USDC.arb"].assetId, destinationAsset: XC_ASSETS["ETH.base"].assetId, amount: "20000000", recipient: USER, refundTo: USER, originChain: "arb", maxSlippageBps: 100, deadline: fx("oneclick-quote-live").quoteRequest.deadline },
  },
};
const at = (q) => ({ now: Date.parse(q.timestamp) + 60_000 });

// The fields 1Click's signature covers (nearIntents.mjs signedRequest / signedQuote + timestamp).
// If the guard's hash ever drops one, its row below stops failing with "signature" and this file fails.
// NOT quoteRequest.deadline: the hash merges request + quote fields and quote.deadline overwrites it,
// so the price window we asked for is unsigned (found by this sweep, 2026-11-05; group C covers it).
const SIGNED_REQUEST = ["dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType"];
const SIGNED_QUOTE = ["amountIn", "amountInFormatted", "amountInUsd", "minAmountIn", "amountOut", "amountOutFormatted", "amountOutUsd", "minAmountOut", "depositAddress", "deadline", "timeWhenInactive", "timeEstimate", "refundFee", "withdrawFee"];
// Signed only when present: injecting one into a reply that didn't carry it must break the signature.
const SIGNED_IF_PRESENT_REQUEST = { quoteWaitingTimeMs: 3000, referral: "attacker", virtualChainRecipient: OTHER, virtualChainRefundRecipient: OTHER, customRecipientMsg: "ft_transfer_call" };
const SIGNED_IF_PRESENT_QUOTE = { depositMemo: "12345" };

// A plausible, minimal edit of a value of any type (the kind a proxy would make).
function nudge(v) {
  if (typeof v === "boolean") return !v;
  if (typeof v === "number") return v + 1;
  if (typeof v !== "string") return "x";
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return OTHER;                         // an address → another address
  if (/^\d+$/.test(v)) return (BigInt(v) + 1n).toString();                // base units → one more
  if (!Number.isNaN(Date.parse(v)) && /T/.test(v)) return new Date(Date.parse(v) + 3_600_000).toISOString(); // a time → an hour later
  return v.slice(0, -1) + (v.endsWith("1") ? "2" : "1");                  // anything else → last char changed
}

for (const [name, { q, intent }] of Object.entries(QUOTES)) {
  const I = { ...intent, ...at(q) };

  test(`[${name}] control: the untouched real quote passes`, () => {
    const r = checkQuote(q, I);
    assert.equal(r.ok, true, r.reason);
  });

  // ── A. Tampered in transit ────────────────────────────────────────────────────────────
  test(`[${name}] A: every signed request field, changed → refused "signature"`, () => {
    for (const f of SIGNED_REQUEST) {
      assert.ok(f in q.quoteRequest, `fixture carries ${f}`);
      const t = clone(q); t.quoteRequest[f] = nudge(t.quoteRequest[f]);
      assert.deepEqual(checkQuote(t, I), { ok: false, reason: "signature" }, `quoteRequest.${f}`);
    }
  });

  test(`[${name}] A: every signed quote field, changed → refused "signature"`, () => {
    for (const f of SIGNED_QUOTE) {
      if (!(f in q.quote)) continue;
      const t = clone(q); t.quote[f] = nudge(t.quote[f]);
      assert.deepEqual(checkQuote(t, I), { ok: false, reason: "signature" }, `quote.${f}`);
    }
  });

  test(`[${name}] A: a signed field removed → refused "signature"`, () => {
    for (const f of ["recipient", "refundTo", "slippageTolerance"]) {
      const t = clone(q); delete t.quoteRequest[f];
      assert.equal(checkQuote(t, I).ok, false, `quoteRequest.${f}`);
    }
    for (const f of ["minAmountOut", "depositAddress", "refundFee"]) {
      const t = clone(q); delete t.quote[f];
      assert.equal(checkQuote(t, I).ok, false, `quote.${f}`);
    }
  });

  test(`[${name}] A: a routing field INJECTED (virtual recipient, custom message, memo, referral) → refused`, () => {
    for (const [f, v] of Object.entries(SIGNED_IF_PRESENT_REQUEST)) {
      const t = clone(q); t.quoteRequest[f] = v;
      assert.equal(checkQuote(t, I).ok, false, `quoteRequest.${f}`);
    }
    for (const [f, v] of Object.entries(SIGNED_IF_PRESENT_QUOTE)) {
      const t = clone(q); t.quote[f] = v;
      assert.equal(checkQuote(t, I).ok, false, `quote.${f}`);
    }
  });

  test(`[${name}] A: the signature timestamp moved → refused "signature"`, () => {
    const t = clone(q); t.timestamp = nudge(t.timestamp);
    assert.equal(checkQuote(t, I).reason, "signature");
  });

  test(`[${name}] A: a number sent as a string (or back) changes the signed bytes → refused`, () => {
    const t = clone(q); t.quoteRequest.slippageTolerance = String(t.quoteRequest.slippageTolerance);
    assert.equal(checkQuote(t, I).reason, "signature");
    const u = clone(q); u.quoteRequest.amount = Number(u.quoteRequest.amount);
    assert.equal(checkQuote(u, I).reason, "signature");
  });

  test(`[${name}] A: forged, replayed or mangled signatures → refused "signature"`, () => {
    const other = name === "live" ? QUOTES["usdc-base"].q : QUOTES.live.q;
    const sigs = [
      other.signature,                                   // a real 1Click signature from another quote (replay)
      q.signature.replace(/^ed25519:/, ""),              // prefix stripped (still the same bytes: must still verify)
      q.signature.slice(0, -1) + (q.signature.endsWith("1") ? "2" : "1"),
      "ed25519:" + "1".repeat(88),
      "",
      null,
      12345,
      "secp256k1:" + q.signature.slice(8),
    ];
    for (const s of sigs) {
      const t = clone(q); t.signature = s;
      const prefixOnly = typeof s === "string" && s === q.signature.replace(/^ed25519:/, "");
      if (prefixOnly) { assert.equal(checkQuote(t, I).ok, true, "same signature without the prefix is the same signature"); continue; }
      assert.deepEqual(checkQuote(t, I), { ok: false, reason: "signature" }, String(s).slice(0, 20));
    }
  });

  // ── B. Genuinely signed, but not this user's swap ────────────────────────────────────
  test(`[${name}] B: a real signed quote checked against a different intent → the specific refusal`, () => {
    const cases = [
      [{ recipient: OTHER }, "recipient"],
      [{ refundTo: OTHER }, "refund address"],
      [{ destinationAsset: XC_ASSETS["SOL.sol"].assetId }, "assets"],
      [{ originAsset: XC_ASSETS["USDC.base"].assetId }, "assets"],
      [{ amount: "19999999" }, "amount"],
      [{ amount: "20000001" }, "amount"],
      [{ maxSlippageBps: 50 }, "slippage"],
      [{ originChain: "sol" }, "deposit address"],
      [{ now: Date.parse(q.quoteRequest.deadline) }, "expired"],
      [{ now: Date.parse(q.quoteRequest.deadline) + 1 }, "expired"],
      [{ deadline: "not a time" }, "deadline"],
      [{ appFees: xcAppFees(10, OTHER) }, "app fee"],
    ];
    for (const [over, reason] of cases) assert.deepEqual(checkQuote(q, { ...I, ...over }), { ok: false, reason }, JSON.stringify(over));
  });

  test(`[${name}] B: EVM checksum casing is cosmetic (passes); a dry quote never executes`, () => {
    assert.equal(checkQuote(q, { ...I, recipient: USER.toLowerCase(), refundTo: USER.toUpperCase().replace("0X", "0x") }).ok, true);
    const dry = fx("oneclick-quote-dry");
    assert.equal(verifyQuoteSignature(dry), true, "a real, validly signed dry quote");
    assert.equal(checkQuote(dry, { ...QUOTES.live.intent, ...at(dry) }).reason, "dry quote");
  });

  // ── C. Fields 1Click does NOT sign ────────────────────────────────────────────────────
  test(`[${name}] C: unsigned fields can change without breaking the signature, and never reach the transfer`, () => {
    const t = clone(q);
    t.correlationId = "attacker";
    t.quoteRequest.depositMode = "MEMO";
    t.quoteRequest.confidentiality = "private";
    t.quoteRequest.appFees = [{ recipient: OTHER, fee: 100 }];
    t.extra = { depositAddress: OTHER };
    assert.equal(verifyQuoteSignature(t), true, "these fields are outside the signed hash");
    const r = checkQuote(t, I);
    assert.equal(r.ok, true, r.reason);
    // What the user signs comes only from the checked deposit address + OUR pinned table.
    const built = buildDepositTx("USDC.arb", BigInt(I.amount), r.depositAddress, USER);
    assert.equal(r.depositAddress, q.quote.depositAddress);
    assert.equal(built.tx.to, XC_ASSETS["USDC.arb"].token);
    assert.ok(built.tx.data.toLowerCase().includes(q.quote.depositAddress.slice(2).toLowerCase()));
    assert.ok(!built.tx.data.toLowerCase().includes(OTHER.slice(2)));
    // The user's floor is still the SIGNED minAmountOut, whatever appFees claims.
    assert.equal(r.minAmountOut, q.quote.minAmountOut);
  });

  test(`[${name}] C: quoteRequest.deadline is NOT signed, so the price window comes from what WE asked`, () => {
    // The finding: moving or stripping the reply's price-window deadline keeps the signature valid.
    const later = clone(q); later.quoteRequest.deadline = q.quote.deadline;
    const gone = clone(q); delete gone.quoteRequest.deadline;
    assert.equal(verifyQuoteSignature(later), true);
    assert.equal(verifyQuoteSignature(gone), true);
    // With the deadline we asked for passed in, neither can stretch the window.
    const justAfter = Date.parse(q.quoteRequest.deadline) + 1000;
    for (const t of [later, gone]) {
      assert.equal(checkQuote(t, I).deadlineMs, Date.parse(I.deadline));
      assert.equal(checkQuote(t, { ...I, now: justAfter }).reason, "expired");
    }
    // Without it (the old call), the tampered reply WOULD have stretched the window to the address's life.
    const { deadline: _asked, ...noAsk } = I;
    assert.equal(checkQuote(later, { ...noAsk, now: justAfter }).ok, true, "why the card now passes its own deadline");
  });

  test(`[${name}] C: our own fee is unsigned, so the guard checks it: asked 10, claimed above that → refused "app fee"`, () => {
    const t = clone(q);
    t.quoteRequest.appFees = [{ recipient: USER.toLowerCase(), fee: 11 }];
    assert.equal(checkQuote(t, { ...I, appFees: xcAppFees(10, USER) }).reason, "app fee");
    t.quoteRequest.appFees = [{ recipient: USER.toLowerCase(), fee: 5 }, { recipient: USER.toLowerCase(), fee: 5 }];
    assert.equal(checkQuote(t, { ...I, appFees: xcAppFees(10, USER) }).reason, "app fee", "listed twice");
  });
}

// ── Solana recipient: case matters ────────────────────────────────────────────────────
test("a Solana recipient that differs only in letter case is a different address → refused", () => {
  const q = fx("oneclick-quote-usdc-sol");
  const I = { originAsset: XC_ASSETS["USDC.arb"].assetId, destinationAsset: XC_ASSETS["USDC.sol"].assetId, amount: "20000000", recipient: q.quoteRequest.recipient, refundTo: USER, originChain: "arb", maxSlippageBps: 100, ...at(q) };
  assert.equal(checkQuote(q, I).ok, true);
  const flipped = q.quoteRequest.recipient.replace(/[a-z]/, (c) => c.toUpperCase());
  assert.notEqual(flipped, q.quoteRequest.recipient);
  assert.equal(checkQuote(q, { ...I, recipient: flipped }).reason, "recipient");
});

test("the sweep really covers every field the guard hashes", () => {
  const q = QUOTES["usdc-base"].q;
  // Every non-optional signed request field is present in the real fixture, so group A exercised it.
  for (const f of SIGNED_REQUEST) assert.ok(f in q.quoteRequest, f);
  const covered = SIGNED_QUOTE.filter((f) => f in q.quote);
  assert.ok(covered.length >= 13, `quote fields exercised: ${covered.join(",")}`);
});
