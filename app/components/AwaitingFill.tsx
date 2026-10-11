/**
 * What a call card shows INSTEAD of live P&L while the call has no position: its entry is a resting
 * order price hasn't reached (WORKING), or the hourly grader hasn't checked yet (UNCHECKED). Renders
 * nothing for an OPEN or CLOSED call. Rule: app/lib/callLifecycle.mjs. Used by the Feed card, the
 * call's own page and the trader profile, so all three say the same thing.
 *
 * Monochrome on purpose: there is no money here, so no green or red (docs/brand.md). The dashed
 * border is the "not a position" mark; a live position keeps its solid card.
 */
import { C } from "@/config/theme";
import { callLifecycle, workingLine } from "@/lib/callLifecycle.mjs";

const MONO = "var(--nx-font-mono)";

/** Same precision as the Feed card's levels: majors to cents, small caps to more places. */
export const fmtPx = (n: unknown) => {
  const v = Math.abs(Number(n) || 0);
  const dp = v >= 1 ? 2 : v >= 0.01 ? 4 : v >= 0.0001 ? 6 : 8;
  return (Number(n) || 0).toFixed(dp);
};

type Call = { status?: string; gradedOutcome?: string; fillState?: string; entryPrice: number; publishMark?: { px?: number } };

/** The status pill's text for a call with no position, or null when the card's own label applies. */
export function awaitingLabel(t: Call): string | null {
  const s = callLifecycle(t);
  if (s === "WORKING") return `Awaiting fill · $${fmtPx(t.entryPrice)}`;
  if (s === "UNCHECKED") return "Checking fill";
  return null;
}

export function AwaitingFill({ thesis, markPrice, style }: { thesis: Call; markPrice?: number | null; style?: React.CSSProperties }) {
  const state = callLifecycle(thesis);
  if (state !== "WORKING" && state !== "UNCHECKED") return null;
  const working = state === "WORKING";
  const hasMark = markPrice != null && Number(markPrice) > 0;
  return (
    <div style={{ border: `1px dashed ${C.borderStrong}`, borderRadius: 8, padding: "10px 12px", display: "grid", gap: 4, ...style }}>
      <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", color: C.text.bright }}>
        {working ? `AWAITING FILL AT $${fmtPx(thesis.entryPrice)}` : "FILL NOT CHECKED YET"}
      </div>
      {hasMark && (
        <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.text.fog, fontVariantNumeric: "tabular-nums" }}>
          Mark ${fmtPx(markPrice)} · {workingLine(thesis, markPrice)}
        </div>
      )}
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.text.muted, lineHeight: 1.5 }}>
        {working
          ? "No position yet, so no P&L. The call is graded from the hour price reaches the entry."
          : "The grader hasn’t checked whether the entry traded. It does every hour; until then, no P&L."}
      </div>
    </div>
  );
}
