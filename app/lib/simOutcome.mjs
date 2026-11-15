// MiroShark sims (app/pages/lab/Simulate.tsx): every failed run says what happened to the credit (2026-11-15).
// Server rule (lab-api /wargame, payGuards.mjs): the credit is taken under a lock before our wallet pays MiroShark and
// comes back on ANY outcome short of a queued run. So:
//   - a reply that isn't "queued" = the credit was not used;
//   - no reply at all = we can't know whether it queued (re-read the credits);
//   - queued, then MiroShark reports a failure = the run was paid, so the credit was used.
// Pure, tested (simOutcome.test.mjs).

export const CREDIT_KEPT = "Your credit was not used.";
export const CREDIT_UNKNOWN = "No reply came back, so it may have started: your credit count below shows whether one was used.";
export const CREDIT_USED = "The run was paid and queued, so its credit was used.";

const plain = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // our own payment to MiroShark was refused (facilitator detail is for the logs, not the card)
  if (/^run rejected \(\d+\)/.test(s)) return "MiroShark didn't accept the run";
  if (/^simulation error:/.test(s)) return "The simulation service errored";
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const stop = (s) => s.replace(/[.\s]*$/, ".");

/** The server answered without queuing the run. */
export function notQueuedText(error) {
  return `${stop(plain(error) || "The simulation didn't start")} ${CREDIT_KEPT}`;
}

/** The request never got an answer. */
export function noReplyText() {
  return `The simulation request failed. ${CREDIT_UNKNOWN}`;
}

/** Queued, then the run failed on MiroShark's side. */
export function runFailedText(error) {
  return `${stop(plain(error) ? `MiroShark reported the run failed: ${String(error).trim()}` : "MiroShark reported the run failed")} ${CREDIT_USED}`;
}
