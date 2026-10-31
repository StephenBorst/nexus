import { test } from "node:test";
import assert from "node:assert/strict";
import { pipelineLine, countingSince, callsRecordLine, callersLine } from "./proofCopy.mjs";

test("pipelineLine: under the bar says how many it needs", () => {
  const l = pipelineLine({ stage: "REGISTERED", next: "21 more out-of-sample events", numbers: { events: 9 } }, 30);
  assert.equal(l.text, "9 events · needs 30");
  assert.equal(l.sub, "");
  assert.equal(l.state, "counting");
  assert.equal(pipelineLine({ stage: "REGISTERED", numbers: { events: 1 } }).text, "1 event · needs 30");
  assert.equal(pipelineLine({ stage: "REGISTERED" }).text, "0 events · needs 30");
});

test("pipelineLine: past the count but still REGISTERED reads as failing, with the grader's next", () => {
  // Live shape on 2026-10-23: NY open drive, 31 events, mean R −0.76.
  const l = pipelineLine({ stage: "REGISTERED", next: "mean R > 0 with both halves agreeing", reasons: ["mean R -0.76"], numbers: { events: 31 } }, 30);
  assert.equal(l.text, "31 events · failing");
  assert.equal(l.sub, "Needs mean R > 0 with both halves agreeing.");
  assert.equal(l.state, "failing");
  assert.ok(!/needs 30/.test(l.text));
  assert.equal(pipelineLine({ stage: "REGISTERED", numbers: { events: 30 } }, 30).text, "30 events · failing");
});

test("pipelineLine: an advanced read names its stage and what's next", () => {
  const l = pipelineLine({ stage: "LEAD", next: "95% vs random on its side", numbers: { events: 34 } }, 30);
  assert.equal(l.text, "34 events · a lead");
  assert.equal(l.sub, "A lead. Not an edge yet. Hasn't repeated on coins it was never picked on. Next: 95% vs random on its side.");
  const m = pipelineLine({ stage: "LEAD", numbers: { events: 53, meanR: 0.23, holdoutEvents: 36, holdoutMeanR: 0.22, holdoutBeatsRandomPct: 90 } }, 30);
  assert.equal(m.sub, "A lead. Not an edge yet. Mean +0.23R.");
  assert.ok(/Hasn't repeated/.test(pipelineLine({ stage: "LEAD", numbers: { events: 35, meanR: 0.2, holdoutEvents: 15, holdoutMeanR: -0.53, holdoutBeatsRandomPct: 5 } }).sub));
  assert.equal(pipelineLine({ stage: "TRADEABLE", numbers: { events: 60 } }).text, "60 events · tradeable");
});

test("countingSince: earliest registration date, UTC", () => {
  assert.equal(countingSince([{ registeredAt: "2026-10-20T00:00:00Z" }, { registeredAt: "2026-10-17T00:00:00Z" }]), "Oct 17");
  assert.equal(countingSince([]), "");
  assert.equal(countingSince([{ registeredAt: "nope" }]), "");
});

test("callsRecordLine: the full record first, 'most calls lose' only while true", () => {
  const l = callsRecordLine({ resolved: 383, wins: 142, hitRate: 37.1, avgR: -0.15 });
  assert.equal(l.record, "All 383 resolved public calls: 37% hit · −0.15R average.");
  assert.equal(l.caveat, "Most calls lose. Below are the best, not the typical.");
  assert.equal(l.avgR, -0.15);
  const up = callsRecordLine({ resolved: 1200, hitRate: 55, avgR: 0.2 });
  assert.equal(up.record, "All 1,200 resolved public calls: 55% hit · +0.20R average.");
  assert.equal(up.caveat, "Below are the best, not the typical.");
  assert.equal(callsRecordLine({ resolved: 0 }), null);
  assert.equal(callsRecordLine(undefined), null);
});

test("callersLine: the board's entry rule, and that callers aren't tested against chance", () => {
  assert.equal(callersLine(1), "1 caller qualifies for the board: 5+ graded calls and a positive record. Not tested against chance.");
  assert.equal(callersLine(3, 5), "3 callers qualify for the board: 5+ graded calls and a positive record. Not tested against chance.");
  assert.equal(callersLine(0), "No caller qualifies for the board yet: 5+ graded calls and a positive record.");
});

test("retired graded exits agree with the recorded snapshot, and read plainly", async () => {
  const { RETIRED_GRADED_EXITS, retiredGradedExit, retiredLine } = await import("./proofCopy.mjs");
  const { readFileSync } = await import("node:fs");
  const snap = JSON.parse(readFileSync(new URL("../../docs/research/pipeline-stages.json", import.meta.url), "utf8"));
  for (const axis of Object.keys(RETIRED_GRADED_EXITS)) assert.equal(snap.gradedExit[axis]?.status, "FAILS", axis);
  for (const [axis, g] of Object.entries(snap.gradedExit)) if (g.status === "FAILS") assert.ok(RETIRED_GRADED_EXITS[axis], `${axis} FAILS in the snapshot but /proof doesn't say Retired`);
  assert.equal(retiredLine(retiredGradedExit("basis_x_cvd")), "Retired Oct 26, 2026: the read fell to PROMISING, below PREDICTIVE. The paper wallet stays as a record.");
  assert.equal(retiredGradedExit("nope"), null);
  assert.equal(retiredLine(null), "");
});
