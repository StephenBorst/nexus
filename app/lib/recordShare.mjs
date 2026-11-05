// The week's record as a post for X (/proof "Share this week's record"). Built only from GET /calls/pulse:
// people and our engines counted apart (never blended, borst 2026-11-05), the cleared read with its paper COUNT
// (never a paper P&L), and the method line. Counts only: no money number, no "proven", no hype. An unreadable
// pulse = null (no post), never zeros.
import { gradedText } from "./callPulse.mjs";

const validBlock = (b) => !!b && Number.isFinite(b.open) && Number.isFinite(b.gradedWeek);
const day = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** @returns {string|null} */
export function recordShareText(pulse, now = Date.now()) {
  if (!pulse || pulse.ok === false || !validBlock(pulse)) return null;
  const lines = [`The record · ${day(now)}.`, ""];
  lines.push(`People: ${pulse.open} open · ${gradedText(pulse, now)}.`);
  if (validBlock(pulse.engines)) lines.push(`Our engines: ${pulse.engines.open} open · ${gradedText(pulse.engines, now)}.`);
  const h = pulse.headline;
  const sg = h?.cleared && Array.isArray(pulse.signals) ? pulse.signals.find((x) => x && typeof x.axis === "string") : null;
  if (sg) {
    lines.push("");
    const paper = sg.paper && Number.isFinite(sg.paper.trades) ? ` On paper: ${sg.paper.trades} of ${sg.paper.target}. Nothing armed.` : "";
    lines.push(`${sg.axis} cleared the bar (${sg.trades} graded trades).${paper}`);
  }
  lines.push("", "Every call graded from public price. Losses stay up.");
  return lines.join("\n");
}

export const RECORD_SHARE_URL = "https://trade.nexustradinglabs.com/proof";
export const recordShareHref = (text) =>
  `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(RECORD_SHARE_URL)}`;
