// The "Other chains" tab we add to Orderly's own Deposit / Withdraw window (an Orderly plugin
// interceptor on "Transfer.DepositAndWithdraw", app/components/orderlyProvider/xcDepositPlugin.tsx).
// Pure: merge our tab into whatever extraTabs the window already has, once, keeping theirs.
export const XC_FUND_TAB_ID = "nexus-other-chains";
export const XC_FUND_INTERCEPT_TARGET = "Transfer.DepositAndWithdraw";
export function withFundTab(extraTabs, tab) {
  const theirs = Array.isArray(extraTabs) ? extraTabs.filter((t) => t && t.id !== XC_FUND_TAB_ID) : [];
  return [...theirs, { ...tab, id: XC_FUND_TAB_ID }];
}
