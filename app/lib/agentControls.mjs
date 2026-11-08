// What the agent's stop buttons say, so the copy is true of what the server does (pure, tested).
//
// DEACTIVATE (DELETE /agent/:a) stops the agent and deletes its key; the server also forgets the
// position. A LIVE position stays open on Orderly and the agent stops managing it: its own stop,
// take-profit and trail go with it. What stays is whatever rests on the exchange: the backstop stop
// exec placed (nexus-agent-exec/backstop.mjs, 1.5× the stop distance, `position.backstop`), or a
// position stop the owner set (`backstop.foreign`), or nothing (DCA, or the placement was refused).
// KILL is the button that closes it first (killSwitch.mjs). Paper positions move no money.
// lab-api's DELETE reply uses deactivatedMessage too, so the two never disagree.

const coin = (symbol) => String(symbol || "").replace(/^PERP_/, "").replace(/_USDC$/, "");
const what = (position) => `${coin(position.symbol)} ${position.direction === "SHORT" ? "SHORT" : "LONG"}`.trim();

/** The stop that stays on Orderly after DEACTIVATE: { price, own } or null (none known). */
export function restingStop(position) {
  const bs = position?.backstop;
  const px = Number(bs?.trigger);
  if (!bs?.id || !(px > 0)) return null;
  return { price: px, own: bs.foreign === true };
}

const stopLine = (position) => {
  const s = restingStop(position);
  if (!s) return "with NO stop and NO take-profit";
  return s.own
    ? `with only the position stop you set, at $${s.price}`
    : `with only the exchange backstop stop, at $${s.price} (wider than the agent's own stop)`;
};

/** A confirm() prompt before DEACTIVATE, or null when there's nothing live to warn about. */
export function deactivateWarning(position) {
  if (!position || position.paper) return null;
  return `Your agent has a live ${what(position)} open.\n\nDEACTIVATE leaves it open on Orderly ${stopLine(position)}. The agent stops managing it: no take-profit, no trail.\n\nTo close it first, cancel and press KILL.\n\nDeactivate anyway?`;
}

/** The message after a successful DEACTIVATE. */
export function deactivatedMessage(position) {
  if (!position || position.paper) return "Agent deactivated. Trading key removed.";
  return `Agent deactivated. Your ${what(position)} is still open on Orderly ${stopLine(position)}. Manage or close it on the Trade page.`;
}
