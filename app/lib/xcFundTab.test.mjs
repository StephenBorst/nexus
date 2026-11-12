import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withFundTab, XC_FUND_TAB_ID, XC_FUND_INTERCEPT_TARGET } from "./xcFundTab.mjs";

test("withFundTab: adds our tab once, keeps every other tab, never duplicates on re-render", () => {
  const ours = { title: "Other chains", component: () => null, order: 90 };
  assert.deepEqual(withFundTab(undefined, ours).map((t) => t.id), [XC_FUND_TAB_ID]);
  const theirs = [{ id: "partner", title: "Partner" }];
  const once = withFundTab(theirs, ours);
  assert.deepEqual(once.map((t) => t.id), ["partner", XC_FUND_TAB_ID]);
  assert.deepEqual(withFundTab(once, ours).map((t) => t.id), ["partner", XC_FUND_TAB_ID]);
  assert.deepEqual(withFundTab([null, ...theirs], ours).map((t) => t.id), ["partner", XC_FUND_TAB_ID]);
});

test("the target is the SDK's injectable id for the Deposit / Withdraw window, and the provider registers the plugin", () => {
  // @orderly.network/ui-transfer@3.1.12: injectable(DepositAndWithdraw, "Transfer.DepositAndWithdraw")
  assert.equal(XC_FUND_INTERCEPT_TARGET, "Transfer.DepositAndWithdraw");
  const provider = readFileSync(new URL("../components/orderlyProvider/index.tsx", import.meta.url), "utf8");
  assert.match(provider, /plugins=\{XC_PLUGINS\}/);
  const plugin = readFileSync(new URL("../components/orderlyProvider/xcDepositPlugin.tsx", import.meta.url), "utf8");
  assert.match(plugin, /target: XC_FUND_INTERCEPT_TARGET/);
  assert.match(plugin, /navigate\("\/token", \{ state: \{ xcFund: true \} \}\)/);
});
