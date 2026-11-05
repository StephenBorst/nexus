import test from "node:test";
import assert from "node:assert/strict";
import { callPulse, pulseLine, agoShort, PULSE_WINDOW_MS } from "./callPulse.mjs";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const H = 3600000, D = 86400000;
const base = { isPublic: true, symbol: "PERP_ETH_USDC", direction: "LONG", entryPrice: 100, stopLoss: 95, takeProfit1: 110 };

test("counts OPEN calls and this week's graded calls; resting orders and invalid calls count nowhere", () => {
  const p = callPulse([{ wallet: "0xA", theses: [
    { ...base, id: "1", fillState: "OPEN" },
    { ...base, id: "2", fillState: "WORKING" },                                   // never filled: not a position
    { ...base, id: "3", stopLoss: 120, fillState: "OPEN" },                        // wrong-side stop: INVALID
    { ...base, id: "4", gradedOutcome: "WIN", gradedR: 2, exitedAt: NOW - 2 * D },
    { ...base, id: "5", gradedOutcome: "LOSS", gradedR: -1, exitedAt: NOW - 8 * D }, // last week
  ] }], NOW);
  assert.equal(p.open, 1);
  assert.equal(p.gradedWeek, 1);
  assert.equal(p.last.outcome, "WIN");
  assert.equal(p.last.symbol, "ETH");
  assert.equal(p.last.path, "/feed/thesis/0xA/4");
});

test("human, public calls only: private, holders-only, copies and the house wallet are left out", () => {
  const graded = { ...base, gradedOutcome: "WIN", gradedR: 1, exitedAt: NOW - H };
  const p = callPulse([
    { wallet: "0xA", theses: [{ ...graded, id: "a", isPublic: false }, { ...graded, id: "b", holdersOnly: true }, { ...graded, id: "c", duplicateOf: "x" }] },
    { wallet: "0xHOUSE", theses: [{ ...graded, id: "h" }, { ...base, id: "h2", fillState: "OPEN" }] },
  ], NOW, { exclude: ["0xhouse"] });
  assert.deepEqual(p, { open: 0, gradedWeek: 0, last: null });
});

test("a stale grader stamp counts nowhere; resolution falls back to gradedAt; the window edge is inclusive", () => {
  const p = callPulse([{ wallet: "0xA", theses: [
    { ...base, id: "old", gradedOutcome: "WIN", gradeV: 1, exitedAt: NOW - H },
    { ...base, id: "edge", gradedOutcome: "LOSS", gradeV: 2, gradedAt: NOW - PULSE_WINDOW_MS },
  ] }], NOW, { isCurrent: (t) => t.gradeV === 2 });
  assert.equal(p.gradedWeek, 1);
  assert.equal(p.last.path, "/feed/thesis/0xA/edge");
  assert.equal(p.last.r, null);
});

test("the chip line: real numbers, a quiet week names the last grade's age, unread makes no claim", () => {
  assert.deepEqual(pulseLine({ open: 3, gradedWeek: 2, last: null }, NOW).parts, ["Lab", "3 open calls", "2 graded this week"]);
  assert.deepEqual(pulseLine({ open: 1, gradedWeek: 0, last: { at: NOW - 4 * D } }, NOW).parts, ["Lab", "1 open call", "last graded 4d ago"]);
  assert.deepEqual(pulseLine({ open: 0, gradedWeek: 0, last: null }, NOW).parts, ["Lab", "0 open calls", "0 graded this week"]);
  assert.equal(pulseLine(null, NOW).parts.some((s) => /\d/.test(s)), false);
  assert.equal(pulseLine({ open: NaN, gradedWeek: 1 }, NOW).parts.some((s) => /\d/.test(s)), false);
});

test("agoShort is coarse", () => {
  assert.equal(agoShort(NOW - 5 * 60000, NOW), "5m");
  assert.equal(agoShort(NOW - 30 * H, NOW), "30h");
  assert.equal(agoShort(NOW - 3 * D, NOW), "3d");
});
