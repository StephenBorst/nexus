// Q Signals (Quotient x402, app/pages/lab/qpay.ts): every failed pull says whether money moved (2026-11-15).
// The pull has one money step: the wallet signs an EIP-3009 USDC authorization, and Quotient's facilitator settles it
// on Base only if it accepts the paid request. So:
//   - failed before the signature (no wallet, guard refusal, cancelled, Quotient unreachable): nothing was paid;
//   - Quotient answered 402 to the signed request: declined, so it did not settle;
//   - signed, then no reply or an error: we can't know. The authorization can still settle until it expires.
// Pure, tested (qpayNote.test.mjs).

export const NOTHING_PAID = "Nothing was paid.";
export const MAYBE_PAID = "The payment may still settle (about $0.01 USDC to Quotient on Base): check your wallet before pulling again, since a new pull signs a new payment.";

/**
 * @param {string} msg  the plain reason
 * @param {{ signed: boolean, declined?: boolean }} stage
 */
export function qpayFailure(msg, { signed, declined = false }) {
  const base = String(msg || "Couldn't load signals.").trim().replace(/[.\s]*$/, ".");
  return `${base} ${!signed || declined ? NOTHING_PAID : MAYBE_PAID}`;
}
