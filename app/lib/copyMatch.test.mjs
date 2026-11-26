// Your copy beside the call you copied (copyMatch.mjs). Run: node --test app/lib/copyMatch.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findOriginal, originalState, planDrift, driftLine, copyTiming, originalsLine } from "./copyMatch.mjs";

const H = 3600_000;
const T0 = Date.parse("2026-11-24T10:00:00Z");
const orig = { id: "t1", symbol: "PERP_BTC_USDC", direction: "LONG", entryPrice: 60000, stopLoss: 59000, takeProfit1: 61500, createdAt: T0, filledAt: T0 + H };
const copy = { id: "copy_1", symbol: "PERP_BTC_USDC", direction: "LONG", entryPrice: 60000, stopLoss: 59000, takeProfit1: 61500, createdAt: T0 + 3 * H, copiedFromWallet: "0xabc" };

test("the original: by the saved id first, else the same coin, side, entry and stop posted before the copy", () => {
  const other = { ...orig, id: "t0", createdAt: T0 - 48 * H, entryPrice: 58000 };
  assert.equal(findOriginal({ ...copy, copiedFromId: "t1" }, [other, orig]).id, "t1");
  assert.equal(findOriginal(copy, [other, orig]).id, "t1", "older copies match on levels");
  assert.equal(findOriginal({ ...copy, createdAt: T0 - H }, [orig]), null, "never a call posted after the copy");
  assert.equal(findOriginal(copy, [{ ...orig, duplicateOf: "x" }]), null);
  assert.equal(findOriginal(copy, []), null);
});

test("the original's state, in the grader's words; a private copy never gets its own grade, so this is the truth", () => {
  assert.deepEqual(originalState({ ...orig, gradedOutcome: "WIN", gradedR: 1.5 }), { kind: "WON", r: 1.5, line: "The original won +1.50R." });
  assert.equal(originalState({ ...orig, gradedOutcome: "LOSS", gradedR: -1 }).line, "The original lost −1.00R at its stop.");
  assert.equal(originalState({ ...orig, gradedOutcome: "LOSS", gradedR: -0.4, exitReason: "TIME" }).kind, "TIME");
  assert.equal(originalState({ ...orig, fillState: "EXPIRED", filledAt: undefined }).kind, "EXPIRED");
  assert.equal(originalState({ ...orig, fillState: "OPEN" }).kind, "OPEN");
  assert.equal(originalState({ ...orig, filledAt: undefined }).kind, "WAITING");
  assert.equal(originalState({ ...orig, status: "INVALIDATED" }).kind, "INVALID");
  assert.equal(originalState(null).kind, "MISSING");
});

test("what you changed from the caller's plan", () => {
  assert.deepEqual(planDrift(copy, orig), []);
  assert.equal(driftLine([]), "Same plan as the original.");
  const d = planDrift({ ...copy, stopLoss: 58500, exitPlan: "SPLIT_50" }, orig);
  assert.deepEqual(d.map((x) => x.field), ["stop", "exit plan"]);
  assert.equal(driftLine(d), "You changed the stop (59,000 → 58,500), the exit plan (one target → half at each target). The original’s grade is the caller’s plan, not yours.");
});

test("timing: how long after the post, and whether its entry had already traded", () => {
  assert.equal(copyTiming(copy, orig), "Copied 3h after the post, after its entry had traded (the market had moved on from the post).");
  assert.equal(copyTiming({ ...copy, createdAt: T0 + 20 * 60_000 }, orig), "Copied 20m after the post.");
  assert.equal(copyTiming({ ...copy, createdAt: T0 - 1 }, orig), null);
});

test("the originals, counted, with R only on the graded ones", () => {
  assert.equal(originalsLine([{ kind: "WON", r: 1.5 }, { kind: "STOPPED", r: -1 }, { kind: "OPEN", r: null }]),
    "Their originals: 1 won · 1 stopped · 1 open (+0.50R on the 2 graded).");
  assert.equal(originalsLine([{ kind: "WAITING", r: null }]), "Their originals: 1 waiting for entry.");
  assert.equal(originalsLine([]), null);
});

test("both copy modals save the original's id on the copy", () => {
  for (const f of ["../pages/feed/index.tsx", "../pages/trader/index.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /copiedFromId: thesis\.id/, f);
  }
  const types = readFileSync(new URL("../pages/lab/types.ts", import.meta.url), "utf8");
  assert.match(types, /copiedFromId\?: string/);
  const view = readFileSync(new URL("../pages/lab/CopiesView.tsx", import.meta.url), "utf8");
  assert.match(view, /findOriginal\(/);
  assert.match(view, /driftLine\(/);
  assert.doesNotMatch(view, /mineLine\(/, "the old 'N open' line counted ungraded private copies as open forever");
});
