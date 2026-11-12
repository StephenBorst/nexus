// ── Minute grading: calls published from MINUTE_GRADE_FROM_MS are graded on public 1-minute bars ──
// The grade is the same rule (logic.mjs gradeCall: the entry must trade, first touch of target vs
// stop, a bar touching both = a loss, a declared split, a declared time stop counted in hours). Only
// the bar changes: 1 minute instead of 1 hour, so a call fills and settles within a minute or two of
// price trading its level instead of waiting for the next hourly pass.
//
// Forward-only, like the time stop (callMath TIME_STOP_FROM_MS): a call published before the cutoff
// keeps its hourly grade, so no stored stamp was made under another rule and GRADE_V doesn't move.
//
// Verifiable: the bars a call is graded on are archived as Orderly served them (lab-api
// minuteCandles.mjs, `m1:{SYMBOL}:{YYYY-MM-DD}`, kept with no expiry) and served at
// GET /candles/1m/:symbol/:day, so anyone can re-run the grade after Orderly stops serving old minutes.
// Rule + reasoning: docs/research/minute-grading.md.

export const MINUTE_GRADE_FROM_MS = Date.UTC(2026, 10, 13);   // 2026-11-13T00:00Z
export const MINUTE_S = 60;

let gradeFromMs = MINUTE_GRADE_FROM_MS;
/**
 * TESTS ONLY. The hourly grader's suites build calls relative to Date.now(), which passes the cutoff
 * on its own: they pin the grader they test with `_pinMinuteGradeFrom(Infinity)` (each test file runs
 * in its own process). Nothing in app/ or workers/ calls it (minuteGrade.test.mjs checks).
 */
export function _pinMinuteGradeFrom(ms) { gradeFromMs = ms; }

/** True when a call is graded on 1-minute bars (published from the cutoff, by the server's clock). */
export function isMinuteGraded(t) {
  return Number(t?.createdAt) >= gradeFromMs;
}

/** How often the grader looks at a call, in words, for the cards. */
export const graderCadence = (t) => (isMinuteGraded(t) ? "every minute" : "every hour");
/** The bar a call's entry fills in, in words ("minute" / "hour"). */
export const gradeBar = (t) => (isMinuteGraded(t) ? "minute" : "hour");
