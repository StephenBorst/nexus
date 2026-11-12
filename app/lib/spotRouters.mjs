// ── The EVM contracts an in-app swap may approve and call (pure; tests: spotRouters.test.mjs) ───────
// spanDEX's providers (Nordstern, 0x) name the approve target (spender) and the swap target (tx.to)
// in each quote. The signer approves the EXACT input amount, so a hostile or compromised provider
// could at worst take one trade's input, but only if it names an address of its own. Pinning closes
// that: a quote counts only when spender == tx.to == a router listed here for that chain. The worker
// drops unpinned quotes (so the next best pinned one wins) and the signer refuses one before any
// approve (swapExec.ts). One list, both users.
//
// Every address was read from live quotes through /swap/quote (taker 0xd9f7…b449; borst + a session,
// 2026-11-12): Nordstern answers 1+ USDC → WETH, 0x answered dust sizes Nordstern refused. A chain or
// provider not listed has no in-app route (the deep link stays). A provider moving its router shows
// up as "no in-app route" until the new address is checked and added here.
export const ZEROX_ALLOWANCE_HOLDER = "0x0000000000001ff3684f28c67538d4d072c22734";

export const SPOT_ROUTERS = Object.freeze({
  1:     Object.freeze(["0xa929c559e5e6537359680f39cb4e3708e1a14dd1", ZEROX_ALLOWANCE_HOLDER]), // Ethereum
  8453:  Object.freeze(["0xc87de04e2ec1f4282dff2933a2d58199f688fc3d", ZEROX_ALLOWANCE_HOLDER]), // Base
  42161: Object.freeze(["0x57f96440f1b1cad53b40a8924bd540b1279a491c", ZEROX_ALLOWANCE_HOLDER]), // Arbitrum
  10:    Object.freeze(["0xa575f37e869e6887564f87c07e2885e08d542c4a"]),                        // Optimism (0x not seen live)
  137:   Object.freeze(["0x99ba7d569ea69671b399a7cc488b687515f7ec23", ZEROX_ALLOWANCE_HOLDER]), // Polygon
  // 4663 Robinhood Chain: no router read live yet → no in-app route there.
});

const lc = (a) => (typeof a === "string" ? a.toLowerCase() : "");

/** True only when the quote's approve target and swap target are the same listed router for this chain. */
export function pinnedRouter(chainId, spender, to) {
  const list = SPOT_ROUTERS[Number(chainId)];
  if (!list) return false;
  const s = lc(spender);
  return s !== "" && s === lc(to) && list.includes(s);
}
