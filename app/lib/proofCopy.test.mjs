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

test("pipelineLine: an Edge read states the Edge line from pipeline-if-then.md", () => {
  const e = pipelineLine({ stage: "EDGE", next: "1 more graded-exit trades", numbers: { events: 60 } }, 30);
  assert.equal(e.text, "60 events · an edge");
  assert.ok(e.sub.startsWith("Beats random on new data and on coins it was never picked on. Not tested as a trade yet."));
  assert.ok(/Next: 1 more graded-exit trades\./.test(e.sub));
});

test("proofHeadline: no claim until a read is SERVED tradeable, net positive after fees, on a fresh board", async () => {
  const { proofHeadline, HEADLINE_DEFAULT, HEADLINE_MAX_AGE_MS } = await import("./proofCopy.mjs");
  const now = Date.parse("2026-11-05T03:00:00Z");
  const asOf = "2026-11-05T02:53:15.484Z";
  const read = (stage, exitTrades, exitNetBps, axis = "level_reclaim") => ({ axis, stage, numbers: { events: 68, meanR: 0.38, exitTrades, exitNetBps } });
  const board = (...reads) => ({ asOf, axes: [], pipeline: { reads } });
  // The default holds while nothing has cleared, and whenever the board can't be trusted.
  assert.equal(HEADLINE_DEFAULT.title, "Nothing has proven itself yet.");
  for (const sc of [null, undefined, { failed: true, axes: [] }, { axes: [] }, board(read("EDGE", 31, -0.8)), board(read("LEAD", 0, 0))]) {
    assert.deepEqual(proofHeadline(sc, now), HEADLINE_DEFAULT);
  }
  // Served TRADEABLE → the read, the number of trades, the date (pipeline-if-then.md, Tradeable).
  const h = proofHeadline(board(read("TRADEABLE", 37, 18.6), read("LEAD", 4, 216.7, "oi_div_reversal_4h")), now);
  assert.equal(h.cleared, true);
  assert.equal(h.title, "level_reclaim cleared the bar.");
  assert.equal(h.sub, "37 trades, net positive after fees. As of Nov 5.");
  assert.ok(!/proven/i.test(h.title + h.sub), "a cleared read is not called proven: it hasn't traded on paper yet");
  // It falls back the moment the grade does, and a stale or future-dated board makes no claim.
  assert.deepEqual(proofHeadline(board(read("EDGE", 38, -3.1)), now), HEADLINE_DEFAULT);
  assert.deepEqual(proofHeadline(board(read("TRADEABLE", 37, 18.6)), now + HEADLINE_MAX_AGE_MS + 60000), HEADLINE_DEFAULT);
  assert.deepEqual(proofHeadline({ ...board(read("TRADEABLE", 37, 18.6)), asOf: "2026-11-06T00:00:00Z" }, now), HEADLINE_DEFAULT);
  assert.deepEqual(proofHeadline({ ...board(read("TRADEABLE", 37, 18.6)), asOf: undefined }, now), HEADLINE_DEFAULT);
  // A stage label alone isn't enough: the served money line must be positive too.
  assert.deepEqual(proofHeadline(board(read("TRADEABLE", 37, -1)), now), HEADLINE_DEFAULT);
  // PAPER is past Tradeable, so it still counts; two cleared reads are both named.
  const two = proofHeadline(board(read("PAPER", 40, 12), read("TRADEABLE", 31, 5, "x_read")), now);
  assert.equal(two.title, "2 signals cleared the bar.");
  assert.equal(two.sub, "level_reclaim (40 trades), x_read (31 trades), each net positive after fees. As of Nov 5.");
});

test("the /proof headline is computed, not typed: FeaturedLead renders proofHeadline", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../pages/proof/FeaturedLead.tsx", import.meta.url), "utf8");
  assert.match(src, /proofHeadline\(/);
  assert.ok(!/>\s*Nothing has proven itself yet\./.test(src), "the default line lives in proofCopy.mjs, not typed into the page");
});

test("PLAIN_WORDS: every tier word the signal board prints has a plain line; no tier is called proven or an edge", async () => {
  const { PLAIN_WORDS } = await import("./proofCopy.mjs");
  const { readFileSync } = await import("node:fs");
  const board = readFileSync(new URL("../pages/proof/SignalBoard.tsx", import.meta.url), "utf8");
  const shown = [...board.matchAll(/label: "([A-Z]+)"/g)].map((m) => m[1]);
  assert.ok(shown.length >= 4, "found the board's tier labels");
  const terms = new Set(PLAIN_WORDS.map((w) => w.term));
  for (const t of shown) assert.ok(terms.has(t), `plain line for ${t}`);
  assert.ok(terms.has("R") && terms.has("bps"));
  for (const w of PLAIN_WORDS) assert.doesNotMatch(w.text, /\bproven\b|\bedge\b/i, w.term);
});

test("engine notes: one per engine wallet in wrangler's ENGINE_CALLER_ADDRESSES, no results promised", async () => {
  const { ENGINE_NOTES, engineNote } = await import("./proofCopy.mjs");
  const { readFileSync } = await import("node:fs");
  const toml = readFileSync(new URL("../../workers/nexus-lab-api/wrangler.toml", import.meta.url), "utf8");
  const engines = /^ENGINE_CALLER_ADDRESSES = "([^"]+)"/m.exec(toml)[1].split(",").map((a) => a.trim().toLowerCase()).sort();
  assert.deepEqual(Object.keys(ENGINE_NOTES).sort(), engines);
  for (const t of Object.values(ENGINE_NOTES)) assert.ok(!/proven|edge|profit|guarantee|win rate/i.test(t), t);
  assert.equal(engineNote("0xD9F7B3273B504E1473C3FABA6341299D0EC9B449"), ENGINE_NOTES["0xd9f7b3273b504e1473c3faba6341299d0ec9b449"]);
  assert.equal(engineNote("0xperson"), null);
});
