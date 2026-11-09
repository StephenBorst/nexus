// ── Who may call the carry engine's POST ops routes (pure; tests: carryAuth.test.mjs) ───────────
// /carry/tick, /carry/reset, /carry/live/tick, /carry/kill, /carry/unkill need the header
// `x-carry-token` equal to the worker secret CARRY_ADMIN_TOKEN. FAIL CLOSED: no secret set (or a
// short one) = nobody is let in. The old rule (`!need || header === need`) let EVERYONE in while the
// secret was missing, so anyone could wipe the public paper record /proof shows (/carry/reset), force
// extra rebalances, or lift a kill. Set it once: `npx wrangler secret put CARRY_ADMIN_TOKEN` in this dir.
export const CARRY_TOKEN_MIN = 16;

/** True only when a token is configured (≥ CARRY_TOKEN_MIN chars) and the header matches it exactly. */
export function carryAdminOk(header, token) {
  const need = typeof token === "string" ? token : "";
  const got = typeof header === "string" ? header : "";
  if (need.length < CARRY_TOKEN_MIN || got.length !== need.length) return false;
  let diff = 0; // compare every char (no early exit on the first mismatch)
  for (let i = 0; i < need.length; i++) diff |= need.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
