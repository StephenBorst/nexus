import test from "node:test";
import assert from "node:assert/strict";
import { callShareText } from "./callShare.mjs";

const plan = { direction: "LONG", leverage: 5, entryPrice: 100, stopLoss: 95, takeProfit1: 110, riskReward: 9.99 };

test("an open call shares the plan with R:R from the levels, never the stored riskReward", () => {
  const s = callShareText(plan, "ETH");
  assert.ok(s.startsWith("ETH LONG 5.0x."));
  assert.ok(s.includes("R:R 1:2.00"));
  assert.ok(!s.includes("9.99"));
});

test("a graded call leads with the grader's result", () => {
  assert.ok(callShareText({ ...plan, gradedOutcome: "WIN", gradedR: 1.5 }, "ETH").startsWith("ETH LONG. Graded WIN +1.50R."));
  assert.ok(callShareText({ ...plan, gradedOutcome: "LOSS", gradedR: -1 }, "ETH").startsWith("ETH LONG. Graded LOSS -1.00R."));
  assert.ok(callShareText({ ...plan, gradedOutcome: "LOSS" }, "ETH").startsWith("ETH LONG. Graded LOSS."));
});

test("missing numbers print a dash instead of crashing", () => {
  const s = callShareText({ direction: "SHORT" }, "SOL");
  assert.ok(s.startsWith("SOL SHORT —x."));
  assert.ok(s.includes("Entry $—. Stop $—. TP $—. R:R —."));
});
