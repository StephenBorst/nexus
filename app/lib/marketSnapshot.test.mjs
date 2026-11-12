import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prevSnapshotUsable, PREV_MAX_AGE_MS } from "./marketSnapshot.mjs";
import * as brain from "../../workers/nexus-agent-brain/logic.mjs";

test("one rule: the brain and lab-api use the same baseline age", () => {
  assert.equal(brain.prevSnapshotUsable, prevSnapshotUsable, "the brain re-exports this module's rule");
  assert.equal(brain.PREV_MAX_AGE_MS, PREV_MAX_AGE_MS);
  const sd = readFileSync(new URL("../../workers/nexus-lab-api/signal-delivery.mjs", import.meta.url), "utf8");
  assert.equal((sd.match(/prevSnapshotUsable\(/g) || []).length, 2, "both readers of market:prev check it");
  assert.equal((sd.match(/market:prev:/g) || []).length, 2, "and there is no third, unchecked one");
});

test("fresh, stale, untimed, future", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  assert.equal(prevSnapshotUsable({ price: 1, timestamp: now - PREV_MAX_AGE_MS }, now), true);
  assert.equal(prevSnapshotUsable({ price: 1, timestamp: now - PREV_MAX_AGE_MS - 1 }, now), false);
  assert.equal(prevSnapshotUsable({ price: 1 }, now), false);
  assert.equal(prevSnapshotUsable({ price: 1, timestamp: now + 1 }, now), false);
  assert.equal(prevSnapshotUsable(null, now), false);
});
