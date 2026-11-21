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

test("the drawer and the market table ask for the side and hand off through ONE shared draft contract", () => {
  const handoff = readFileSync(new URL("./callHandoff.ts", import.meta.url), "utf8");
  assert.match(handoff, /marketCallDraft\(coin, side, source\)/);
  assert.match(handoff, /new CustomEvent\("nexus:thesis-draft"\)/);
  const drawer = readFileSync(new URL("../components/MarketDrawer.tsx", import.meta.url), "utf8");
  const table = readFileSync(new URL("../pages/lab/MarketTable.tsx", import.meta.url), "utf8");
  assert.match(drawer, /handOffCall\(coin, side, navigate, "market-drawer"\)/);
  assert.match(table, /handOffCall\(r\.coin, side, navigate, "market-table"\)/);
  for (const src of [handoff, drawer, table]) assert.doesNotMatch(src, /From the \$\{coin\} market drawer/, "no machine-written note in the trader's call");
});

test("a draft records where the tap came from; it never picks a side", () => {
  assert.equal(marketCallDraft("SOL", "LONG", "market-table").source, "market-table");
  assert.equal(marketCallDraft("SOL", "LONG").source, "market-drawer");
  assert.equal(marketCallDraft("SOL", "LONG", "anything").source, "market-drawer");
  assert.equal(marketCallDraft("SOL", undefined, "market-table"), null);
});

test("the Thesis Engine keeps a chosen side and builds on arrival", () => {
  const src = readFileSync(new URL("../pages/lab/ThesisView.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(d\.sideChosen\)/);
  assert.match(src, /pendingDraft\.current/);
});
