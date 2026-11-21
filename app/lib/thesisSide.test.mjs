// The Thesis Engine starts with NO side chosen (borst 2026-11-21). A side is committed only by the trader's tap
// (Quick Call or Fine-tune) or a draft whose side they already picked (`sideChosen`). Nothing arms one by itself.
// Run: node --test app/lib/thesisSide.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callReady } from "./quickCall.mjs";

const src = readFileSync(new URL("../pages/lab/ThesisView.tsx", import.meta.url), "utf8");

test("no side until the trader picks one", () => {
  assert.match(src, /const \[dirArmed, setDirArmed\] = useState\(false\)/, "the form starts unarmed");
  assert.doesNotMatch(src, /setDirArmed\(true\); setWeakSetup/, "a new coin never re-arms a side");
  assert.doesNotMatch(src, /setDirArmed\(!w\.weak\)/, "the WATCH gate only un-arms, never arms");
  // Both side pickers commit through the one helper.
  assert.equal((src.match(/onClick=\{\(\) => \{ pickSide\(d\)|onClick=\{\(\) => pickSide\(d\)\}/g) || []).length, 2);
  // A suggestion is outlined, never shown as the committed side.
  assert.match(src, /const suggested = !dirArmed && suggestedDir === d/);
});

test("a call can't post without a committed side", () => {
  const form = { symbol: "ETH", direction: "LONG", entryPrice: "100", stopLoss: "98", takeProfit1: "103" };
  assert.deepEqual([callReady(form, { dirArmed: false }).ok, callReady(form, { dirArmed: false }).reason], [false, "Pick a side."]);
  assert.equal(callReady(form, { dirArmed: true }).ok, true);
});
