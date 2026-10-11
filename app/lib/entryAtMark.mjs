// ── "The market at the post" — one band, shared by the grader and every page that explains it ──
// When a call is first published the server reads Orderly's mark for that market and locks it on
// the call (`publishMark`, workers/nexus-lab-api/publishMark.mjs). The grader (logic.mjs gradeCall)
// fills a call at the post only if its entry sits within ENTRY_AT_MARK_PCT of that mark; any other
// entry is a resting order that counts once price trades it. The call page prints the same rule,
// so a reader can check the grade without trusting us. Tested in entryAtMark.test.mjs.

/** How far (%) an entry may sit from the mark read at publish and still count as the market. */
export const ENTRY_AT_MARK_PCT = 0.3;

/** True when `entry` is within the band around `mark`. */
export const atMark = (entry, mark) => Math.abs(entry - mark) / mark <= ENTRY_AT_MARK_PCT / 100;

const fmtPx = (n) => (n >= 1 ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Number(n.toPrecision(4)).toString());

/**
 * What the call page says about a call's locked price, or null when the call has none (published
 * before 2026-10-11, or the read failed): those are graded by the posting hour's range instead.
 * @param {{ entryPrice?: number, publishMark?: { px?: number } }} t
 * @returns {{ markText: string, line: string, atMarket: boolean, offPct: number } | null}
 */
export function publishMarkLine(t) {
  const mark = Number(t?.publishMark?.px), entry = Number(t?.entryPrice);
  if (!(mark > 0) || !Number.isFinite(mark) || !(entry > 0)) return null;
  const offPct = Math.round(((entry - mark) / mark) * 10000) / 100;
  const at = atMark(entry, mark);
  const line = at
    ? `Entry within ${ENTRY_AT_MARK_PCT}% of it: filled when posted.`
    : `Entry ${Math.abs(offPct)}% ${offPct < 0 ? "below" : "above"} it: counts once price trades there.`;
  return { markText: `$${fmtPx(mark)}`, line, atMarket: at, offPct };
}
