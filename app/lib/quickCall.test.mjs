// app/lib/quickCall.mjs. Run: node --test app/lib/quickCall.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callReady, callFromForm, liveOrderReady } from "./quickCall.mjs";

const form = { symbol: "ETH", direction: "LONG", entryPrice: "3104.25", stopLoss: "3042.16", takeProfit1: "3228.42", takeProfit2: "", splitExit: false, accountSize: "" };

test("a call posts on its levels alone: no account size needed", () => {
  const r = callReady(form);
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
  assert.equal(r.rr, 2);
});

test("each missing piece names itself, in order", () => {
  assert.equal(callReady({ ...form, symbol: " " }).reason, "Pick a coin.");
  assert.equal(callReady(form, { listed: false }).reason, "Pick a listed market so it can be graded.");
  assert.equal(callReady(form, { dirArmed: false }).reason, "Pick a side.");
  assert.equal(callReady({ ...form, stopLoss: "" }).reason, "Can’t be graded: entry, stop or target missing.");
  assert.equal(callReady({ ...form, stopLoss: "3200" }).reason, "Can’t be graded: stop or target on the wrong side of entry.");
  assert.equal(callReady({ ...form, takeProfit2: "3100", splitExit: true }).reason, "Can’t be graded: split exit with TP2 not beyond TP1.");
});

test("the form reads as the grader reads it (split declared only with a TP2)", () => {
  assert.equal(callFromForm({ ...form, splitExit: true }).exitPlan, undefined);
  assert.equal(callFromForm({ ...form, splitExit: true, takeProfit2: "3300" }).exitPlan, "SPLIT_50");
  assert.equal(callFromForm({ ...form, direction: "SHORT" }).direction, "SHORT");
});

test("a live order still needs a real size", () => {
  assert.equal(liveOrderReady(callReady(form), 0), false);
  assert.equal(liveOrderReady(callReady(form), NaN), false);
  assert.equal(liveOrderReady(callReady(form), 2500), true);
  assert.equal(liveOrderReady(callReady({ ...form, stopLoss: "" }), 2500), false);
});

test("the Thesis Engine posts on callReady and sizes only the live order", () => {
  const src = readFileSync(new URL("../pages/lab/ThesisView.tsx", import.meta.url), "utf8");
  assert.match(src, /const formValid = ready\.ok/);
  assert.match(src, /const liveValid = liveOrderReady\(ready, calc\?\.positionSize/);
  assert.match(src, /const deployLive = async \(\) => \{\s*if \(!liveValid \|\| !calc\) return;/);
  assert.doesNotMatch(src, /calc!\./, "a call without a size must still save");
});

test("exit plan + order expiry from the form (2026-11-16)", async () => {
  const { exitPlanFromForm, fillWindowFromForm, exitPlanLine } = await import("./quickCall.mjs");
  assert.equal(exitPlanFromForm({ ...form, exitMode: "BE" }), "SPLIT_50_BE", "a runner needs no TP2");
  assert.equal(exitPlanFromForm({ ...form, exitMode: "SPLIT" }), undefined, "a split needs a TP2");
  assert.equal(exitPlanFromForm({ ...form, exitMode: "SPLIT", takeProfit2: "3300" }), "SPLIT_50");
  assert.equal(exitPlanFromForm({ ...form, exitMode: "SINGLE", splitExit: true, takeProfit2: "3300" }), undefined, "the picker wins over the old flag");
  assert.equal(fillWindowFromForm({ fillWithinH: "12" }), 12);
  assert.equal(fillWindowFromForm({ fillWithinH: "" }), undefined);
  const c = callFromForm({ ...form, exitMode: "BE", fillWithinH: "12" });
  assert.deepEqual([c.exitPlan, c.fillWithinH], ["SPLIT_50_BE", 12]);
  assert.match(callReady({ ...form, exitMode: "BE", takeProfit2: "3200" }).reason, /TP2 must sit beyond TP1/);
  assert.equal(callReady({ ...form, exitMode: "BE", fillWithinH: "12" }).ok, true);
  assert.match(exitPlanLine({ ...form, exitMode: "BE" }), /trails 1R behind the best 1-minute close\. After TP1 it can't close as a loss\.$/);
  assert.doesNotMatch([exitPlanLine({ exitMode: "BE" }), exitPlanLine({ exitMode: "SPLIT" }), exitPlanLine({})].join(" "), /edge|proven|guarantee|profit/i);
});
