// The pre-registered Oct-15 hold rule. Run: node --test tools/oct15/holdDecision.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { decideHold, paperArm, RULES, CLEAN_START_MS } from "./holdDecision.mjs";

const after = new Date(CLEAN_START_MS + 3600e3).toISOString();
const arm = (trades, net) => paperArm({ trades, net, firstTradeAt: after });
const oos = (samples, netBps) => ({ samples, netBps });

test("a freshly reset wallet (no aggregate) is a usable 0-trade record", () => {
  assert.deepEqual({ ...paperArm(null) }, { usable: true, why: null, trades: 0, net: 0, perTrade: null });
});

test("a record older than the clean start is refused, not averaged in", () => {
  const p = paperArm({ trades: 9, net: 20, firstTradeAt: "2026-09-25T10:00:00Z" });
  assert.equal(p.usable, false);
  assert.match(p.why, /before the clean start/);
});

test("today's thin sample → INSUFFICIENT, keep 12h (the Sept-26 numbers)", () => {
  const r = decideHold({ oos12: oos(2, -178), oos24: oos(2, -163), paper12: paperArm(null), paper24: paperArm(null) });
  assert.equal(r.decision, "INSUFFICIENT");
  assert.match(r.action, /Keep 12h/);
});

test("in-sample strength can't decide it: a great in-sample 24h with thin out-of-sample stays INSUFFICIENT", () => {
  const r = decideHold({ oos12: oos(9, -50), oos24: oos(9, 200), paper12: arm(20, 10), paper24: arm(20, 90) });
  assert.equal(r.decision, "INSUFFICIENT");
});

test("SWITCH_TO_24H only when BOTH independent reads favour 24h and the gap clears the bar", () => {
  const r = decideHold({ oos12: oos(12, 5), oos24: oos(12, 5 + RULES.minEdgeBps), paper12: arm(8, 4), paper24: arm(8, 12) });
  assert.equal(r.decision, "SWITCH_TO_24H");
});

test("a gap inside the bar, or reads that disagree, keep the control", () => {
  assert.equal(decideHold({ oos12: oos(12, 5), oos24: oos(12, 5 + RULES.minEdgeBps - 1), paper12: arm(8, 4), paper24: arm(8, 40) }).decision, "KEEP_12H");
  const split = decideHold({ oos12: oos(12, 0), oos24: oos(12, 50), paper12: arm(8, 40), paper24: arm(8, 4) });
  assert.equal(split.decision, "KEEP_12H");
  assert.match(split.action, /disagree/);
});

test("both reads favouring 12h keep 12h", () => {
  assert.equal(decideHold({ oos12: oos(12, 40), oos24: oos(12, 0), paper12: arm(8, 30), paper24: arm(8, 5) }).decision, "KEEP_12H");
});
