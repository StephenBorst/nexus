// Where a posted call stands, for the cards that show it (Feed card, the call's own page, a trader's
// "In flight" list). Display only: grading is gradeCall's job (lab-api logic.mjs) and nothing here
// changes an outcome.
//
//   WORKING   the entry is a resting order price hasn't reached. There is no position, so there is no
//             P&L: a card shows the order and how far price is from it, never an R or a dollar figure.
//   OPEN      the entry traded; the call is live and its mark-to-market is real.
//   CLOSED    graded (first touch of target or stop), or closed by its owner.
//   UNCHECKED an open call the grader hasn't looked at yet (it stamps `fillState` hourly). A card
//             shows no P&L for it either: an hour of "checking" beats a phantom win.
//   INVALID   the grader can never grade it (levels on the wrong side of entry, a split whose TP2
//             falls short of TP1: callMath.mjs callInvalidReason). It counts nowhere, so a card says
//             so and why, instead of showing it as a live call forever (2026-10-23).
//
// Before this, every unresolved call read as a live position: a LONG with a limit entry at $2,400 and
// ETH at $2,538 showed "+2.73R at target" with no trade behind it.

// One band, shared with the grader (lab-api logic.mjs) and the call page (entryAtMark.mjs).
import { ENTRY_AT_MARK_PCT } from "./entryAtMark.mjs";
import { callInvalidReason } from "./callMath.mjs";
export { ENTRY_AT_MARK_PCT };

const isClosedStatus = (s) => typeof s === "string" && s !== "" && s !== "ACTIVE";

/**
 * @param {object} t a call { status, gradedOutcome?, fillState?, direction, entryPrice, stopLoss, takeProfit1, takeProfit2?, exitPlan?, publishMark? }
 * @returns {"WORKING"|"OPEN"|"CLOSED"|"UNCHECKED"|"INVALID"}
 */
export function callLifecycle(t) {
  if (!t) return "UNCHECKED";
  if (t.gradedOutcome === "WIN" || t.gradedOutcome === "LOSS") return "CLOSED";
  if (callInvalidReason(t)) return "INVALID";
  if (isClosedStatus(t.status)) return "CLOSED";
  if (t.fillState === "WORKING") return "WORKING";
  if (t.fillState === "OPEN") return "OPEN";
  // Not stamped yet. A call posted at the market (within ENTRY_AT_MARK_PCT of the mark the server read
  // when it was published) is filled at the post by the grader's own rule, so that one is OPEN for
  // certain. Anything else may or may not have traded: wait for the grader.
  const entry = Number(t.entryPrice), mark = Number(t.publishMark?.px);
  if (entry > 0 && mark > 0 && Math.abs(entry - mark) / mark <= ENTRY_AT_MARK_PCT / 100) return "OPEN";
  return "UNCHECKED";
}

/** True when a card may show live P&L / R / progress for this call. */
export const showsLivePnl = (t) => callLifecycle(t) === "OPEN";

/**
 * How far price is from a resting entry. `pct` = |mark − entry| / mark, in percent; `side` says where
 * the mark sits relative to the entry ("above" / "below"). null without a usable mark or entry.
 * @returns {{ pct:number, side:"above"|"below" } | null}
 */
export function distanceToEntry(t, mark) {
  const entry = Number(t?.entryPrice), m = Number(mark);
  if (!(entry > 0) || !(m > 0)) return null;
  return { pct: Math.round((Math.abs(m - entry) / m) * 10000) / 100, side: m >= entry ? "above" : "below" };
}

/** "mark 5.45% above the entry" — the line a WORKING card shows instead of P&L. */
export function workingLine(t, mark) {
  const d = distanceToEntry(t, mark);
  return d ? `mark ${d.pct.toFixed(2)}% ${d.side} the entry` : "no position until price trades the entry";
}
