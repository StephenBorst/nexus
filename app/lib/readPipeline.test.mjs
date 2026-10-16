// The read pipeline: stages, kill rules, and the pins that keep the code and the docs on one rule.
// Run: node --test app/lib/readPipeline.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PIPELINE_RULES, REGISTERED_READS, pipelineStage, registrationFor, registeredMs } from "./readPipeline.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REG = { axis: "x", side: "LONG", registeredAt: "2026-10-17T00:00:00Z", holdout: true, gradedExit: true, paperWallet: null };
const row = ({ n = 0, meanR = 0, stable = true, pct = null, verdict = "NOT_DISTINGUISHABLE", exit = null } = {}) => ({
  r: { samples: n, meanR, stable },
  random: pct == null ? null : { bySide: { LONG: { pctBeaten: pct, verdict } } },
  exitGraded: exit,
});

test("too few out-of-sample events → REGISTERED, says how many more", () => {
  const s = pipelineStage(REG, row({ n: 12, meanR: 0.4 }), null);
  assert.equal(s.stage, "REGISTERED");
  assert.match(s.next, /18 more/);
});

test("enough events but mean R ≤ 0 or halves disagree → still REGISTERED (not a lead)", () => {
  assert.equal(pipelineStage(REG, row({ n: 40, meanR: -0.05 }), null).stage, "REGISTERED");
  assert.equal(pipelineStage(REG, row({ n: 40, meanR: 0.2, stable: false }), null).stage, "REGISTERED");
});

test("LEAD without holdout replication stays LEAD, however good the main card is", () => {
  const s = pipelineStage(REG, row({ n: 80, meanR: 0.3, pct: 99, verdict: "BEATS_RANDOM" }), row({ n: 10, meanR: 0.5 }));
  assert.equal(s.stage, "LEAD");
  assert.match(s.next, /20 more holdout events/);
  const f = pipelineStage(REG, row({ n: 80, meanR: 0.3, pct: 99 }), row({ n: 40, meanR: -0.1, pct: 30 }));
  assert.equal(f.stage, "LEAD");
  assert.match(f.next, /holdout mean R > 0/);
});

test("LEAD → EDGE needs ≥95% on the main card AND the holdout at ≥80% with mean R > 0", () => {
  const holdOk = row({ n: 35, meanR: 0.1, pct: 85 });
  assert.equal(pipelineStage(REG, row({ n: 80, meanR: 0.3, pct: 94 }), holdOk).stage, "LEAD");
  assert.equal(pipelineStage(REG, row({ n: 80, meanR: 0.3, pct: 95 }), holdOk).stage, "EDGE");
  assert.equal(pipelineStage(REG, row({ n: 80, meanR: 0.3, pct: 99 }), row({ n: 35, meanR: 0.1, pct: 79 })).stage, "LEAD");
});

test("EDGE → TRADEABLE needs the graded exit net > 0 over ≥30 trades; PAPER needs a wallet", () => {
  const hold = row({ n: 35, meanR: 0.1, pct: 85 });
  const main = (exit) => row({ n: 80, meanR: 0.3, pct: 97, exit });
  assert.equal(pipelineStage(REG, main({ samples: 20, netBps: 40 }), hold).stage, "EDGE");
  assert.equal(pipelineStage(REG, main({ samples: 40, netBps: -5 }), hold).stage, "EDGE");
  assert.equal(pipelineStage(REG, main({ samples: 40, netBps: 12 }), hold).stage, "TRADEABLE");
  assert.equal(pipelineStage({ ...REG, paperWallet: "0xabc" }, main({ samples: 40, netBps: 12 }), hold).stage, "PAPER");
});

test("RETIRED at ≥100 events: mean R ≤ 0 or worse than random, on either line — and it wins over everything", () => {
  assert.equal(pipelineStage(REG, row({ n: 100, meanR: 0 }), null).stage, "RETIRED");
  assert.equal(pipelineStage(REG, row({ n: 120, meanR: 0.05, pct: 3, verdict: "BELOW_RANDOM" }), null).stage, "RETIRED");
  const s = pipelineStage(REG, row({ n: 150, meanR: 0.3, pct: 99, exit: { samples: 50, netBps: 30 } }), row({ n: 100, meanR: -0.1, pct: 20 }));
  assert.equal(s.stage, "RETIRED");
  assert.match(s.reasons[0], /holdout/);
  assert.equal(pipelineStage(REG, row({ n: 99, meanR: -0.2 }), null).stage, "REGISTERED", "below the kill line it only accrues");
});

test("registrations: future-dated when written, one per axis, each with a doc that names its date", () => {
  const seen = new Set();
  for (const r of REGISTERED_READS) {
    assert.ok(!seen.has(r.axis), `${r.axis} registered twice`); seen.add(r.axis);
    assert.ok(Number.isFinite(registeredMs(r)));
    assert.ok(["LONG", "SHORT"].includes(r.side));
    const doc = readFileSync(join(ROOT, r.doc), "utf8");
    assert.ok(doc.includes(r.registeredAt), `${r.doc} must name ${r.registeredAt}`);
    assert.ok(doc.includes(r.axis));
  }
  assert.equal(registrationFor("rsi_reset_deep").registeredAt, "2026-10-17T00:00:00Z");
  assert.equal(registrationFor("nope"), null);
});

test("the pipeline doc states the same numbers as the code", () => {
  const doc = readFileSync(join(ROOT, "docs/research/read-pipeline.md"), "utf8");
  const R = PIPELINE_RULES;
  for (const s of [`${R.minEvents} out-of-sample events`, `${R.edgePct}%`, `${R.holdoutMinEvents} holdout events`, `${R.holdoutPct}%`, `${R.exitMinTrades} trades`, `${R.killEvents} out-of-sample events`]) {
    assert.ok(doc.includes(s), `read-pipeline.md must say "${s}"`);
  }
});
