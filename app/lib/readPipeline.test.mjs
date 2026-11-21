// The read pipeline: stages, kill rules, and the pins that keep the code and the docs on one rule.
// Run: node --test app/lib/readPipeline.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PIPELINE_RULES, REGISTERED_READS, pipelineStage, registrationFor, registeredMs, STAGES } from "./readPipeline.mjs";

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

// borst 2026-11-20 (pipeline-if-then.md "Reads no longer retire"): the 100-event check is a LABEL. The stage is the
// ladder's as for any read; the label carries the reasons, comes and goes with the numbers, and is never final.
test("the 100-event check: mean R ≤ 0 or worse than random, on either line, sets `failing`, never a stage", () => {
  const flat = pipelineStage(REG, row({ n: 100, meanR: 0 }), null);
  assert.equal(flat.stage, "REGISTERED");
  assert.deepEqual(flat.failing, ["main card: 100 events, mean R 0"]);
  const below = pipelineStage(REG, row({ n: 120, meanR: 0.05, pct: 3, verdict: "BELOW_RANDOM" }), null);
  assert.ok(below.failing && /worse than random/.test(below.failing[0]));
  const hold = pipelineStage(REG, row({ n: 150, meanR: 0.3, pct: 99, exit: { samples: 50, netBps: 30 } }), row({ n: 100, meanR: -0.1, pct: 20 }));
  assert.equal(hold.stage, "LEAD", "a failing holdout stops the ladder at Lead (EDGE needs the holdout), it doesn't end the read");
  assert.match(hold.failing[0], /holdout/);
  assert.equal(pipelineStage(REG, row({ n: 99, meanR: -0.2 }), null).failing, null, "below 100 events: no label");
  assert.equal(pipelineStage(REG, row({ n: 140, meanR: 0.2, pct: 70 }), null).failing, null, "the numbers came back: the label is gone");
  assert.ok(!STAGES.includes("RETIRED"));
});

test("a failing read can never reach EDGE or above, so it can never wear the CLEARED badge", () => {
  // EDGE needs ≥ 95% vs random and a holdout with mean R > 0; the check fires on mean R ≤ 0 or BELOW_RANDOM.
  for (const meanR of [-0.2, 0, 0.1]) for (const [pct, verdict] of [[2, "BELOW_RANDOM"], [99, "BEATS_RANDOM"]]) {
    for (const h of [null, row({ n: 120, meanR: -0.1, pct: 3, verdict: "BELOW_RANDOM" }), row({ n: 60, meanR: 0.4, pct: 90 })]) {
      const s = pipelineStage({ ...REG, paperWallet: "0x1" }, row({ n: 130, meanR, pct, verdict, exit: { samples: 60, netBps: 40 } }), h);
      if (s.failing) assert.ok(["REGISTERED", "LEAD"].includes(s.stage), `${meanR} ${pct} → ${s.stage}`);
    }
  }
});

test("registrations: future-dated when written, one per axis, each with a doc that names its date", () => {
  const seen = new Set();
  for (const r of REGISTERED_READS) {
    assert.ok(!seen.has(r.axis), `${r.axis} registered twice`); seen.add(r.axis);
    assert.ok(Number.isFinite(registeredMs(r)));
    assert.ok(["LONG", "SHORT", "BOTH"].includes(r.side));
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
  for (const s of [`${R.sideMinEvents} out-of-sample events on the main card to beat at least ${R.sidePct}% of its own random replays`, `${R.minEvents} out-of-sample events`, `${R.edgePct}%`, `${R.holdoutMinEvents} holdout events`, `${R.holdoutPct}%`, `${R.exitMinTrades} trades`, `${R.failEvents} out-of-sample events`]) {
    assert.ok(doc.includes(s), `read-pipeline.md must say "${s}"`);
  }
});

test("a two-sided read is judged on the pooled random result, not one side", () => {
  const both = { ...REG, side: "BOTH" };
  const pooled = (pct, verdict = "NOT_DISTINGUISHABLE") => ({ pooled: { pctBeaten: pct, verdict }, bySide: { LONG: { pctBeaten: 10 }, SHORT: { pctBeaten: 10 } } });
  const main = { r: { samples: 80, meanR: 0.3, stable: true }, random: pooled(97), exitGraded: null };
  const hold = { r: { samples: 40, meanR: 0.2, stable: true }, random: pooled(85) };
  const s = pipelineStage(both, main, hold);
  assert.equal(s.stage, "EDGE", "pooled 97% / 85% clears, whatever one side alone says");
  assert.equal(s.numbers.beatsRandomPct, 97);
  assert.equal(pipelineStage(both, { ...main, random: pooled(94) }, hold).stage, "LEAD");
  assert.match(pipelineStage(both, { ...main, random: pooled(94) }, hold).next, /random entries/);
  const dead = pipelineStage(both, { r: { samples: 120, meanR: 0.1, stable: true }, random: pooled(2, "BELOW_RANDOM") }, null);
  assert.equal(dead.stage, "LEAD");
  assert.match(dead.failing[0], /worse than random/);
});

// borst 2026-11-16 (pipeline-if-then.md "Each side on its own"): a two-sided read reaches EDGE only if each side with
// ≥ 20 out-of-sample events beats ≥ 50% of its own random replays, on top of the pooled 95%.
test("a two-sided read can't reach EDGE on one side while the other trails its own random", () => {
  const both = { ...REG, side: "BOTH" };
  const rand = (pooled, L, S) => ({ pooled: { pctBeaten: pooled, verdict: "BEATS_RANDOM" }, bySide: { LONG: L, SHORT: S } });
  const hold = { r: { samples: 40, meanR: 0.2, stable: true }, random: { pooled: { pctBeaten: 85 } } };
  const main = (random) => ({ r: { samples: 99, meanR: 0.12, stable: true }, random, exitGraded: null });
  // level_reclaim on 2026-11-16: pooled 98.3%, longs 100% (73), shorts 13.2% (26) → held at LEAD, the next line says why.
  const lr = pipelineStage(both, main(rand(98.3, { n: 73, pctBeaten: 100 }, { n: 26, pctBeaten: 13.2 })), hold);
  assert.equal(lr.stage, "LEAD");
  assert.match(lr.next, /shorts beat ≥ 50% of random shorts \(now 13\.2%\)/);
  assert.doesNotMatch(lr.next, /beat 95% of random entries/, "the pooled bar is met; only the trailing side is named");
  // A thin trailing side (< 20 events) doesn't block; both sides at ≥ 50% don't block.
  assert.equal(pipelineStage(both, main(rand(97, { n: 80, pctBeaten: 99 }, { n: 19, pctBeaten: 5 })), hold).stage, "EDGE");
  assert.equal(pipelineStage(both, main(rand(97, { n: 60, pctBeaten: 99 }, { n: 39, pctBeaten: 50 })), hold).stage, "EDGE");
  // Both failing: the pooled line and the side are both named.
  const two = pipelineStage(both, main(rand(90, { n: 60, pctBeaten: 99 }, { n: 39, pctBeaten: 30 })), hold);
  assert.match(two.next, /beat 95% of random entries \(now 90%\) · shorts beat ≥ 50%/);
  // A one-sided read is judged on its side only; the per-side rule adds nothing.
  const one = { ...REG, side: "LONG" };
  assert.equal(pipelineStage(one, main({ bySide: { LONG: { n: 99, pctBeaten: 96 }, SHORT: { n: 50, pctBeaten: 1 } } }), { ...hold, random: { bySide: { LONG: { pctBeaten: 85 } } } }).stage, "EDGE");
  assert.deepEqual([PIPELINE_RULES.sideMinEvents, PIPELINE_RULES.sidePct], [20, 50]);
  const page = readFileSync(join(ROOT, "docs/research/pipeline-if-then.md"), "utf8");
  assert.match(page, /\*\*Each side on its own\*\* \(added 2026-11-16, borst/);
  assert.match(page, /each side with 20 or more out-of-sample events also beats\n  at least 50% of that side's own random replays/);
});

// borst 2026-11-21 (the /proof visual pass): `gates` = the same bars as `next`, as data, so the lead cards draw tracks
// instead of parsing the sentence. Every "(now X)" in `next` is a gate's `now`; every bar in it is a gate's `bar`.
test("gates: one per bar in `next`, with the same numbers, at every stage", () => {
  const few = pipelineStage(REG, row({ n: 12, meanR: 0.4 }), null);
  assert.deepEqual(few.gates, [{ key: "events", label: "out-of-sample events", now: 12, bar: 30, unit: "events", met: false }]);
  const flat = pipelineStage(REG, row({ n: 40, meanR: 0.2, stable: false }), null);
  assert.deepEqual(flat.gates.map((g) => [g.key, g.now, g.bar, g.met]), [["mean_r", 0.2, 0, true], ["halves", null, null, false]]);

  // A two-sided lead with a trailing side and a failing holdout: three bars, as in `next`.
  const BOTH = { ...REG, side: "BOTH" };
  const main = { r: { samples: 80, meanR: 0.3, stable: true }, random: { pooled: { pctBeaten: 60.4 }, bySide: { LONG: { n: 40, pctBeaten: 70 }, SHORT: { n: 40, pctBeaten: 22.2 } } } };
  const hold = { r: { samples: 40, meanR: 0.31, stable: true }, random: { pooled: { pctBeaten: 40.2 } } };
  const lead = pipelineStage(BOTH, main, hold);
  assert.equal(lead.stage, "LEAD");
  assert.equal(lead.next, "beat 95% of random entries (now 60.4%) · shorts beat ≥ 50% of random shorts (now 22.2%) · holdout mean R > 0 and ≥ 80% vs random (now 0.31R, 40.2%)");
  assert.deepEqual(lead.gates.map((g) => [g.key, g.now, g.bar, g.unit, g.met]), [
    ["random", 60.4, 95, "%", false], ["random_short", 22.2, 50, "%", false],
    ["holdout_r", 0.31, 0, "R", true], ["holdout_random", 40.2, 80, "%", false],
  ]);
  for (const m of lead.next.matchAll(/now ([\d.]+)%/g)) assert.ok(lead.gates.some((g) => g.now === Number(m[1])), `gate for ${m[0]}`);

  const hold2 = row({ n: 35, meanR: 0.1, pct: 85 });
  const ex = (exit) => pipelineStage(REG, row({ n: 80, meanR: 0.3, pct: 97, exit }), hold2);
  assert.deepEqual(ex({ samples: 20, netBps: 40 }).gates.map((g) => [g.key, g.now, g.bar]), [["exit_trades", 20, 30]]);
  assert.deepEqual(ex({ samples: 40, netBps: -5 }).gates.map((g) => [g.key, g.now, g.bar, g.unit]), [["exit_net", -5, 0, "bps"]]);
  assert.deepEqual(ex({ samples: 40, netBps: 12 }).gates.map((g) => g.key), ["paper_wallet"]);
});
