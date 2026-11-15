import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { qpayFailure, NOTHING_PAID, MAYBE_PAID } from "./qpayNote.mjs";

// A failed Q Signals pull says whether money moved (2026-11-15).
test("before the signature or a 402 decline = nothing paid; signed then lost = may still settle", () => {
  assert.equal(qpayFailure("Payment signature was cancelled.", { signed: false }), `Payment signature was cancelled. ${NOTHING_PAID}`);
  assert.equal(qpayFailure("Couldn't reach Quotient — try again shortly", { signed: false }), `Couldn't reach Quotient — try again shortly. ${NOTHING_PAID}`);
  assert.equal(qpayFailure("Quotient declined the payment: expired", { signed: true, declined: true }), `Quotient declined the payment: expired. ${NOTHING_PAID}`);
  assert.equal(qpayFailure("You signed the payment, but Quotient's reply never arrived", { signed: true }), `You signed the payment, but Quotient's reply never arrived. ${MAYBE_PAID}`);
  assert.match(qpayFailure("", { signed: false }), /^Couldn't load signals\. Nothing was paid\.$/);
});

test("qpay.ts marks the stage right after the signature and never claims a payment went through", () => {
  const src = readFileSync(new URL("../pages/lab/qpay.ts", import.meta.url), "utf8");
  assert.match(src, /await signXPayment\(provider, g, x402Version\);\n  stage\.signed = true;/);
  assert.match(src, /throw new Error\(qpayFailure\(msg, \{ signed: stage\.signed, declined: e instanceof QPullError && e\.declined \}\)\);/);
  assert.match(src, /new QPullError\(`Quotient declined the payment/);
  assert.doesNotMatch(src, /Payment sent but/);
  const load = src.slice(src.indexOf("export async function loadQuotientDirect("), src.indexOf("async function pullQuotient("));
  assert.match(load, /return await pullQuotient\(/, "every path of the pull runs inside the wrapper");
});
