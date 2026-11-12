/**
 * What a call card shows INSTEAD of live P&L while the call has no position: its entry is a resting
 * order price hasn't reached (WORKING), the grader hasn't checked yet (UNCHECKED), or the grader
 * can never grade it (INVALID: the reason, so it doesn't read as a live call forever). Renders
 * nothing for a CLOSED call. Rule: app/lib/callLifecycle.mjs. Used by the Feed card, the
 * call's own page and the trader profile, so all three say the same thing.
 *
 * Live hint (2026-11-12, `provisionalTouch`): when the live mark has reached a WORKING order's entry,
 * or an OPEN call's target or stop, the card says so at once with "confirming". The mark is not a
 * trade, so this grades nothing: the grader confirms from public bars (every minute for calls posted
 * from MINUTE_GRADE_FROM_MS, app/lib/minuteGrade.mjs; hourly before).
 *
 * Monochrome on purpose: there is no money here, so no green or red (docs/brand.md). The dashed
 * border is the "not a position" mark; a live position keeps its solid card.
 */
import { C } from "@/config/theme";
import { callLifecycle, workingLine, provisionalTouch } from "@/lib/callLifecycle.mjs";
import { graderCadence, gradeBar, isMinuteGraded } from "@/lib/minuteGrade.mjs";
import { callInvalidReason } from "@/lib/callMath.mjs";

const MONO = "var(--nx-font-mono)";

/** Same precision as the Feed card's levels: majors to cents, small caps to more places. */
export const fmtPx = (n: unknown) => {
  const v = Math.abs(Number(n) || 0);
  const dp = v >= 1 ? 2 : v >= 0.01 ? 4 : v >= 0.0001 ? 6 : 8;
  return (Number(n) || 0).toFixed(dp);
};

type Call = {
  status?: string; gradedOutcome?: string; fillState?: string; publishMark?: { px?: number }; createdAt?: number; tp1HitAt?: number;
  direction?: string; entryPrice: number; stopLoss?: number; takeProfit1?: number; takeProfit2?: number; exitPlan?: string;
};

/** The status pill's text for a call with no position, or null when the card's own label applies. */
export function awaitingLabel(t: Call): string | null {
  const s = callLifecycle(t);
  if (s === "WORKING") return `Awaiting fill · $${fmtPx(t.entryPrice)}`;
  if (s === "UNCHECKED") return "Checking fill";
  if (s === "INVALID") return "Not graded";
  return null;
}

/** How soon the grader confirms a touch, in words. */
const confirmLine = (t: Call) => (isMinuteGraded(t)
  ? "The grader confirms it from public 1-minute bars, usually within two minutes."
  : "The grader confirms it from public 1-hour bars at its next hourly pass.");

/** An OPEN call whose live mark has reached its target or stop: one line, until the grade lands. */
function TouchConfirming({ thesis, touch, style }: { thesis: Call; touch: "TARGET" | "STOP"; style?: React.CSSProperties }) {
  return (
    <div style={{ border: `1px dashed ${C.borderStrong}`, borderRadius: 8, padding: "8px 12px", display: "grid", gap: 3, ...style }}>
      <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", color: C.text.bright }}>
        {touch === "TARGET" ? "TARGET REACHED ON THE MARK · CONFIRMING" : "STOP REACHED ON THE MARK · CONFIRMING"}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.text.muted, lineHeight: 1.5 }}>
        {"The mark is an index, not a trade. "}{confirmLine(thesis)}
      </div>
    </div>
  );
}

export function AwaitingFill({ thesis, markPrice, style }: { thesis: Call; markPrice?: number | null; style?: React.CSSProperties }) {
  const state = callLifecycle(thesis);
  const touch = provisionalTouch(thesis, markPrice);
  if (state === "OPEN") return touch === "TARGET" || touch === "STOP" ? <TouchConfirming thesis={thesis} touch={touch} style={style} /> : null;
  if (state === "INVALID") {
    return (
      <div style={{ border: `1px dashed ${C.borderStrong}`, borderRadius: 8, padding: "10px 12px", display: "grid", gap: 4, ...style }}>
        <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", color: C.text.bright }}>NOT GRADED</div>
        <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.text.fog }}>The grader can’t grade this call: {callInvalidReason(thesis)}.</div>
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.text.muted, lineHeight: 1.5 }}>
          It stays published and counts nowhere: not a win, not a loss, not open.
        </div>
      </div>
    );
  }
  if (state !== "WORKING" && state !== "UNCHECKED") return null;
  const working = state === "WORKING";
  const hasMark = markPrice != null && Number(markPrice) > 0;
  return (
    <div style={{ border: `1px dashed ${C.borderStrong}`, borderRadius: 8, padding: "10px 12px", display: "grid", gap: 4, ...style }}>
      <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", color: C.text.bright }}>
        {touch === "ENTRY" ? `ENTRY $${fmtPx(thesis.entryPrice)} REACHED ON THE MARK · CONFIRMING`
          : working ? `AWAITING FILL AT $${fmtPx(thesis.entryPrice)}` : "FILL NOT CHECKED YET"}
      </div>
      {hasMark && (
        <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.text.fog, fontVariantNumeric: "tabular-nums" }}>
          Mark ${fmtPx(markPrice)} · {workingLine(thesis, markPrice)}
        </div>
      )}
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.text.muted, lineHeight: 1.5 }}>
        {touch === "ENTRY"
          ? `No P&L until the fill is confirmed: the mark is an index, not a trade. ${confirmLine(thesis)}`
          : working
            ? `No position yet, so no P&L. The call is graded from the ${gradeBar(thesis)} price reaches the entry.`
            : `The grader hasn’t checked whether the entry traded. It does ${graderCadence(thesis)}; until then, no P&L.`}
      </div>
    </div>
  );
}
