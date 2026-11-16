import test from "node:test";
import assert from "node:assert/strict";
import { lastCompletedWeek, weeklyCalls, weeklyPaper, weeklySnapshot, sideLine, stageLine, callsLine, weekLabel } from "./weeklyScorecard.mjs";
import { callPulse } from "./callPulse.mjs";

// The weekly scorecard (borst 2026-11-16, pipeline-if-then.md "Weekly scorecard").
const W = lastCompletedWeek(Date.parse("2026-11-16T20:00:00Z"));
const at = (iso) => Date.parse(iso);
const ENGINE = "0x3b2cd0961aec641fb9c821661d173eedf1bcfbe4", PERSON = "0x1111111111111111111111111111111111111111";
const call = (o) => ({ isPublic: true, gradedOutcome: "WIN", gradedR: 1.5, exitedAt: at("2026-11-12T10:00:00Z"), ...o });

test("the week is Monday 00:00 UTC to the next Monday, the last complete one", () => {
  assert.deepEqual(W, { week: "2026-11-09", from: at("2026-11-09T00:00:00Z"), to: at("2026-11-16T00:00:00Z") });
  assert.equal(lastCompletedWeek(at("2026-11-16T00:00:00Z")).week, "2026-11-09", "Monday midnight closes the week before");
  assert.equal(lastCompletedWeek(at("2026-11-15T23:59:59Z")).week, "2026-11-02");
  assert.equal(weekLabel({ from: "2026-11-09T00:00:00.000Z", to: "2026-11-16T00:00:00.000Z" }), "Nov 9 – Nov 15");
});

test("calls: people and engines apart, only this week's grades, MAE/MFE medians from calls that carry them", () => {
  const records = [
    { wallet: PERSON, theses: [call({ maeR: -0.4, mfeR: 1.6 }), call({ gradedOutcome: "LOSS", gradedR: -1, maeR: -1, mfeR: 0.2 }), call({ exitedAt: at("2026-11-17T00:00:00Z") }), call({ isPublic: false }), call({ duplicateOf: "x" })] },
    { wallet: ENGINE, theses: [call({ gradedR: 2.25 }), call({ gradedOutcome: "LOSS", gradedR: -1, exitedAt: at("2026-11-08T23:59:00Z") })] },
  ];
  const w = weeklyCalls(records, W, { engines: [ENGINE] });
  assert.deepEqual(w.people, { graded: 2, wins: 1, netR: 0.5, mae: { n: 2, median: -0.7 }, mfe: { n: 2, median: 0.9 } });
  assert.deepEqual(w.engines, { graded: 1, wins: 1, netR: 2.25, mae: { n: 0, median: null }, mfe: { n: 0, median: null } });
  // Same filters as the pulse: over the same 7 days the counts agree.
  const p = callPulse(records, W.to, { engines: [ENGINE] });
  assert.equal(p.gradedWeek, w.people.graded);
  assert.equal(p.engines.gradedWeek, w.engines.graded);
});

test("paper: counts only, never a sum or average of R before the judgment", () => {
  const state = { paper_agg: { trades: 8 }, paper_trades: [
    { closed_at: "2026-11-12T00:00:00Z", reason: "SL", pnl: -30 }, { closed_at: "2026-11-14T00:00:00Z", reason: "TP", pnl: 45 },
    { closed_at: "2026-11-02T00:00:00Z", reason: "TP", pnl: 45 } ] };
  const [p] = weeklyPaper({ level_reclaim: { wallet: "0x95e2", state, verdict: "ACCRUING" } }, W);
  assert.deepEqual(p, { axis: "level_reclaim", wallet: "0x95e2", closedWeek: 2, targets: 1, stops: 1, timeStops: 0, other: 0, trades: 8, of: 30, verdict: "ACCRUING" });
  assert.doesNotMatch(JSON.stringify(p), /pnl|meanR|sumR|"r"/, "no R or dollars leave the paper block");
  assert.deepEqual(weeklyPaper({ x: { wallet: "0x1", state: null } }, W), [{ axis: "x", wallet: "0x1", unread: true }], "unread, never zero");
});

const board = (events, stage = "REGISTERED") => ({
  asOf: "2026-11-16T18:53:49Z", tide: { from: "2026-08-07T16:00:00Z", to: "2026-11-16T07:00:00Z", LONG: { meanR: -0.18 }, SHORT: { meanR: 0.2 } },
  axes: [{ name: "oi_div_reversal_4h", oos: { sides: { LONG: { events: 48, r: { meanR: -0.04 } }, SHORT: { events: 42, r: { meanR: 0.52 } } },
    random: { bySide: { LONG: { pctBeaten: 100, randomMedianR: -0.51 }, SHORT: { pctBeaten: 23.7, randomMedianR: 0.68 } } } } }],
  pipeline: { reads: [{ axis: "oi_div_reversal_4h", stage, next: "mean R > 0 with both halves agreeing", registeredAt: "2026-10-28T00:00:00Z", numbers: { events, meanR: 0.22, holdoutEvents: 0 } }] },
});

test("snapshot: new-data numbers per read, the week's new events and stage move from last week's snapshot", () => {
  const first = weeklySnapshot({ board: board(90), calls: weeklyCalls([], W), paper: [], week: W, builtAt: at("2026-11-16T20:29:00Z") });
  assert.equal(first.reads[0].eventsWeek, null, "no last week = no weekly count, never a guess");
  assert.equal(first.reads[0].holdout.meanR, null);
  assert.deepEqual(first.reads[0].sides.SHORT, { n: 42, meanR: 0.52, randomR: 0.68, pct: 23.7 });
  assert.equal(first.from, "2026-11-09T00:00:00.000Z");
  const W2 = lastCompletedWeek(at("2026-11-23T00:29:00Z"));
  const second = weeklySnapshot({ board: board(101, "LEAD"), prev: first, calls: weeklyCalls([], W2), paper: [], week: W2, builtAt: at("2026-11-23T00:29:00Z") });
  assert.equal(second.reads[0].eventsWeek, 11);
  assert.equal(stageLine(second.reads[0]), "REGISTERED → LEAD");
  assert.equal(weeklySnapshot({ board: null }), null, "an unread board writes no week");
  assert.doesNotMatch(JSON.stringify(second), /\bedge\b|proven/i);
});

test("lines: each side against its random entry, calls with their path when they carry one", () => {
  assert.equal(sideLine("SHORT", { n: 42, meanR: 0.52, randomR: 0.68, pct: 23.7 }), "Shorts +0.52R vs random shorts +0.68R (beat 24% of replays).");
  assert.equal(sideLine("LONG", { n: 4, meanR: 1.5, randomR: -0.2, pct: 90 }), "Longs: 4 new events, too few to compare.");
  assert.equal(callsLine({ graded: 2, wins: 1, netR: 0.5, mae: { n: 2, median: -0.7 }, mfe: { n: 2, median: 0.9 } }, "People"),
    "People: 2 graded, 1 won, +0.50R net · median went −0.70R against and +0.90R for (2 with a path).");
  assert.equal(callsLine({ graded: 0 }, "Engines"), "Engines: no calls graded this week.");
});

test("the signed section is on the rules page and matches what the snapshot holds", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../../docs/research/pipeline-if-then.md", import.meta.url), "utf8");
  assert.match(page, /\*\*Weekly scorecard\*\* \(added 2026-11-16, borst/);
  assert.match(page, /No average or sum of R before the 30-trade judgment/);
  assert.match(page, /No split by regime until the trend-gate study's judge is built/);
  assert.match(page, /A written week is never rewritten/);
});
