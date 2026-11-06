// What the agent's stop buttons say, so the copy is true of what the server does (pure, tested).
//
// DEACTIVATE (DELETE /agent/:a) stops the agent and deletes its key; the server also forgets the
// position. A LIVE position stays open on Orderly with NO stop and NO take-profit (exec manages exits;
// there are no exchange-side orders). KILL is the button that closes it first (killSwitch.mjs).
// Paper positions move no money, so they need no warning.

const coin = (symbol) => String(symbol || "").replace(/^PERP_/, "").replace(/_USDC$/, "");

/** A confirm() prompt before DEACTIVATE, or null when there's nothing live to warn about. */
export function deactivateWarning(position) {
  if (!position || position.paper) return null;
  const what = `${coin(position.symbol)} ${position.direction === "SHORT" ? "SHORT" : "LONG"}`.trim();
  return `Your agent has a live ${what} open.\n\nDEACTIVATE leaves it open on Orderly with NO stop and NO take-profit. The agent stops managing it.\n\nTo close it first, cancel and press KILL.\n\nDeactivate anyway?`;
}

/** The message after a successful DEACTIVATE. */
export function deactivatedMessage(position) {
  if (!position || position.paper) return "Agent deactivated. Trading key removed.";
  return `Agent deactivated. Your ${coin(position.symbol)} ${position.direction === "SHORT" ? "SHORT" : "LONG"} is still open on Orderly with no stop. Manage or close it on the Trade page.`;
}
