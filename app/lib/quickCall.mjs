// When can a call be posted? (2026-11-14, borst: "make the thesis engine easier and cleaner to publish".)
// A call is graded from its levels alone (callMath callInvalidReason, the same rule the server refuses on), so
// posting needs a coin, a committed side and gradeable levels. Account size only sizes a LIVE order: it was
// required to post (calcThesis returned null without it), while the page said "you don't need capital to build
// a record here". Pure, tested.

import { callInvalidReason, callRR, SPLIT_EXIT } from "./callMath.mjs";

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : NaN;
};

/** The call as the grader will read it, from the form's strings. */
export function callFromForm(form = {}) {
  const t2 = n(form.takeProfit2);
  return {
    direction: form.direction === "SHORT" ? "SHORT" : "LONG",
    entryPrice: n(form.entryPrice),
    stopLoss: n(form.stopLoss),
    takeProfit1: n(form.takeProfit1),
    takeProfit2: t2 > 0 ? t2 : 0,
    exitPlan: form.splitExit && t2 > 0 ? SPLIT_EXIT : undefined,
  };
}

/**
 * Can this be posted as a call? `{ ok, reason, rr }`; `reason` is the plain line the Post button shows when
 * it can't (null when it can). `listed` false = the coin isn't an Orderly market, so it can't be graded.
 */
export function callReady(form = {}, { dirArmed = true, listed = true } = {}) {
  const t = callFromForm(form);
  const rr = callRR(t);
  if (!String(form.symbol ?? "").trim()) return { ok: false, reason: "Pick a coin.", rr };
  if (!listed) return { ok: false, reason: "Pick a listed market so it can be graded.", rr };
  if (!dirArmed) return { ok: false, reason: "Pick a side.", rr };
  const bad = callInvalidReason(t);
  if (bad) return { ok: false, reason: `Can’t be graded: ${bad}.`, rr };
  return { ok: true, reason: null, rr };
}

/** A live order also needs a real size (account × risk ÷ stop distance). */
export function liveOrderReady(ready, positionSize) {
  return !!ready?.ok && Number.isFinite(positionSize) && positionSize > 0;
}
