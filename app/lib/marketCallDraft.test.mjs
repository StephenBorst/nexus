// app/lib/marketCallDraft.mjs. Run: node --test app/lib/marketCallDraft.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { marketCallDraft } from "./marketCallDraft.mjs";

test("a drawer draft carries the coin and the side the trader tapped, and clears the last coin's levels", () => {
  const d = marketCallDraft("PERP_ETH_USDC", "SHORT");
  assert.equal(d.symbol, "ETH");
  assert.equal(d.direction, "SHORT");
  for (const k of ["entryPrice", "stopLoss", "takeProfit1", "notes", "catalyst", "targetWindow"]) assert.equal(d[k], "", k);
  assert.equal(d.sideChosen, true);
  assert.equal(d.build, true);
});

test("no side, no draft: the drawer never picks one", () => {
  assert.equal(marketCallDraft("ETH"), null);
  assert.equal(marketCallDraft("ETH", "UP"), null);
  assert.equal(marketCallDraft("../x", "LONG"), null);
});

test("the drawer asks for the side and hands off through the shared draft contract", () => {
  const src = readFileSync(new URL("../components/MarketDrawer.tsx", import.meta.url), "utf8");
  assert.match(src, /marketCallDraft\(coin, side\)/);
  assert.match(src, /new CustomEvent\("nexus:thesis-draft"\)/);
  assert.doesNotMatch(src, /From the \$\{coin\} market drawer/, "no machine-written note in the trader's call");
});

test("the Thesis Engine keeps a chosen side and builds on arrival", () => {
  const src = readFileSync(new URL("../pages/lab/ThesisView.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(d\.sideChosen\)/);
  assert.match(src, /pendingDraft\.current/);
});
