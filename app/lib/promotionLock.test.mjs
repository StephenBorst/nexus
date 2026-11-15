// promotionLock: a demoted read is promotion-locked until 2 clean daily reads 7+ days apart + 15 new events
// (pipeline-if-then.md § "Backwards moves", borst 2026-11-15). Run: node --test app/lib/promotionLock.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOCK_RULE, isDemotion, lockAtDemotion, stepLock, eventsNeeded, lockProgress, stageSignRefusal, PLAN_STAGES,
} from "./promotionLock.mjs";

const day = (n) => new Date(Date.parse("2026-11-15T13:53:54.714Z") + n * 86_400_000).toISOString();
const L0 = lockAtDemotion(null, { from: "PAPER", events: 99, asOf: day(0) });

test("the numbers are borst's: 2 passes, 7 days apart, 15 new events; written on the page", () => {
  assert.deepEqual({ ...LOCK_RULE }, { passes: 2, minDaysApart: 7, newEvents: 15 });
  const page = readFileSync(new URL("../../docs/research/pipeline-if-then.md", import.meta.url), "utf8");
  assert.match(page, /\*\*Backwards moves\*\* \(added 2026-11-15, borst/);
  assert.match(page, /two clean daily watcher reads that serve the lost stage or higher, at least 7 days apart,\n  and at least 15 new out-of-sample events since the demotion/);
  assert.match(page, /The paper wallet keeps running\./);
});

test("a demotion is a move to a lower ranked stage; RETIRED and unknown stages never are", () => {
  assert.equal(isDemotion("PAPER", "REGISTERED"), true);
  assert.equal(isDemotion("TRADEABLE", "EDGE"), true);
  assert.equal(isDemotion("LEAD", "PAPER"), false);
  assert.equal(isDemotion("PAPER", "RETIRED"), false);
  assert.equal(isDemotion(null, "REGISTERED"), false);
  assert.equal(isDemotion("PAPER", "PAPER"), false);
});

test("the lock records the stage lost, the date and the event count; a second demotion keeps the higher stage lost", () => {
  assert.deepEqual(L0, { lostStage: "PAPER", demotedAt: day(0), eventsAtDemotion: 99, cleanPasses: 0, lastPassAt: null });
  const again = lockAtDemotion({ ...L0, cleanPasses: 1, lastPassAt: day(3) }, { from: "LEAD", events: 105, asOf: day(5) });
  assert.deepEqual(again, { lostStage: "PAPER", demotedAt: day(5), eventsAtDemotion: 105, cleanPasses: 0, lastPassAt: null });
});

test("still failing = nothing changes; a pass needs the lost stage or higher", () => {
  assert.deepEqual(stepLock(L0, { stage: "REGISTERED", events: 100 }, day(1)), { lock: L0, event: null });
  assert.equal(stepLock(L0, { stage: "TRADEABLE", events: 100 }, day(1)).event, null, "TRADEABLE is below a lost PAPER");
  const t = lockAtDemotion(null, { from: "TRADEABLE", events: 50, asOf: day(0) });
  assert.equal(stepLock(t, { stage: "PAPER", events: 50 }, day(1)).event, "pass", "higher than the lost stage counts");
});

test("two passes 7+ days apart and 15 new events clear it; closer passes don't count; a failing read resets", () => {
  const p1 = stepLock(L0, { stage: "PAPER", events: 101 }, day(1));
  assert.equal(p1.event, "pass");
  assert.deepEqual([p1.lock.cleanPasses, p1.lock.lastPassAt], [1, day(1)]);
  const soon = stepLock(p1.lock, { stage: "PAPER", events: 120 }, day(7.9));
  assert.deepEqual(soon, { lock: p1.lock, event: null }, "6.9 days later: still passing, not counted");
  const reset = stepLock(p1.lock, { stage: "REGISTERED", events: 120 }, day(5));
  assert.equal(reset.event, "reset");
  assert.deepEqual([reset.lock.cleanPasses, reset.lock.lastPassAt], [0, null]);
  assert.equal(reset.lock.eventsAtDemotion, 99, "the event count still runs from the demotion");
  const done = stepLock(p1.lock, { stage: "PAPER", events: 114 }, day(8));
  assert.deepEqual(done, { lock: null, event: "unlocked" });
});

test("two passes without 15 new events stay locked until the events arrive (or a failing read resets)", () => {
  const p1 = stepLock(L0, { stage: "PAPER", events: 100 }, day(1)).lock;
  const p2 = stepLock(p1, { stage: "PAPER", events: 110 }, day(8));
  assert.equal(p2.event, "pass");
  assert.equal(p2.lock.cleanPasses, 2);
  assert.equal(eventsNeeded(p2.lock, 110), 4);
  assert.deepEqual(stepLock(p2.lock, { stage: "PAPER", events: 113 }, day(9)), { lock: p2.lock, event: null });
  assert.deepEqual(stepLock(p2.lock, { stage: "PAPER", events: 114 }, day(10)), { lock: null, event: "unlocked" });
  assert.equal(stepLock(p2.lock, { stage: "LEAD", events: 120 }, day(10)).event, "reset");
});

test("the progress line names passes, spacing and events in plain words", () => {
  assert.equal(lockProgress(L0, 99), "promotion locked since 2026-11-15 (lost PAPER): 0 of 2 clean daily reads at PAPER, 15 more new events (15 since the demotion)");
  const p1 = stepLock(L0, { stage: "PAPER", events: 120 }, day(1)).lock;
  assert.equal(lockProgress(p1, 120), "promotion locked since 2026-11-15 (lost PAPER): 1 of 2 clean daily reads at PAPER, the next counts from 2026-11-23, 15+ new events in");
  assert.match(lockProgress(L0, null), /, and 15 new events since the demotion$/);
});

test("a live plan signs only at TRADEABLE / PAPER with no lock; an unread board refuses", () => {
  assert.deepEqual([...PLAN_STAGES], ["TRADEABLE", "PAPER"]);
  assert.equal(stageSignRefusal({ stage: "PAPER", lock: null }), null);
  assert.equal(stageSignRefusal({ stage: "TRADEABLE", lock: null }), null);
  assert.equal(stageSignRefusal({ stage: "REGISTERED", lock: null }).error, "read_demoted");
  assert.equal(stageSignRefusal({ stage: null, lock: null }).error, "stage_unread");
  assert.equal(stageSignRefusal({ stage: "PAPER", lock: L0 }).error, "promotion_locked");
});
