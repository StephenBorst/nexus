// ── What a swap error tells the trader, and what to do next (pure; tests: swapNotice.test.mjs) ──────
// The signers (swapExec.ts, solSwapExec.ts, jupBuild.mjs, solSwapGuards.mjs) refuse with precise,
// technical reasons ("Route asks for token permissions the swap doesn't need — refused."). Shown raw
// in 10px red mono, a guard that just protected the wallet reads like breakage, and "use the
// deep-link" is jargon. This sorts every message into one of five kinds, each with a plain headline,
// and says when the venue link (the swap on Uniswap / Jupiter in the user's own wallet) is the next step.
//   guard        a check stopped it before the wallet signed: nothing moved; the venue is the way on
//   unavailable  no in-app route for this one: the venue is the way on
//   reverted     it reached the chain and failed: only network fees spent; try again
//   cancelled    the user said no in the wallet: nothing to add
//   input        fix the amount / wallet / network: the message already says how
// The precise reason is kept (as `why`) so support can still read it.

const TAIL = /\s*(?:—|-)\s*(?:use the deep-link\.?|sell via the deep-link\.?)\s*$|\s*Use the deep-link\.?\s*$/i;

/** The reason without its "— use the deep-link" tail (the notice offers the link itself). */
export function cleanReason(msg) {
  return String(msg || "").replace(TAIL, "").replace(/\s*—\s*(refused|aborted|not signing)\.?\s*$/i, "").trim().replace(/[.\s]*$/, ".");
}

/**
 * @param {string} msg  the error message a signer threw (or the ticket set)
 * @returns {{ kind: "guard"|"unavailable"|"reverted"|"cancelled"|"input", headline: string, why: string|null, venue: boolean }}
 */
export function swapNotice(msg) {
  const m = String(msg || "").trim();
  if (!m) return { kind: "input", headline: "", why: null, venue: false };
  if (/^cancelled in your wallet|user rejected|user denied|rejected the request/i.test(m)) {
    return { kind: "cancelled", headline: "Cancelled in your wallet. Nothing was sent.", why: null, venue: false };
  }
  if (/reverted on-chain|failed on-chain/i.test(m)) {
    return { kind: "reverted", headline: m, why: null, venue: false };
  }
  if (/—\s*(refused|aborted|not signing)\b|\brefused\b|\bnot signing\b/i.test(m)) {
    return { kind: "guard", headline: "Stopped before your wallet signed. Nothing moved.", why: cleanReason(m), venue: true };
  }
  if (/use the deep-link|no in-app route|isn't executable|isn't available on this chain|no jupiter route|can't sign a solana transaction here|too large for one transaction|balance too large/i.test(m)) {
    const why = cleanReason(m);
    // "No in-app route right now." only restates the headline: keep the reason only when it adds one.
    return { kind: "unavailable", headline: "No in-app route for this swap right now.", why: /^no (in-app|jupiter) route/i.test(why) ? null : why, venue: true };
  }
  return { kind: "input", headline: m, why: null, venue: false };
}
