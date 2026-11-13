// ── Signing a live plan with the owner's wallet (borst, 2026-11-14) ─────────────────────────────────────
// The 30-trade judgment's rule 8 (paper-judgment-level-reclaim.md, signed 2026-11-13): "PASS: a written live plan may be
// signed (its own PR). The house rules still bind: the $10 mechanics test first; arming and size are borst's, in person."
// Until now "signed" meant borst typing it under the page's Sign-off. Now the owner signs the sha256 of the page's text
// above "## Sign-off" with the owner wallet on /ops/revenue, the same flow as the judgment rules (paperJudgePage.mjs):
//   • licensed only once the read's 30-trade verdict is RECORDED as PASS (pjudge:{axis}); before that = refused;
//   • the signature covers the exact text as committed (livePlanText.mjs, generated from the page, test-pinned);
//   • once per page (a changed number is a new dated page, plan §6); stored in LAB_STORE, then appended under Sign-off
//     by the daily watcher (pipelineRecordsWrite.mjs), where anyone can recover the signer.
// A signature ARMS NOTHING. Arming stays its own PR, by borst, in person: GRADED_EXIT_LIVE_LIFT stays empty until then.
// Pure: no fetch, no KV.

import { ownerSign } from "./paperClaim.mjs";

export const LIVE_PLAN_SIGS_KEY = "pipeline:plansigs:v1"; // LAB_STORE: { [axis]: { [sha256]: signature record } }
export const SIGN_OFF = "\n## Sign-off";

/** The plans the pipeline knows, by read. A read without one gets "have Claude draft its live plan" in the digest. */
export const LIVE_PLANS = Object.freeze({
  level_reclaim: Object.freeze({ doc: "docs/research/live-plan-level-reclaim.md" }),
});

/** The text a signature covers: everything above "## Sign-off" (null = the page has no Sign-off heading). */
export function planAboveSignoff(page) {
  const cut = String(page || "").indexOf(SIGN_OFF);
  return cut > 0 ? page.slice(0, cut) : null;
}

/** The exact text the owner signs. ASCII only. */
export function livePlanSignMessage(address, axis, sha256, ts) {
  return "Nexus pipeline: SIGN a live plan\n"
    + `Read: ${axis}\nPlan sha256: ${sha256}\n`
    + "I agree with every number on this page. Signing arms nothing: arming is its own PR, in person.\n"
    + `Address: ${String(address).toLowerCase()}\nTimestamp: ${ts}\nTrades nothing. Moves no funds. Valid 5 minutes.`;
}

/**
 * Why the owner can't sign this plan now (null = may sign).
 * @param {{ axis, verdict: string|null, planSha: string|null, sha: string, signed: object|null }} p
 */
export function planSignRefusal({ axis, verdict, planSha, sha, signed }) {
  if (!LIVE_PLANS[axis] || !planSha) return { status: 404, error: "no_plan" };
  if (String(sha || "").toLowerCase() !== planSha) return { status: 409, error: "page_changed", sha256: planSha };
  if (verdict !== "PASS") return { status: 409, error: "not_licensed", detail: verdict ? `the 30-trade verdict is ${verdict}` : "no 30-trade verdict recorded yet" };
  if (signed) return { status: 409, error: "already_signed" };
  return null;
}

/** The line the watcher appends under Sign-off (one per signature, never edited). */
export function signedPlanLine(rec) {
  return `- ${String(rec.at).slice(0, 10)} · signed with the owner's wallet \`${rec.by}\` at ${rec.at}, after the 30-trade `
    + `verdict PASS. The signature covers the sha256 of the text above Sign-off, \`${rec.sha256}\`, in the message `
    + "`livePlanSignMessage` (`app/lib/livePlanSign.mjs`) builds:\n"
    + `  \`${rec.sig}\` (timestamp ${rec.sigTs}). Arms nothing.\n`;
}

/** Signed lines already under a page's Sign-off: [{ by, at, sha256, sig, sigTs }]. */
export function signedPlanLines(page) {
  const out = [];
  const re = /signed with the owner's wallet `(0x[0-9a-f]{40})` at (\S+), after[\s\S]*?above Sign-off, `([0-9a-f]{64})`[\s\S]*?`(0x[0-9a-fA-F]{130})` \(timestamp (\d+)\)/g;
  let m;
  while ((m = re.exec(String(page || "")))) out.push({ by: m[1], at: m[2].replace(/,$/, ""), sha256: m[3], sig: m[4], sigTs: Number(m[5]) });
  return out;
}

/** Browser: the owner signs a live plan page by its sha256 (the hash the server served with the page). */
export async function signLivePlan(addr, wallet, axis, sha256, opts = {}) {
  const s = await ownerSign(addr, wallet, (me, ts) => livePlanSignMessage(me, axis, sha256, ts), opts);
  return { ...s, sha256 };
}
