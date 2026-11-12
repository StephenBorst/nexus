// The text a caller shares on X for their own public call (ThesisView's 𝕏 SHARE). Graded → lead with the
// result the grader stamped, same words as the call page (pages/thesis); still open → the plan, with R:R
// read from the LEVELS (callRR), never the stored `riskReward` (CLAUDE.md: cards read R:R from the levels).
// A field that isn't a number prints "—", so an old/partial call can't crash the card.
import { callRR, fmtRR } from "./callMath.mjs";

const num = (v, dp) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(dp) : "—");

export function callShareText(t, ticker) {
  const tk = String(ticker || "");
  const dir = String(t?.direction || "");
  if (t?.gradedOutcome === "WIN" || t?.gradedOutcome === "LOSS") {
    const r = typeof t.gradedR === "number" && Number.isFinite(t.gradedR) ? ` ${t.gradedR >= 0 ? "+" : ""}${t.gradedR.toFixed(2)}R` : "";
    return `${tk} ${dir}. Graded ${t.gradedOutcome}${r}.\n\nFirst touch vs public price. The tape marked it, not me.\n\nGraded on Nexus Trading Labs.`;
  }
  return `${tk} ${dir} ${num(t?.leverage, 1)}x.\n\nEntry $${num(t?.entryPrice, 2)}. Stop $${num(t?.stopLoss, 2)}. TP $${num(t?.takeProfit1, 2)}. R:R ${fmtRR(callRR(t))}.\n\nGraded against public price on Nexus Trading Labs.`;
}

/** The share links for one public call: the OG page X unfurls into the call's card (`url`) and the X intent
 *  carrying callShareText (`xUrl`). One builder for the call card's 𝕏 SHARE and the post-publish prompt. */
export function callShareLinks(wallet, t, ticker) {
  const url = `https://og.nexustradinglabs.com/share/thesis/${String(wallet || "").toLowerCase()}/${encodeURIComponent(String(t?.id || ""))}`;
  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(callShareText(t, ticker))}&url=${encodeURIComponent(url)}`;
  return { url, xUrl };
}
