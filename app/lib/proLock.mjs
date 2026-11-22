// What a PRO-locked click says, right where it happened (borst 2026-11-22: the PRO presets and strategy buttons "silently
// do nothing"). Pure, tested (proLock.test.mjs). The server refuses the same configs anyway (402 pro_strategy_locked):
// this only makes the refusal visible before Save, with the two ways in. Numbers come from the caller (the
// subscription config + tier thresholds), never typed here. No promise: PRO is a software subscription.

/**
 * @param {{ name: string, loading?: boolean, holderMin: number, holderTier: string, usdc: number, nexusPrice: number }} p
 * @returns {{ title: string, body: string, checking: boolean }}
 */
export function proLockCopy({ name, loading = false, holderMin, holderTier, usdc, nexusPrice }) {
  const what = String(name || "This strategy");
  if (loading) return { title: `Checking your PRO status…`, body: `${what} is a PRO strategy. Try again in a moment.`, checking: true };
  const tier = String(holderTier || "").charAt(0) + String(holderTier || "").slice(1).toLowerCase();
  return {
    title: `${what} needs PRO`,
    body: `Your wallet isn’t PRO yet, so it wasn’t loaded. Two ways in: hold ${Number(holderMin).toLocaleString("en-US")} $NEXUS (${tier}) on Base, or subscribe for $${usdc}/month in USDC ($${nexusPrice} paid in $NEXUS).`,
    checking: false,
  };
}
