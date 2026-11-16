// When can a call be posted? (2026-11-14, borst: "make the thesis engine easier and cleaner to publish".)
// A call is graded from its levels alone (callMath callInvalidReason, the same rule the server refuses on), so
// posting needs a coin, a committed side and gradeable levels. Account size only sizes a LIVE order: it was
// required to post (calcThesis returned null without it), while the page said "you don't need capital to build
// a record here". Pure, tested.

import { callInvalidReason, callRR, SPLIT_EXIT, SPLIT_BE_EXIT } from "./callMath.mjs";

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : NaN;
};

// The exit plans a caller can declare (2026-11-16). SINGLE = all at TP1; SPLIT = half TP1 + half TP2,
// both on the original stop; BE = half at TP1, then the runner's stop moves to the entry and trails 1R
// behind the best close (TP2 optional). `splitExit: true` is the old form's SPLIT.
export const EXIT_MODES = Object.freeze([
  { id: "SINGLE", label: "All at TP1" },
  { id: "SPLIT", label: "Half TP1 · half TP2" },
  { id: "BE", label: "Half TP1 · runner trails" },
]);
export const FILL_WINDOWS = Object.freeze([4, 12, 24]);

const exitModeOf = (form) => (EXIT_MODES.some((m) => m.id === form.exitMode) ? form.exitMode : form.splitExit ? "SPLIT" : "SINGLE");

/** The `exitPlan` the form declares (undefined = a single target). */
export function exitPlanFromForm(form = {}) {
  const mode = exitModeOf(form), t2 = n(form.takeProfit2);
  if (mode === "BE") return SPLIT_BE_EXIT;
  if (mode === "SPLIT" && t2 > 0) return SPLIT_EXIT;
  return undefined;
}

/** The declared fill window in hours, or undefined (off). */
export function fillWindowFromForm(form = {}) {
  const h = parseInt(String(form.fillWithinH ?? ""), 10);
  return Number.isInteger(h) && h > 0 ? h : undefined;
}

/** One line under the plan picker: what the grader will do with this plan. */
export function exitPlanLine(form = {}) {
  const mode = exitModeOf(form), t2 = n(form.takeProfit2);
  if (mode === "SPLIT") return t2 > 0 ? "Half closes at TP1, half at TP2, both on this stop." : "Add a TP2 for a split, or it grades at TP1 only.";
  if (mode === "BE") return `Half closes at TP1. Then the runner's stop moves to your entry and trails 1R behind the best 1-minute close${t2 > 0 ? ", or closes at TP2" : ""}. After TP1 it can't close as a loss.`;
  return "Everything closes at TP1, or at the stop.";
}

/** The call as the grader will read it, from the form's strings. `now` = the publish time it'd carry. */
export function callFromForm(form = {}, now = Date.now()) {
  const t2 = n(form.takeProfit2);
  return {
    direction: form.direction === "SHORT" ? "SHORT" : "LONG",
    entryPrice: n(form.entryPrice),
    stopLoss: n(form.stopLoss),
    takeProfit1: n(form.takeProfit1),
    takeProfit2: t2 > 0 ? t2 : 0,
    exitPlan: exitPlanFromForm(form),
    fillWithinH: fillWindowFromForm(form),
    createdAt: now,
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
