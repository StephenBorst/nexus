// ── Arena operators: one board slot per operator, every wallet counted ─────────────────────────
// An operator who runs several Arena wallets gets ONE slot, and that slot's record is the sum of
// every wallet in the group, losers included. Without this, one person can run ten wallets and let
// the board show only the one that happened to win.
//
// A group is DECLARED, never detected: we don't guess common ownership from funding or timing.
// A wallet joins an operator only when BOTH wallets sign the same text (operatorJoinMessage):
//   - the operator's signature stops a losing wallet from attaching itself to someone else's slot;
//   - the wallet's signature stops an operator from absorbing (and hiding) a wallet it doesn't run.
// Joining is permanent. There is no leave: if an operator could drop a wallet, it would drop the
// losers and the slot would show only survivors again.
//
// Stored as one map, KV `arena:operators` = { [operator]: { wallets: [member, ...], joined: { [member]: ms } } }.
// The operator is the slot's first wallet and is not listed in its own `wallets`.

export const OPERATOR_MAX_WALLETS = 25; // members per operator, not counting the operator

const isAddr = (a) => typeof a === "string" && /^0x[0-9a-f]{40}$/.test(a);

/** The exact text both wallets sign (EIP-191 personal_sign). Addresses lowercase. */
export function operatorJoinMessage(operator, wallet) {
  return [
    "Nexus Arena operator link v1",
    `operator: ${String(operator).toLowerCase()}`,
    `wallet: ${String(wallet).toLowerCase()}`,
    "Both wallets sign this. The wallet's paper and live record counts in the operator's one board slot.",
    "Permanent. It cannot be undone.",
  ].join("\n");
}

/** The operator a wallet belongs to (itself if it runs a group), or null if ungrouped. */
export function operatorOf(groups, wallet) {
  const w = String(wallet).toLowerCase();
  if (groups?.[w]?.wallets?.length) return w;
  for (const [op, g] of Object.entries(groups || {})) {
    if ((g?.wallets || []).includes(w)) return op;
  }
  return null;
}

/** Every wallet in an operator's slot: the operator first, then its members in join order. */
export function groupWallets(groups, operator) {
  const op = String(operator).toLowerCase();
  return [op, ...((groups?.[op]?.wallets) || [])];
}

/**
 * Decide a join. Pure. `groups` is the stored map (may be null).
 * @returns {{ ok: true, already: boolean, next: object|null } | { ok: false, error: string }}
 *   next = the map to store (null when nothing changes).
 */
export function planJoin(groups, operator, wallet, now = Date.now()) {
  const op = String(operator || "").toLowerCase();
  const w = String(wallet || "").toLowerCase();
  if (!isAddr(op) || !isAddr(w)) return { ok: false, error: "bad_address" };
  if (op === w) return { ok: false, error: "same_wallet" };
  const g = groups || {};

  const wOp = operatorOf(g, w);
  if (wOp === op) return { ok: true, already: true, next: null };
  if (wOp && wOp === w) return { ok: false, error: "wallet_is_operator" };
  if (wOp) return { ok: false, error: "wallet_in_other_group" };

  const opOf = operatorOf(g, op);
  if (opOf && opOf !== op) return { ok: false, error: "operator_is_member" };

  const members = g[op]?.wallets || [];
  if (members.length >= OPERATOR_MAX_WALLETS) return { ok: false, error: "group_full" };

  const next = { ...g, [op]: {
    wallets: [...members, w],
    joined: { ...(g[op]?.joined || {}), [w]: now },
  } };
  return { ok: true, already: false, next };
}

export const JOIN_ERRORS = {
  bad_address: "operator and wallet must both be 0x addresses.",
  same_wallet: "The operator is already in its own slot.",
  wallet_is_operator: "This wallet runs its own group. Groups don't nest.",
  wallet_in_other_group: "This wallet already counts toward another operator. Joining is permanent.",
  operator_is_member: "The operator wallet is a member of another group. Use that group's operator.",
  group_full: `An operator slot holds at most ${OPERATOR_MAX_WALLETS + 1} wallets.`,
};
